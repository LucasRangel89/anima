# Worklog — Projeto ANIMA

Diário de construção: o que foi feito, o que foi verificado e por que certas decisões foram tomadas.

---

## v0.4 — fontes, escopo, profundidade e fluxo

**Contexto.** A v0.3 entregou a base (rotas, 8 lentes, síntese, persistência). A v0.4 avança quatro frentes pedidas explicitamente: fontes, escopo, profundidade e fluxo — com documentação e testes acompanhando.

### Fontes

- Catálogo de provedores em `search.ts`, cada um degradando de forma independente (`Promise.allSettled`):
  - **Open Library** — ficha catalográfica (autoria, 1ª publicação, editoras, páginas, assuntos), gratuita e sem chave;
  - **OpenAlex** — crítica acadêmica (título, ano, veículo, citações, DOI, resumo reconstruído do índice invertido);
  - **TMDB** (opcional) — ficha técnica de filmes e séries;
  - Wikipédia, Tavily e Z.ai mantidos.
- `SourceDTO` ganhou `kind`, `lang`, `year`, `author`, `publisher`, `reliability` e `note`. O contexto do prompt agora leva esses atributos em cada `<fonte>`, e o pesquisador é instruído a hierarquizar fato catalogado × enciclopédia × crítica acadêmica × imprensa.
- **Fontes do usuário**: até 5 links e/ou trechos, lidos no servidor (`user-sources.ts`) com proteção de SSRF (http(s) públicos, redirecionamentos revalidados, 800 KB/12 s) e conversão de HTML em texto.
- Orçamento de fontes por profundidade (`SOURCE_BUDGET`) e prioridade por origem.

### Escopo

- Campo **recorte** (`focus`) persistido e injetado nas três fases do pipeline.
- **Seleção de lentes**: 1 a 8; só as escolhidas entram no banco; as demais aparecem como `skipped` e podem ser geradas depois (“Gerar as N que faltam”).
- A síntese passa a exigir `min(3, lentes pedidas)`.

### Profundidade

- Quatro níveis (`brief`, `standard`, `deep`, `exhaustive`) com: faixa de palavras, teto de tokens do especialista, teto da síntese, teto do dossiê, nº máximo de fontes e uma **calibragem textual** específica injetada no prompt.
- `DEPTH_LABELS` (UI) e `DEPTH_CONFIG` (prompt) são verificados por teste para não divergirem.

### Fluxo

- **Fila**: `queued` + `ANIMA_MAX_QUEUE`; `drainQueue()` libera a próxima ao terminar uma execução. Posição exposta em `/api/analyses`, `/api/status` e na UI.
- **Cancelamento real**: um `AbortController` por execução; `withTimeout` passou a aceitar sinal externo; o cancelamento aborta chamadas em curso, preserva o texto já escrito e permite retomar.
- **Progresso** calculado no servidor (`computeProgress`) com pesos por fase, usado na análise e no histórico.
- **Histórico** com filtros por situação e meio, progresso e cancelamento na lista.
- Páginas `not-found` e `error`, metadados Open Graph.

### Verificação

- `npm test` → **47 testes** (pipeline, fila, cancelamento, retomada, recorte, profundidade, validação, SSRF/HTML, parsing de fontes, progresso, DTOs).
- `npm run lint` e `tsc --noEmit` limpos (ressalva: `store-prisma.ts` depende do client gerado pelo Prisma; `prisma generate` não roda no sandbox por falta de acesso a `binaries.prisma.sh`).
- Teste funcional com servidor real em modo `mock`: criação, enfileiramento (posição 1), conclusão das duas análises, cancelamento no meio (estado `interrupted`, 6 lentes preservadas, 2 marcadas como canceladas) e `409` ao cancelar de novo.

### Decisões

- **Fila em vez de 429**: recusar o pedido faz o usuário perder a digitação; a fila em processo é simples e resolve.
- **Cancelar abortando**: marcar “cancelado” sem abortar continuaria consumindo tokens.
- **Progresso no servidor**: sobrevive a refresh, aba oculta e múltiplas abas.
- **OpenAlex sem filtro por título**: estudos acadêmicos raramente repetem o título da obra (“Machado e o romance da suspeita”); o pesquisador pondera o resumo.
- **Fontes do usuário com prioridade**: se a pessoa enviou, é porque importa — mas continua sendo dado a verificar.

---

## v0.3 — revisão estrutural (UX/UI, arquitetura, profundidade teórica)

- Rotas reais (`/`, `/analise/[id]`, `/metodo`), LLM independente do SDK Z.ai, persistência atrás de interface, concorrência global, Curador (síntese), 8 especialistas com repertório teórico, retomada de execuções interrompidas, testes.
- Entrega enviada em `files/` (patch + árvore); aplicada e verificada (`git apply --check`, `diff -rq`, testes e lint). A pasta foi removida do repositório por duplicar o projeto e quebrar typecheck/build.

---

## v0.2 — MVP (1 pesquisador + 6 especialistas)

**Task ID: 1** · agente: Z.ai Code (agente principal)

- Estudo do SDK z-ai (chat completions + `functions.invoke('web_search')`), validado com busca sobre Dom Casmurro.
- Modelagem Prisma (SQLite): `Analysis` (pipeline, dossiê, duração) + `AgentResult` (uma linha por especialista — progresso individual sem corridas de escrita).
- Backend: `types.ts`, `agent-meta.ts`, `prompts.ts`, `orchestrator.ts` (2 buscas paralelas → dossiê → 6 especialistas em paralelo → consolidação), `dto.ts` e rotas de API.
- Frontend: identidade editorial (Fraunces + Inter, papel/carvão/âmbar), três visões (início, monitoramento ao vivo, relatório), polling de 1,6 s, download `.md`.
- **Descoberta importante**: 6 chamadas simultâneas estouravam o rate limit (429 em 2 agentes). Corrigido com disparo escalonado, backoff adaptativo e 3 tentativas; depois substituído por limitador global na v0.3.
- Verificação end-to-end com análise visual (home desktop/mobile/dark, monitoramento, relatório, scrollspy, copiar, rodapé fixo), zero erros de console.
- `python-reference/` com a implementação de referência do blueprint (LangChain + asyncio + Streamlit), sintaxe validada.
- Próximos passos sugeridos na época: debate entre agentes, comparação entre obras, autenticação, exportação PDF — parcialmente absorvidos nas versões seguintes.

## Fase 0 — verificação real (2026-11-02)

Ambiente de verificação: container Linux sem navegador, sem `apt`/root e com saída de rede limitada ao
registro npm. Isso define o que pôde ser comprovado e o que ficou para a máquina do usuário.

**Comprovado por execução**

- `npm ci` (538 pacotes), `tsc --noEmit` (0 erros, incluindo `store-prisma.ts`) e `next build` (10 rotas).
- Pipeline completo com `LLM_PROVIDER=mock` + `ANIMA_STORE=memory`: livro e filme, 8/8 lentes, dossiê e síntese,
  progresso 100, console do servidor sem erros de aplicação.
- Fila real: `ANIMA_MAX_ACTIVE=2` → terceira análise `queued` com `queuePosition: 1`, cancelamento da fila
  (`interrupted` + mensagem de retomada), `409` ao cancelar o que já terminou, `400` ao reexecutar o que não
  precisa, `503` sem chave configurada.
- Aviso de primeira execução passa a ser renderizado no servidor (`getSystemStatus()` em `page.tsx`),
  e não mais apenas depois da hidratação.
- Contraste WCAG dos dez pares de cor do tema em claro e escuro (menor razão: 4,59:1 — AA) e estrutura das
  rotas `/` e `/metodo` (um `<h1>`, hierarquia sem saltos, landmarks, rótulos).

**Não verificável neste ambiente** (exige rede aberta, engines do Prisma ou navegador)

- `prisma generate`/`db push` com engines reais; execução do `store-prisma.ts` contra SQLite de verdade.
  Contorno usado: `prisma generate --no-engine` apenas para checar tipos. Por isso o teste de contrato do
  store é **pulado com motivo** quando não há banco.
- Chamada real a um LLM (Gemini/Groq/OpenRouter/Ollama) e busca real (Wikipédia/Open Library/OpenAlex).
  O caminho foi coberto de outro jeito: `tests/llm-http.test.ts` contra um servidor OpenAI-compatível local e
  `tests/search-network.test.ts` com respostas gravadas dos provedores.
- Interface renderizada em 1280px/390px, claro/escuro. Chromium foi baixado (`@sparticuz/chromium`), mas não
  executa sem `libnspr4`/`libnss3` e não há root para instalá-las. O que deu para checar sem navegador está em
  `npm run audit:ui`.
- Tipografia real: `next/font/google` não baixa Fraunces/Inter aqui; o preview cai em fontes de sistema.

## Fase 1 — custo zero e robustez (2026-11-02)

**O que guiou as decisões**

- Limites de provedores gratuitos só entram na documentação depois de conferidos na fonte oficial, com data:
  Groq (`openai/gpt-oss-120b`: 30 req/min, 1.000 req/dia, **8k TPM**) e OpenRouter (`:free`: 20 req/min,
  **50 req/dia**). Para Gemini, a Google não publica tabela fixa — o `.env.example` aponta o AI Studio em vez
  de inventar números. Ollama não tem limite, tem RAM.
- O gargalo real não é o contexto: é **tokens por minuto**. Uma análise Padrão faz 10 chamadas; no Groq isso
  passa de 8k TPM em poucos minutos. Daí `LLM_CONCURRENCY` padrão 2 e a recomendação de 1 nos gratuitos.

**Implementado**

- `budget.ts`: estimativa conservadora (3 caracteres/token), condensação determinística (títulos, listas,
  primeira frase) e corte cabeça/cauda com marcador. Nenhuma chamada extra ao modelo.
- Orquestrador aplica o orçamento no dossiê de fontes, no dossiê das lentes e na síntese (divisão justa entre
  dossiê e cada análise — antes o dossiê podia engolir o espaço e as últimas lentes viravam nada).
- Avisos agregados em vez de nove linhas repetidas; diagnóstico antecipado quando o contexto é pequeno para
  a profundidade pedida.
- `usage` por análise (chamadas, tokens, por etapa, marca de estimativa) na API, na página e no `.md`.
- Fallback em 429 persistente com `Retry-After` > 60 s: uma tentativa no modelo alternativo, sem laço.
- `ANIMA_ACCESS_TOKEN` + `src/proxy.ts` (Next 16 renomeou `middleware` para `proxy`).

**Verificado**

- 97 testes locais; `budget` (12), `fallback` (2, com servidor que devolve 429 de 15 min) e `usage` no
  orquestrador (4 novos).
- Fluxo real por `curl` com `LLM_CONTEXT_TOKENS=8192` e dossiê gigante: análise conclui, avisos corretos.
- Matriz de autenticação por `curl` (sem token 401, token errado 401, token certo 200, cookie 200, header 200,
  `?token=` redireciona e grava cookie HttpOnly, assets livres).
- **CI no GitHub Actions com `DATABASE_URL` real e `ANIMA_REQUIRE_PRISMA_TESTS=1`**: o contrato do Prisma
  rodou contra SQLite de verdade, numa máquina independente deste sandbox. Isso fecha a lacuna da Fase 0 —
  e revelou dois defeitos que só apareciam com banco: ordem das lentes dependia do SQLite e o upsert de uma
  lente numa análise já apagada violava a chave estrangeira.

**Não verificado**

- Chamada real a Gemini/Groq/OpenRouter/Ollama: a rede do sandbox bloqueia os três primeiros; Ollama exigiria
  um modelo local de vários GB. O caminho está coberto por servidor OpenAI-compatível local.
- Interface renderizada em navegador: segue sem navegador executável aqui.
