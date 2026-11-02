# Arquitetura do ANIMA

Documento para quem vai manter ou estender o projeto. Descreve o caminho de um pedido, as decisões que sustentam o desenho e os pontos de extensão.

---

## 1. Visão geral

```
HTTP (App Router)
  │
  ├─ /api/analyses                → cria/enfileira, lista
  ├─ /api/analyses/:id            → lê, exclui
  ├─ /api/analyses/:id/retry      → reexecuta etapas
  ├─ /api/analyses/:id/cancel     → cancela
  └─ /api/status                  → configuração + fila
        │
        ▼
   orchestrator.ts  ──────────────► AnalysisStore (Prisma | memória)
        │                                  ▲
        ├─ search.ts ──► provedores        │  progresso por linha
        │     └─ user-sources.ts           │
        ├─ prompts.ts ──► llm.ts ──► provedor de LLM
        └─ dto.ts / export.ts ──► UI (polling)
```

O servidor é **stateful por design**: a fila e os `AbortController` vivem no processo Node. Isso exclui funções serverless sem processo persistente (Vercel Functions, por exemplo).

---

## 2. Caminho de um pedido

1. **Validação** (`validation.ts` + zod). Normaliza título/dica/recorte, resolve lentes (`[]` ⇒ todas), valida fontes do usuário (SSRF) e limita tamanhos.
2. **Reaproveitamento**: `findLatestCompleted(title, kind, depth, hint, focus)` devolve uma análise concluída equivalente, salvo `force: true`.
3. **Capacidade**: se `runs.size >= ANIMA_MAX_ACTIVE`, a análise nasce com `status = queued` e entra no `Map` de fila (preserva ordem). Se a fila também estiver cheia (`ANIMA_MAX_QUEUE`), responde `429`.
4. **Execução** (`launch`): cria `AbortController`, registra a promise em `runs` e dispara `execute()`.
5. **Pesquisa**: `gatherSources` roda os provedores em paralelo (`Promise.allSettled`) e `fetchUserSources`; o resultado é deduplicado, priorizado e formatado em `<fonte>` com metadados.
6. **Especialistas**: `Promise.all` sobre as lentes, cada uma passando pelo limitador global de LLM.
7. **Síntese**: exige `min(3, lentes)` concluídas; caso contrário registra o motivo e encerra parcial.
8. **Encerramento**: `status = completed` com `durationMs`; a vaga libera a fila em `finally`.

---

## 3. Decisões e porquês

| Decisão | Alternativa descartada | Por quê |
| --- | --- | --- |
| Uma linha por lente (`AgentResult`) | um JSON único na análise | grava progresso sem corrida e permite leitura parcial |
| Concorrência **global** de LLM | disparo escalonado por tempo | respeita o limite real do provedor e não depende de adivinhação de latência |
| Fila de análises | recusar com 429 | o usuário não perde o pedido nem precisa repetir a digitação |
| Cancelamento com `AbortSignal` | apenas marcar “cancelado” e ignorar respostas | evita gastar tokens e libera a vaga de verdade |
| `AnalysisStore` como interface | chamar Prisma direto no orquestrador | testes sem banco e modo demonstração |
| Texto externo delimitado e sanitizado | confiar no conteúdo da web | é a defesa central contra injeção de prompt |
| Fontes tipadas com confiabilidade | lista plana de links | permite ao pesquisador separar fato de opinião |
| Progresso calculado no servidor | contagem no cliente | sobrevive a refresh, múltiplas abas e aba oculta |
| Recorte como campo próprio | embutir no título | mantém o índice do histórico e o reaproveitamento corretos |

---

## 4. Concorrência e ciclo de vida

- **Limitador** (`async-utils.ts`): semáforo que envolve a chamada inteira, inclusive pausas de retry. Em 429, a fila desacelera junto.
- **Retry**: até 3 tentativas; não repete 400/401/403/404 nem abortos. Backoff exponencial para falhas transitórias e `Retry-After` quando o provedor informa.
- **Timeout**: `withTimeout` aborta a requisição HTTP de fato e diferencia timeout de cancelamento.
- **Cancelamento**: `AbortController` por execução; `execute` checa `signal.aborted` entre fases e as etapas não escrevem depois do aborto.
- **Reinício do servidor**: `reapOrphans()` marca como `interrupted` linhas ativas (inclusive `queued`) sem execução correspondente após 20 s de carência. O `retry` retoma.
- **Exclusão durante execução**: `deleteAnalysis` aborta e remove; escritas posteriores falham e são ignoradas por `safe()`.

---

## 5. Persistência

Contrato em `store.ts`:

```ts
create / get / list / listActive / update / updateAgent / delete / findLatestCompleted
```

- `store-prisma.ts` — produção; `updateAgent` usa `upsert` na chave composta `(analysisId, agentKey)`.
- `store-memory.ts` — testes e demonstração (`ANIMA_STORE=memory`); `structuredClone` nas leituras para evitar mutação acidental.
- `store-index.ts` — escolhe a implementação uma vez por processo (`globalThis`), com `setStore()` para testes.
- `findLatestCompleted` compara título normalizado (sem acento/caixa) **e** `kind`, `depth`, `hint`, `focus`.

---

## 6. Camada de LLM

`llm.ts` expõe `LLM { provider, model, complete() }`.

- `openai` — qualquer endpoint compatível (`/chat/completions`), com `AbortSignal`, `max_tokens` e `temperature`.
- `zai` — SDK carregado sob demanda (não pesa no bundle e não é exigido fora do ambiente Z.ai).
- `mock` — respostas determinísticas para testes, com `MOCK_DELAY_MS` e `MOCK_FAIL_LABELS` para simular falhas por etapa.

Erros viram `LLMError` com `status`, o que permite decidir entre repetir e orientar o usuário (chave inválida, modelo inexistente, rate limit).

---

## 7. Fontes

`search.ts`:

- orçamento por profundidade (`SOURCE_BUDGET`): nº máximo de fontes e caracteres por fonte;
- prioridade por origem (`user` > `openlibrary`/`tmdb` > `wikipedia` > `openalex` > `tavily` > `zai`);
- deduplicação por URL + título normalizado;
- `format()` monta o contexto com atributos (`tipo`, `confiabilidade`, `ano`) que o pesquisador usa para hierarquizar.

`user-sources.ts`:

- `isSafePublicUrl` — bloqueia loopback, privados, link-local, mDNS, credenciais na URL e hosts sem domínio;
- `safeFetch` — segue redirecionamentos manualmente validando cada destino;
- leitura limitada a 800 KB; HTML→texto remove script/style/nav/footer e decodifica entidades.

---

## 8. Front-end

- **Polling** (`use-analysis.ts`): 2 s enquanto ativo, pausa com a aba oculta, backoff até 15 s em erro e parada em estado terminal.
- **Formulário**: validação local leve + mensagens do servidor; mostra custo estimado (chamadas e minutos) antes de enviar.
- **Relatório**: sumário com scrollspy determinístico (sem `IntersectionObserver`), cartões por etapa, retry granular e aviso de parcialidade.
- **Histórico**: filtros no servidor, progresso e cancelamento na lista.

---

## 9. Como estender

| Quero | Onde mexer |
| --- | --- |
| Nova lente | `AGENT_KEYS` (types) + `SPECS` (prompts) + `AGENTS` (agent-meta) + migração de enum no schema (string livre, sem migração) |
| Novo provedor de fonte | `search.ts` (função que devolve `RawSource[]`) + `SOURCE_ORIGINS`/`ORIGIN_PRIORITY` + `/metodo` |
| Nova profundidade | `DEPTHS` + `DEPTH_LABELS` + `DEPTH_CONFIG` + `SOURCE_BUDGET` |
| Outro banco | implementar `AnalysisStore` e registrar em `store-index.ts` |
| Saída em PDF | partir de `export.ts` (Markdown) e renderizar no servidor |
| Debate entre lentes | nova fase no `execute()` consumindo `AgentResult` já persistidos |

Ao adicionar prompts, mantenha as seções obrigatórias (`# Papel`, `# Escopo`, `# Segurança`…) — há teste garantindo isso.
