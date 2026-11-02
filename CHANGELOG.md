# Changelog — ANIMA

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versionamento semântico enquanto o projeto estiver em `0.x`.

## [Não publicado]

Foco: **verificação real (Fase 0)**.

### Adicionado

- **`npm run doctor`**: diagnóstico do ambiente em segundos — client do Prisma e arquivo SQLite, provedor de LLM (com uma chamada real de 8 tokens), fontes abertas e porta 3000. Cada falha traz a próxima ação; `--offline` pula a rede.
- **`npm run audit:ui`**: contraste WCAG 2.1 dos pares de cor reais do tema (`oklch` → sRGB), em claro e escuro, mais auditoria do HTML servido (`<h1>` único, hierarquia de títulos, landmarks, nomes acessíveis, rótulos de campo).
- **`tests/search-network.test.ts`**: `gatherSources` contra respostas gravadas dos quatro provedores abertos, com orçamento por profundidade, provedor fora do ar e desambiguação.
- **`tests/llm-http.test.ts`**: cliente OpenAI-compatível contra um servidor HTTP local — corpo enviado, autenticação, `max_tokens`, `Retry-After`, erros fatais × recuperáveis, resposta vazia, aborto e URL base com prefixo.
- **`tests/store-contract.test.ts`**: contrato único de `AnalysisStore` exercitado na memória e, quando o banco está acessível, no Prisma; sem banco, a suíte do Prisma é pulada com motivo explícito.

### Alterado

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
