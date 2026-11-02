# ANIMA — Analisador Narrativo Inteligente Multiagente

Um pesquisador, **oito especialistas** e um **curador** analisam qualquer obra narrativa (livro, filme, série, jogo, peça, quadrinhos):
estrutura, discurso, personagens, temas, estilo, psique, contexto e crítica ideológica, mais uma síntese integrada.
Cada análise cita teoria nomeada (autor, obra, ano), mostra a evidência na obra e termina com seus próprios limites.

## Início rápido

```bash
cp .env.example .env        # preencha LLM_API_KEY (ou use LLM_PROVIDER=mock para testar sem custo)
npm install                 # (ou bun install)
npm run db:push             # cria/atualiza o SQLite
npm run dev                 # http://localhost:3000
```

Modo demonstração sem banco nem chave: `ANIMA_STORE=memory LLM_PROVIDER=mock npm run dev`.

### Atualizando da v0.2
O schema mudou de forma **aditiva**. Para manter seus dados, use `DATABASE_URL="file:../db/custom.db"` e rode `npm run db:push`.
Análises antigas continuam abrindo; os dois especialistas novos aparecem como "não gerados" e podem ser executados sob demanda.

## Configuração

| Variável | Função |
| --- | --- |
| `LLM_PROVIDER` | `openai` (qualquer API compatível com OpenAI), `zai` (SDK Z.ai) ou `mock` |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | OpenAI, OpenRouter, Groq, Ollama, Gemini (endpoint OpenAI), GLM… |
| `LLM_CONCURRENCY` | Chamadas simultâneas, **global** (padrão 3). Reduza em caso de erro 429 |
| `LLM_TIMEOUT_SECONDS` | Timeout por chamada (padrão 180) |
| `TAVILY_API_KEY` | Opcional: resenhas e críticas. Sem ela, usa a Wikipédia (pt/en) |
| `ANIMA_MAX_ACTIVE` | Análises simultâneas (padrão 3) |

O modelo precisa de contexto de pelo menos ~32k tokens (a síntese recebe as oito análises).

## Arquitetura

```
Pesquisador (fontes → dossiê)  →  8 Especialistas (concorrência limitada)  →  Curador (síntese)
```

| Camada | Arquivos (`src/lib/anima/`) |
| --- | --- |
| Orquestração | `orchestrator.ts`: pipeline, retry granular, retomada, exclusão segura |
| LLM | `llm.ts`: provedores `openai`, `zai`, `mock`; erros tipados (401/429…) |
| Fontes | `search.ts`: Wikipédia, Tavily; texto externo é tratado como **dado**, nunca instrução |
| Conteúdo teórico | `prompts.ts`: papel, escopo, repertório, roteiro e armadilhas de cada agente |
| Persistência | `store.ts` (contrato), `store-prisma.ts`, `store-memory.ts` |
| API | `src/app/api/**`, validada com zod |
| UI | `src/app/**`, `src/components/anima/**` |

O progresso de cada agente é persistido separadamente (a UI mostra as seções prontas enquanto as demais são escritas);
a falha de um especialista não aborta a análise; execuções interrompidas (servidor reiniciado) viram `interrupted` e podem ser retomadas.

> **Deploy:** o pipeline roda em background no processo Node. Use servidor persistente (`npm run build && npm start`, Docker, VPS), **não** funções serverless.

**API:** `POST/GET /api/analyses` · `GET/DELETE /api/analyses/:id` · `POST /api/analyses/:id/retry` · `GET /api/status`

## Ajustando a teoria
Edite `SPECS` em `prompts.ts` (repertório, roteiro, armadilhas) e `agent-meta.ts` (resumos exibidos em `/metodo`).

## Qualidade
```bash
npm test && npm run typecheck && npm run lint
```

## Limites
Conteúdo gerado por IA: os modelos não leram a obra e podem errar fatos e referências (o que vem de fora do dossiê é marcado com †).
`python-reference/` é a referência histórica da v0.1 e **não** acompanha os prompts atuais.
