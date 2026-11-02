# ANIMA — Analisador Narrativo Inteligente Multiagente

**Uma obra, oito lentes, uma leitura integrada.**

Um pesquisador, **oito especialistas** e um **curador** analisam qualquer obra narrativa — livro, filme, série, jogo, peça, quadrinhos — sob lentes distintas: estrutura, discurso, personagens, temas, estilo, psique, contexto e crítica ideológica. Cada análise cita teoria nomeada (autor, obra, ano), mostra a evidência na obra e termina declarando seus próprios limites.

> Versão atual: **0.4** · Node ≥ 20.9 · Next.js 16 · SQLite/Prisma ou memória

---

## O que a v0.4 acrescenta

| Área | O que mudou |
| --- | --- |
| **Fontes** | Open Library (ficha bibliográfica), OpenAlex (crítica acadêmica) e TMDB opcional (ficha técnica), além de Wikipédia e do que você enviar. Cada fonte chega ao dossiê com **tipo**, **ano**, **autoria** e **confiabilidade**. |
| **Escopo** | **Recorte** (capítulo, temporada, personagem, aspecto) e **seleção de lentes** — de 1 a 8, com custo e tempo proporcionais. |
| **Profundidade** | Quatro níveis: *Panorama* (350–500 palavras/lente), *Padrão*, *Aprofundada* e *Exaustiva* (1.800–2.400). A profundidade muda orçamento de tokens, volume de fontes e calibragem do argumento no prompt. |
| **Fluxo** | **Fila** de análises, **cancelamento real** (aborta chamadas em curso), **progresso** calculado no servidor, **retomada** após interrupção e histórico com filtros. |
| **Qualidade** | 47 testes (`node:test`), `typecheck` e `ESLint` limpos, documentação de arquitetura e método. |

Detalhes por versão em [CHANGELOG.md](./CHANGELOG.md).

---

## Início rápido

```bash
cp .env.example .env      # preencha LLM_API_KEY
npm install               # ou bun install
npm run db:push           # cria/atualiza o SQLite
npm run dev               # http://localhost:3000
```

### Modos de execução

```bash
# 1. Completo (banco + LLM real)
npm run dev

# 2. Sem banco: tudo em memória (some ao reiniciar)
ANIMA_STORE=memory npm run dev

# 3. Demonstração sem chave e sem custo: respostas fictícias
ANIMA_STORE=memory LLM_PROVIDER=mock npm run dev
```

O formulário avisa na própria página quando o LLM não está configurado ou quando está em modo demonstração.

### Atualizando de uma versão anterior

O schema é **aditivo** desde a v0.2 (`focus`, `userSources`, `synthesis`, `followUps`…). Rode `npm run db:push` com o mesmo `DATABASE_URL` e nada é perdido. Análises antigas continuam abrindo; lentes que não existiam aparecem como “não geradas” e podem ser executadas sob demanda — o botão **“Gerar as N que faltam”** aparece no relatório.

---

## Como funciona

```
┌────────────┐   ┌──────────────────┐   ┌───────────────────────┐   ┌─────────────┐
│  Pedido    │ → │  Pesquisador     │ → │  8 (ou N) especialistas│ → │  Curador    │
│  + fila    │   │  fontes → dossiê │   │  independentes        │   │  síntese    │
└────────────┘   └──────────────────┘   └───────────────────────┘   └─────────────┘
     título          Wikipédia              Estrutura · Discurso         tese de leitura
     recorte         Open Library           Personagens · Temas          convergências
     lentes          OpenAlex               Estilo · Psique              tensões
     profundidade    TMDB / Tavily          Contexto · Crítica           controle de consistência
                     + o que você enviar                                 para ir além
```

1. **Fila** — cada pedido entra imediatamente. Se já houver `ANIMA_MAX_ACTIVE` análises rodando, ele espera numa fila e começa sozinho; a posição aparece na tela.
2. **Pesquisa** — os provedores são consultados em paralelo. Um provedor fora do ar não derruba os outros; o dossiê registra lacunas em vez de inventar.
3. **Especialistas** — as lentes rodam com concorrência limitada (`LLM_CONCURRENCY`). Cada agente grava seu resultado ao terminar, então o relatório é legível enquanto é escrito.
4. **Síntese** — o Curador confronta as análises (com pelo menos 3 lentes, ou todas as pedidas quando são menos).
5. **Interrupção** — cancelar aborta as chamadas em curso, preserva o que já foi escrito e permite retomar depois.

O progresso de cada etapa é persistido separadamente: a falha de um especialista **não** aborta a análise, e execuções interrompidas por reinício do servidor viram `interrupted` e podem ser retomadas.

> **Deploy:** o pipeline roda em background no processo Node. Use servidor persistente (`npm run build && npm start`, Docker, VPS), **não** funções serverless.

---

## Fontes

| Provedor | Tipo | Chave | O que fornece | Confiabilidade atribuída |
| --- | --- | --- | --- | --- |
| Wikipédia (pt/en) | Enciclopédia | não | Enredo, contexto de produção, recepção | média |
| Open Library | Ficha bibliográfica | não | Autoria, 1ª publicação, editoras, páginas, assuntos | alta |
| OpenAlex | Crítica acadêmica | não | Artigos/capítulos, ano, veículo, citações, resumo | média |
| TMDB | Ficha técnica | `TMDB_API_KEY` | Direção, elenco, duração, temporadas, produção | média |
| Tavily | Imprensa e web | `TAVILY_API_KEY` | Resenhas, entrevistas, ensaios | média |
| Z.ai web_search | Web | provider `zai` | Busca genérica sem Tavily | baixa |
| Suas fontes | Prioritária | não | Links e trechos colados no formulário | alta (mas ainda dado a verificar) |

**Regras de segurança das fontes**

- Todo texto externo é **dado**, nunca instrução: é sanitizado (`<`/`>` neutralizados) e delimitado em `<fonte tipo="…" confiabilidade="…">`.
- Links enviados pelo usuário passam por verificação de SSRF: só `http(s)` públicos, redirecionamentos revalidados, limite de 800 KB e 12 s por página. `localhost`, faixas privadas, link-local e metadados de nuvem são bloqueados.
- O pesquisador é instruído a hierarquizar: ficha catalográfica vale como fato, crítica acadêmica vale como **posição** (diga quem defende), imprensa vale como recepção.

---

## Escopo e profundidade

### Escopo

| Controle | O que faz | Limite |
| --- | --- | --- |
| **Recorte** (`focus`) | Concentra a análise num capítulo, temporada, personagem ou aspecto, sem perder o contexto da obra. Entra nos prompts do pesquisador, dos especialistas e do curador. | 200 caracteres |
| **Lentes** (`agents`) | Escolha de 1 a 8 especialistas. Menos lentes = menos chamadas de LLM e resposta mais rápida; a síntese se ajusta ao que existe. | ≥ 1 |
| **Meio** (`kind`) | Ajusta o repertório formal: linguagem audiovisual, forma serial, agência do jogador, cena teatral, texto-imagem. | 8 opções |
| **Suas fontes** | Até 5 links e/ou trechos colados (mín. 40 caracteres), usados como fonte prioritária. | 5 itens |

### Profundidade

| Nível | Por lente | Fontes no dossiê | Duração típica | Calibragem do prompt |
| --- | --- | --- | --- | --- |
| **Panorama** | 350–500 palavras | até 5 | 2–4 min | uma tese, 2–3 evidências, leitura concorrente em uma frase |
| **Padrão** | 600–900 | até 6 | 4–8 min | tese principal + linha secundária, evidência por movimento |
| **Aprofundada** | 1.000–1.500 | até 8 | 8–15 min | 2–3 eixos, contraexemplos, diálogo com a crítica do dossiê |
| **Exaustiva** | 1.800–2.400 | até 10 | 15–30 min | quase um ensaio: estado da crítica, passagens detalhadas, balanço metodológico |

A profundidade também define o teto de tokens de cada etapa (dossiê, especialista, síntese) — está tudo em `DEPTH_CONFIG`, em `src/lib/anima/prompts.ts`.

---

## O que o relatório contém

- **Síntese do Curador** — tese de leitura, convergências, tensões e divergências, singularidade da obra, controle de consistência (contradições, itens com †, análises frágeis) e “para ir além”.
- **Dossiê do Pesquisador** — ficha da obra, sinopse com desfecho, personagens, elementos formais, contexto, recepção separando imprensa e academia, estado da crítica e lacunas.
- **As lentes escolhidas** — Markdown com subtítulos específicos da obra e a seção obrigatória `### Limites e verificações` (confiança, o que checar, lente não explorada).
- **Fontes** — lista com tipo, autoria, ano, confiabilidade e nota (ex.: “42 citações”).
- **Exportação** — `.md`, cópia para a área de transferência, impressão/PDF e **cofre para o Obsidian**.
- **Perguntas de acompanhamento** — ao fim do relatório, perguntas respondidas com o dossiê e as lentes já geradas (uma chamada ao modelo, sem nova pesquisa). As respostas ficam salvas na análise.

### Avaliar a qualidade do que sai (`npm run eval`)

Os testes provam que o pipeline funciona; não provam que o texto é bom. `npm run eval` roda **cinco obras de
referência** (livro brasileiro, clássico traduzido, filme, série e jogo) num modelo real e escreve
`eval-report.md`:

| Mede | Como | O que fazer com o sinal |
| --- | --- | --- |
| **Forma** | palavras por lente na faixa da profundidade (±25%), seção `### Limites e verificações`, quantidade de † | lente curta demais costuma ser lente genérica |
| **Referências** | cada `Autor, *Obra*, ano` e `Autor (ano)` conferido na Open Library e no Crossref | `duvidosa` pede conferência manual antes de citar |
| **Cobertura** | o relatório tem dossiê, síntese e todas as lentes pedidas | buraco aqui é bug, não estilo |

Nada reprova automaticamente: o relatório aponta e você decide. `--offline` pula a conferência de referências;
`--mock` roda o encanamento sem custo (e o relatório diz que não vale como avaliação). Fora do `npm test` e do
CI de propósito: gasta cota real.

### Comparar duas obras

A rota `/comparar` lê dois relatórios prontos e escreve **uma** leitura cruzada, em quatro seções: o que
aproxima, o que separa, o que uma ilumina na outra e o veredito. Usa dossiê e síntese de cada análise — não
refaz o pipeline nem gasta oito lentes por obra.

- Comparação é registro próprio (`Comparison`), com histórico, download `.md` e remoção.
- Títulos ficam gravados no registro: se uma das análises for apagada, a comparação continua legível.
- Mesmo regime de contexto do resto: o material dos dois lados é reduzido de forma determinística para caber
  em `LLM_CONTEXT_TOKENS`, sem chamada extra para resumir.
- Custo: **uma** chamada ao modelo, com retry em 429 e `LLM_FALLBACK_MODEL`.

### Perguntas de acompanhamento

Depois de ler, a pergunta natural é “e daí?”. A caixa ao fim do relatório responde com o **material já pago** —
dossiê e lentes desta análise — em uma única chamada ao modelo, sem nova pesquisa e sem refazer o pipeline.

- As **sugestões** dependem do que a análise realmente tem: sem a lente Crítica, não aparece “qual é a objeção
  mais forte”.
- O prompt proíbe inventar títulos, datas e citações; o que vem de fora do material leva **†**, como no resto
  do relatório.
- Se a pergunta pede algo fora do recorte, a resposta diz o que falta e qual recorte resolveria.
- As respostas são **salvas na análise** (`followUps`, JSON): sobrevivem a recarregar, podem ser removidas e
  têm teto de 30 por análise para não virarem um chat infinito.
- Custo: uma chamada por pergunta, registrada no mesmo lugar que as demais.

### Exportar para o Obsidian

O botão **Para o Obsidian** baixa um `.zip` com **uma nota por lente**, mais o índice e o dossiê, ligadas por
`[[wikilinks]]`. Descompacte dentro do seu cofre e o Obsidian monta o grafo sozinho:

```
Dom Casmurro.md                    ← índice: síntese, links para as notas, fontes
Dom Casmurro - Dossiê.md
Dom Casmurro - Estrutura.md        ← uma por lente executada
Dom Casmurro - Personagens.md …
```

Cada nota tem frontmatter (`tags`, `obra`, `lente`, `papel`, `data`, `modelo`) para filtrar por tag ou por
obra, e acentos são preservados. O zip não usa compressão nem dependência externa (`src/lib/anima/zip.ts`),
e nomes de arquivo são limpos do que o Windows e o próprio Obsidian recusam (`:`, `?`, `#`, `[[`).

**Marcação de incerteza:** toda afirmação factual que **não** vem do dossiê leva `†`. As análises só fazem citação literal quando o trecho está no dossiê.

---

## Interface

| Rota | O que é |
| --- | --- |
| `/` | Formulário (obra, recorte, lentes, profundidade, fontes), histórico com filtros e painel de especialistas |
| `/analise/[id]` | Monitor ao vivo (progresso, fila, cancelar) e relatório com sumário, scrollspy, retry por lente |
| `/comparar` | Leitura cruzada de duas análises concluídas, com histórico e download em Markdown |
| `/metodo` | Princípios de rigor, fluxo, fontes, profundidades, referenciais de cada especialista e limites |

Acessibilidade: navegação por teclado, `aria-live` no progresso, contrastes e tema claro/escuro, sumário com `aria-current` e impressão sem elementos de interface.

---

## API

Todas as rotas usam o runtime Node e validam entrada com zod.

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/analyses` | Cria análise (ou enfileira). Reaproveita análise concluída equivalente, salvo `force: true`. |
| `GET` | `/api/analyses?status=&kind=&limit=` | Histórico filtrado + ocupação da fila |
| `GET` | `/api/analyses/:id` | DTO com progresso, posição na fila, fontes e resultados |
| `DELETE` | `/api/analyses/:id` | Exclui (cancela escritas pendentes) |
| `POST` | `/api/analyses/:id/retry` | Reexecuta pesquisa, lentes específicas e/ou síntese |
| `POST` | `/api/analyses/:id/cancel` | Cancela (na fila ou em andamento) preservando o que existe |
| `GET` | `/api/status` | Provedor, modelo, fontes ativas e fila |

```bash
# criar com recorte, duas lentes e uma fonte própria
curl -X POST http://localhost:3000/api/analyses \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Dom Casmurro",
    "hint": "Machado de Assis, 1899",
    "kind": "book",
    "depth": "deep",
    "focus": "a personagem Capitu",
    "agents": ["structural", "thematic"],
    "sources": [{ "type": "text", "value": "Capitu olha de soslaio; o narrador insiste na tese de traição." }]
  }'

# acompanhar
curl http://localhost:3000/api/analyses/<id>

# cancelar / retomar
curl -X POST http://localhost:3000/api/analyses/<id>/cancel
curl -X POST http://localhost:3000/api/analyses/<id>/retry -H 'Content-Type: application/json' -d '{}'
```

Respostas de erro: `400` entrada inválida · `404` não encontrada · `409` já em execução / nada a cancelar · `429` fila cheia · `503` LLM não configurado.

---

## Arquitetura

```
src/
├─ app/                    # rotas e API (Next.js App Router)
│  ├─ page.tsx             # início
│  ├─ analise/[id]/        # relatório
│  ├─ metodo/              # método
│  └─ api/                 # analyses (CRUD, retry, cancel), status
├─ components/anima/       # UI (formulário, relatório, histórico, cartões)
├─ hooks/use-analysis.ts   # polling com backoff, pausa em aba oculta
└─ lib/anima/
   ├─ orchestrator.ts      # fila, pipeline, cancelamento, retomada
   ├─ prompts.ts           # teoria: papel, escopo, repertório, roteiro, armadilhas
   ├─ search.ts            # provedores de fonte, orçamento, deduplicação
   ├─ user-sources.ts      # links do usuário: SSRF, HTML→texto, limites
   ├─ llm.ts               # openai-compatível, zai, mock; erros tipados
   ├─ store*.ts            # contrato de persistência + Prisma + memória
   ├─ dto.ts / export.ts   # DTOs, progresso, exportação Markdown
   └─ types.ts             # contratos compartilhados (client-safe)
```

Decisões em detalhe: [docs/ARQUITETURA.md](./docs/ARQUITETURA.md). Teoria e prompts: [docs/METODO.md](./docs/METODO.md).

### Modelo de dados

```
Analysis 1 ─── N AgentResult
  id, title, hint, focus, kind, depth, status,
  research, researchStatus, sources (JSON), userSources (JSON),
  synthesis, synthesisStatus, error, durationMs, model,
  createdAt, updatedAt
                agentKey (8), status, content, error, durationMs  @@unique(analysisId, agentKey)
```

Uma linha por lente permite gravar progresso sem corrida de escrita e recuperar resultados parciais.

---

## Configuração

| Variável | Padrão | Função |
| --- | --- | --- |
| `DATABASE_URL` | `file:../db/anima.db` | SQLite (relativo a `prisma/`) |
| `ANIMA_STORE` | — | `memory` dispensa banco |
| `LLM_PROVIDER` | auto | `openai` (qualquer API compatível), `zai`, `mock` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | `api.openai.com/v1` / — / `gpt-4o-mini` | OpenAI, OpenRouter, Groq, Ollama, Gemini (endpoint OpenAI), GLM… |
| `LLM_FALLBACK_MODEL` | — | Modelo alternativo (mesmo endpoint) usado em 429 persistente |
| `LLM_CONTEXT_TOKENS` | `32768` | Contexto do modelo; dossiê e síntese são reduzidos para caber, com aviso |
| `LLM_CONCURRENCY` | `2` | Chamadas simultâneas **globais**. Use `1` em planos gratuitos |
| `LLM_TIMEOUT_SECONDS` | `180` | Timeout por chamada |
| `ANIMA_MAX_ACTIVE` | `3` | Análises simultâneas; o excedente vai para a fila |
| `ANIMA_MAX_QUEUE` | `8` | Tamanho máximo da fila |
| `TMDB_API_KEY` | — | Ficha técnica de filmes e séries |
| `TAVILY_API_KEY` | — | Resenhas e crítica de imprensa |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Metadados/Open Graph |
| `ANIMA_ACCESS_TOKEN` | — | Segredo único exigido quando o app sai do localhost |
| `ANIMA_RATE_LIMIT` | `on` | `off` desliga os limites de uso |
| `ANIMA_RATE_LIMIT_ANALYSES` / `_EXTRA` | `20` / `120` | Teto por hora, por processo (`0` desliga) |

O modelo precisa de contexto de pelo menos ~32k tokens (a síntese recebe as análises das lentes). Se o seu tiver menos, o ANIMA reduz o material, avisa no relatório e continua — nada quebra.

### Provedores gratuitos, sem cartão

O `.env.example` traz blocos prontos para **Gemini** (endpoint OpenAI-compatível), **Groq**, **OpenRouter** (`:free`) e **Ollama** (local). Três ressalvas que valem mais que qualquer preset:

- **Os limites mudam.** Os números abaixo foram conferidos na documentação oficial em 02/11/2026; os links são a fonte viva.
- **Groq**: `openai/gpt-oss-120b` tem 30 req/min, 1.000 req/dia e **8.000 tokens/min** ([docs](https://console.groq.com/docs/rate-limits)). O teto por minuto é o que morde: uma análise Padrão (10 chamadas) já passa disso, então use **Panorama** e `LLM_CONCURRENCY=1`.
- **OpenRouter** (`:free`, conta sem crédito comprado): 20 req/min e **50 req/dia** ([docs](https://openrouter.ai/docs/api-reference/limits)) — cerca de 5 análises Padrão por dia.
- **Gemini**: a camada gratuita existe, mas os limites variam por modelo e são mostrados na sua conta ([AI Studio](https://aistudio.google.com/rate-limit)); o ANIMA não fixa números que a Google não publica.
- **Ollama**: sem limite e sem chave; o custo é a RAM da sua máquina.

**Custo em chamadas:** cada análise faz `lentes + 2` chamadas (dossiê + uma por lente + síntese). Panorama com 4 lentes = 6; Padrão com 8 = 10. O relatório mostra quantas chamadas e quantos tokens foram gastos, e avisa quando o contexto precisou ser reduzido.

---

## Qualidade

```bash
npm test          # 166 testes (node:test)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run check     # os três em sequência
npm run eval      # qualidade real: 5 obras contra o modelo configurado (opt-in, custa chamadas)
npm run doctor    # diagnóstico do ambiente (banco, modelo, fontes, porta)
npm run audit:ui  # contraste WCAG do tema + estrutura das páginas
```

Cobertura de testes: pipeline completo (mock), fila, cancelamento, retomada, falhas parciais, reaproveitamento, seleção de lentes, recorte nos prompts, calibragem de profundidade, validação de entrada, SSRF/HTML, parsing de provedores, cálculo de progresso e exportação. Além disso:

- **`tests/search-network.test.ts`** exercita `gatherSources` contra respostas reais gravadas dos quatro provedores abertos (extrato longo, provedor fora do ar, página de desambiguação, orçamento por profundidade) sem tocar a rede.
- **`tests/llm-http.test.ts`** sobe um servidor HTTP local compatível com OpenAI e confere o que o cliente realmente envia (modelo, mensagens, `max_tokens`, autenticação), `Retry-After`, erros fatais × recuperáveis e resposta vazia.
- **`tests/store-contract.test.ts`** roda a mesma suíte de contrato contra o store de memória **e** contra o Prisma. Na memória, sempre. No Prisma, quando `DATABASE_URL` e o client gerado estiverem disponíveis — caso contrário a suíte do banco é **pulada com motivo**, nunca passada em silêncio.
- **`tests/budget.test.ts`** prova que a estimativa de tokens é conservadora, que a redução é determinística e que nenhum prompt passa do contexto configurado.
- **`tests/fallback.test.ts`** sobe um servidor que devolve 429 com `Retry-After` de 15 minutos e verifica que a análise **termina com o modelo alternativo** (e que, sem alternativo, falha rápido e com mensagem clara — sem ficar horas esperando).
- **`tests/eval.test.ts`** protege a própria régua: contagem de palavras, faixa por profundidade, seção "Limites e verificações" e a verificação de referências — que **nunca** transforma "sem rede" ou "outro autor com o mesmo ano" em "confirmada".
- **`tests/eval.test.ts`** cobre a régua de qualidade: contagem de palavras, seção obrigatória, marca †, extração de referências nos dois formatos e conferência contra Open Library/Crossref com respostas simuladas — inclusive o caso em que a base está fora do ar, que **nunca** vira "confirmada".
- **e2e com Playwright** (`tests/e2e/`): navegador de verdade percorrendo o caminho principal — formulário, relatório, pergunta de acompanhamento, download do cofre Obsidian, tema, `/comparar` (gerar, recarregar, baixar e remover). Roda no CI (`npm run e2e` localmente), com provedor mock e store em memória.
- **CI no GitHub Actions** (`.github/workflows/ci.yml`): tipos, lint, testes com o contrato do Prisma rodando de verdade, auditoria de UI, build e **e2e** — a cada push e pull request.

### Avaliar a qualidade do que sai (`npm run eval`)

`npm test` prova que o pipeline funciona; não prova que a prosa é boa. `npm run eval` roda **cinco obras de
referência** (livro brasileiro, romance estrangeiro, filme, série, jogo) no modelo que você configurou e
escreve `eval/relatorio.md`:

| Verificação | O que olha |
| --- | --- |
| **Forma** | cada lente dentro da faixa de palavras da profundidade escolhida (±25%), com a seção "Limites e verificações" e marcadores † |
| **Cobertura** | termos que uma análise honesta daquela obra quase certamente toca (ex.: Capitu e Bento, em *Dom Casmurro*) |
| **Referências** | cada "Autor, *Obra*, ano" e "Autor (ano)" conferido na Open Library e no Crossref: `confirmada`, `duvidosa` ou `nao_verificada` |

Nada disso reprova automaticamente — o relatório sinaliza, você decide. Sem rede, as referências ficam
`nao_verificada` (jamais "confirmadas" por omissão). Custa chamadas reais: fica fora de `npm test` e fora do CI,
e `npm run eval -- --mock` só serve para conferir o encanamento.

### Site publicado (apresentação)

O repositório publica uma **página de apresentação** em <https://lucasrangel89.github.io/anima/>, gerada por
`npm run site:build` a partir dos mesmos dados do produto (lentes, profundidades, fontes) e enviada pelo
workflow `.github/workflows/pages.yml`.

Ela **não executa o aplicativo**: o ANIMA precisa de um processo Node para falar com o modelo e manter a
fila. GitHub Pages serve apenas arquivos estáticos. Para analisar obras de qualquer aparelho, veja
[`docs/PUBLICAR.md`](docs/PUBLICAR.md).

### Publicar e usar de qualquer aparelho

O ANIMA roda num processo Node persistente, então **GitHub Pages não serve** (ele publica arquivos parados).
O guia [`docs/PUBLICAR.md`](docs/PUBLICAR.md) cobre os três caminhos reais, em ordem de dificuldade: celular
na mesma rede Wi-Fi, túnel a partir do seu computador e hospedagem em nuvem com o `Dockerfile` deste
repositório.

Há ainda dois limites em memória, por hora e por processo (20 análises, 120 perguntas/comparações), ajustáveis
por `ANIMA_RATE_LIMIT_*` — eles não substituem o token, apenas impedem que um script queime sua cota.

Publicado fora do localhost, **defina `ANIMA_ACCESS_TOKEN`**: um token único protege páginas e API (cookie
`HttpOnly`, comparação em tempo constante). Sem ele, qualquer pessoa com o endereço pode consumir sua cota
de LLM e ler suas análises — o `doctor` acusa isso.

### `npm run doctor`

Verifica em segundos as quatro coisas que mais quebram uma instalação nova: o client do Prisma e o arquivo SQLite, o provedor de LLM (com uma chamada real de 8 tokens), as fontes abertas e se a porta 3000 está livre. Cada item diz o que fazer quando falha. Use `--offline` para pular as checagens de rede.

### `npm run audit:ui`

Calcula o contraste WCAG 2.1 dos pares de cor reais do tema (converte o `oklch` de `globals.css` para sRGB), em claro e escuro, e analisa o HTML servido: `<h1>` único, hierarquia de títulos, landmarks, nomes acessíveis de botões/links e rótulos de campos. Não substitui um teste visual: layout, espaçamento e sobreposição precisam de navegador.

> `npm run build` executa `prisma generate` antes do build; ele baixa engines do Prisma na primeira vez (requer rede).
> O `typecheck` também depende desse client: rode `npm run db:generate` antes de `npm run check` numa máquina nova.

---

## Limites e ética

- **Conteúdo gerado por IA.** Os modelos não leram nem assistiram à obra nesta tarefa: trabalham com o dossiê e conhecimento prévio. Tudo que não vem do dossiê é marcado com `†`.
- **Referências podem estar imprecisas** (edição, ano, página). Verifique antes de citar em trabalho acadêmico.
- **Interpretação, não veredito.** As lentes disputam entre si de propósito; o Curador avalia quem argumenta melhor, não quem está “certo”.
- **Obras obscuras** têm dossiês mais pobres — o relatório declara a confiança e as lacunas.
- **Links que você envia** são lidos pelo servidor. Envie apenas páginas públicas que você tem o direito de consultar.
- **Custo** é do usuário: cada lente é uma chamada ao provedor. Use *Panorama* e menos lentes para explorar.

---

## Estrutura do repositório

```
anima/
├─ src/                    # aplicação Next.js (ver Arquitetura)
├─ prisma/schema.prisma    # modelo de dados (SQLite)
├─ db/                     # arquivo do banco (ignorado pelo git)
├─ tests/                  # node:test + scripts de runtime
├─ docs/                   # arquitetura, método e publicação
├─ python-reference/       # referência histórica da v0.1 (não acompanha os prompts atuais)
├─ .env.example            # todas as variáveis, comentadas
├─ CHANGELOG.md            # histórico por versão
└─ worklog.md              # diário de construção do projeto
```

---

## Roadmap

- **v0.5 (proposto)** — comparação entre duas obras; debate explícito entre lentes (réplica e tréplica); avaliação automática de citações contra o dossiê.
- **Proposta registrada** — trocar Prisma por SQLite direto (sem executar): [`docs/PROPOSTA-SQLITE.md`](docs/PROPOSTA-SQLITE.md).
- **Depois** — autenticação e multiusuário; exportação PDF com tipografia editorial; provedores de fonte adicionais (Crossref, Google Books, Internet Archive); cache de dossiês por obra.

Sugestões e correções são bem-vindas em issues.

---

## Créditos

Projeto de Lucas Rangel. A base teórica de cada lente está declarada em `/metodo` e em `docs/METODO.md`; o repertório é editável em `prompts.ts` e em `agent-meta.ts`.
