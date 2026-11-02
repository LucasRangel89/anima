# Changelog — ANIMA

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento semântico enquanto o projeto estiver em `0.x`.

## [Não publicado]

Foco: **custo zero e robustez (Fase 1)**.

### Adicionado

- **`LLM_CONTEXT_TOKENS`** (padrão conservador `32768`): antes de cada etapa, o ANIMA estima tokens, reserva a saída e reduz o dossiê/análises para caber. Redução **determinística** em dois passos — condensar (títulos, listas e primeira frase de cada parágrafo) e, se ainda não couber, cortar cabeça/cauda com marcador explícito.
- **Avisos de contexto no relatório**: quando algo é reduzido, a análise registra o que aconteceu e o que fazer. Diagnóstico antecipado quando o contexto configurado é pequeno para a profundidade pedida.
- **`LLM_FALLBACK_MODEL`**: em 429 persistente (ou `Retry-After` acima de 60 s), a chamada é refeita uma única vez com o modelo alternativo; a análise conclui e o relatório diz qual modelo escreveu.
- **Contabilidade de uso por análise**: chamadas, tokens de entrada/saída, por etapa, com marca `estimated` quando o provedor não informa `usage`. Exibida na página da análise e na exportação em Markdown.
- **Presets gratuitos documentados** em `.env.example` — Gemini (endpoint OpenAI-compatível), Groq, OpenRouter `:free` e Ollama — com limites conferidos na documentação oficial e a data da conferência.
- **`npm run doctor`** passa a mostrar o contexto configurado e se há fallback.

- **Site de apresentação no GitHub Pages** (`npm run site:build` + `.github/workflows/pages.yml`), gerado a partir dos dados reais do produto e explicitamente separado do aplicativo, que exige servidor.
- **`ANIMA_ACCESS_TOKEN`** e `src/proxy.ts`: proteção por segredo único quando o app sai do localhost — páginas e API, cookie `HttpOnly` de 30 dias, comparação em tempo constante, token removido da URL após o primeiro acesso.
- **`Dockerfile`** + `.dockerignore` para hospedar num processo Node persistente, com `prisma db push` no start.
- **`docs/PUBLICAR.md`**: Wi-Fi, túnel e nuvem, com os limites de cada opção e o que ainda falta para multiusuário.
- **CI no GitHub Actions**: tipos, lint, testes (contrato do Prisma com banco real), auditoria de UI e build.
- `doctor` acusa publicação sem `ANIMA_ACCESS_TOKEN`.

### Alterado

- `LLM_CONCURRENCY` padrão: **3 → 2** (planos gratuitos devolvem 429 com três chamadas simultâneas).
- `Retry-After` aceita segundos e data HTTP (RFC 9110); esperas acima de 60 s não são obedecidas — disparam o fallback ou uma falha rápida e explicada.
- O prompt de síntese não corta mais o dossiê em 7 000 caracteres fixos: o orçamento é calculado em tokens, junto com as análises.
- Cliente LLM devolve `{ text, usage }` em vez de string; `withModel()` permite reusar endpoint/chave com outro modelo.
- Coluna `usage` (JSON) em `Analysis` — migração aditiva: `npm run db:push`.

### Fase 0 — verificação real

Foco: **verificação real (Fase 0)**.

#### Adicionado

- **`npm run doctor`**: diagnóstico do ambiente em segundos — client do Prisma e arquivo SQLite, provedor de LLM (com uma chamada real de 8 tokens), fontes abertas e porta 3000. Cada falha traz a próxima ação; `--offline` pula a rede.
- **`npm run audit:ui`**: contraste WCAG 2.1 dos pares de cor reais do tema (`oklch` → sRGB), em claro e escuro, mais auditoria do HTML servido (`<h1>` único, hierarquia de títulos, landmarks, nomes acessíveis, rótulos de campo).
- **`tests/search-network.test.ts`**: `gatherSources` contra respostas gravadas dos quatro provedores abertos, com orçamento por profundidade, provedor fora do ar e desambiguação.
- **`tests/llm-http.test.ts`**: cliente OpenAI-compatível contra um servidor HTTP local — corpo enviado, autenticação, `max_tokens`, `Retry-After`, erros fatais × recuperáveis, resposta vazia, aborto e URL base com prefixo.
- **`tests/store-contract.test.ts`**: contrato único de `AnalysisStore` exercitado na memória e, quando o banco está acessível, no Prisma; sem banco, a suíte do Prisma é pulada com motivo explícito.

#### Alterado

- README: seções de qualidade, `doctor` e `audit:ui`.

## [0.4.0] — 2026-11-02

Foco: **fontes, escopo, profundidade e fluxo**.

### Adicionado

- **Novas fontes**: Open Library (ficha bibliográfica), OpenAlex (crítica acadêmica) e TMDB opcional (ficha técnica de filmes e séries). Cada fonte carrega `kind`, `lang`, `year`, `author`, `publisher`, `reliability` e `note`.
- **Fontes do usuário**: até 5 links e/ou trechos colados no formulário, lidos pelo servidor e usados como fonte prioritária no dossiê.
- **Proteção de SSRF** em links do usuário: só `http(s)` públicos, redirecionamentos revalidados (máx. 3), 800 KB e 12 s por página; bloqueio de loopback, faixas privadas, link-local, mDNS e metadados de nuvem.
- **Recorte** (`focus`): capítulo, temporada, personagem ou aspecto, injetado nos três estágios do pipeline.
- **Seleção de lentes** (`agents`): de 1 a 8 especialistas; a síntese se ajusta ao número de análises disponíveis.
- **Quatro profundidades** (`brief`, `standard`, `deep`, `exhaustive`) com orçamento próprio de palavras, tokens (dossiê/especialista/síntese), volume de fontes e calibragem textual do argumento.
- **Fila de análises** (`ANIMA_MAX_QUEUE`, `queued`): pedidos excedentes esperam e começam sozinhos; posição exposta na API e na UI.
- **Cancelamento real** (`POST /api/analyses/:id/cancel`): `AbortController` por execução corta chamadas em curso; o texto já escrito é preservado e a análise pode ser retomada.
- **Progresso no servidor** (0–100) calculado por fase, exibido na análise e no histórico.
- **Histórico com filtros** por situação e meio, barra de progresso e cancelamento direto na lista.
- **Retomada de lentes faltantes** com um clique (“Gerar as N que faltam”).
- **Páginas de erro** (`not-found`, `error`) e metadados Open Graph.
- **Documentação**: README reescrito, `CHANGELOG`, `docs/ARQUITETURA.md`, `docs/METODO.md`, `CONTRIBUTING.md`.
- **Testes**: 47 casos (fila, cancelamento, recorte, profundidade, validação, SSRF/HTML, parsing de provedores, progresso, DTOs).

### Alterado

- `gatherSources` recebe profundidade e fontes do usuário; deduplica e prioriza por origem, respeitando orçamento de caracteres.
- O pesquisador agora hierarquiza fonte catalográfica × enciclopédia × crítica acadêmica × imprensa e separa **estado da crítica** de **lacunas do dossiê**.
- O mínimo de lentes para a síntese passa a ser `min(3, lentes selecionadas)`.
- `AnalysisSummaryDTO` e `AnalysisDTO` ganharam `focus`, `progress`, `queuePosition` e (no resumo) `totalAgents` reais.
- Schema Prisma aditivo: `focus` e `userSources`.
- `next.config.ts`, `.env.example`, `package.json` (scripts `check`, `db:studio`).

### Corrigido

- `withTimeout` agora aceita cancelamento externo e não confunde aborto com timeout.
- Escritas tardias após cancelamento/exclusão não sobrescrevem mais o estado final.
- `store.list` filtra no banco (status/meio) em vez de cortar depois.

### Removido

- Pasta `files/` (upload que duplicava a árvore do projeto) e `tests/search.test.ts` (dividido em `validation`, `sources` e `dto`).

---

## [0.3.0] — 2026-11-02

- Rotas reais (`/`, `/analise/[id]`, `/metodo`) e UI editorial completa.
- `llm.ts` independente do SDK Z.ai: provedores `openai` compatível, `zai` e `mock`.
- Persistência atrás de `AnalysisStore` (Prisma/SQLite e memória), com retomada de execuções interrompidas.
- Pipeline com 8 especialistas (dois novos: Narratológico e Crítico), concorrência global e Curador (síntese).
- Fontes: Wikipédia (pt/en) + Tavily opcional, com sanitização e delimitação.
- Testes com `node:test`, ESLint e typecheck.

## [0.2.0] — 2026-10

- MVP: 1 pesquisador + 6 especialistas, polling, histórico em SQLite e `python-reference/`.

## [0.1.0] — 2026-10

- Protótipo em Python (LangChain + Streamlit): `python-reference/`.
