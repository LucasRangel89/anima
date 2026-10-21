# Worklog — Projeto ANIMA

---
Task ID: 1
Agent: Z.ai Code (agente principal)
Task: Construir o projeto ANIMA (Analisador Narrativo Inteligente Multiagente) a partir do blueprint do usuário: validação técnica, MVP funcional completo (orquestrador + pesquisador + 6 especialistas + interface web) e código de referência Python/LangChain para publicação no GitHub.

Work Log:
- Estudei o SDK z-ai-web-dev-sdk (LLM chat completions + functions.invoke web_search) e testei a busca web com sucesso (query sobre Dom Casmurro).
- Modelei o banco no Prisma (SQLite): `Analysis` (pipeline: status, dossiê de pesquisa, duração) + `AgentResult` (uma linha por especialista — permite progresso individual sem corridas de escrita). `bun run db:push` executado.
- Backend (`src/lib/anima/`):
  - `types.ts` — tipos compartilhados (AgentKey, status, DTOs);
  - `agent-meta.ts` — metadados dos 6 especialistas (nome, cargo, ícone Lucide, cor de destaque) usados no frontend;
  - `prompts.ts` — prompts de sistema do Pesquisador e dos 6 especialistas (blueprint v2.0 do usuário + diretrizes de formato: Markdown PT-BR, 400–700 palavras, ancoragem factual);
  - `orchestrator.ts` — pipeline completo: 2 buscas web paralelas → LLM compila dossiê → 6 especialistas em paralelo com disparo escalonado (2,5s) → consolidação. Retry com backoff adaptativo (9s×n para erros 429), timeout de 200s por chamada, falha de especialista não aborta o pipeline; `retryAnalysis()` reexecuta pesquisador e/ou agentes falhos;
  - `dto.ts` + rotas de API: `POST/GET /api/analyses`, `GET/DELETE /api/analyses/[id]`, `POST /api/analyses/[id]/retry` (Next.js 16, params assíncronos, limite de 3 análises simultâneas).
- Frontend (página única `/`):
  - Identidade editorial: fontes Fraunces (serifada) + Inter, paleta papel-quante/carvão com acento âmbar, tema claro/escuro (next-themes), textura de papel sutil;
  - `page.tsx` orquestra 3 visões: início (hero + painel de especialistas + como funciona + histórico), monitoramento ao vivo (cronômetro, barra de progresso, cartão do pesquisador, grid dos 6 especialistas com estados animados) e relatório final (dossiê + 6 seções Markdown com navegação fixa e scrollspy, download .md, copiar, retry por agente);
  - Polling de 1,6s com parada em estado terminal, detecção de travamento (10 min), abertura de análise existente pelo histórico (economiza custo de API);
  - `markdown.tsx` + estilos `.anima-prose` (tipografia editorial para os relatórios), `agent-card.tsx`, `pipeline.tsx`, `report.tsx`, `hero.tsx`, `theme-toggle.tsx`.
- Testes de fumaça via curl: pipeline completo executado para "Dom Casmurro" (dossiê de 4.193 caracteres + 6 análises de ~3.000–3.900 caracteres cada).
- **Descoberta e correção importantes**: 6 chamadas LLM simultâneas estouraram o rate limit da API (429 em 2 agentes). Corrigido com disparo escalonado + backoff adaptativo + 3 tentativas. Teste subsequente ("Interestelar") completou 6/6 sem falhas; endpoint de retry validado reexecutando os 2 agentes falhos com sucesso.
- Verificação end-to-end com agent-browser + análise visual por VLM: home (desktop/mobile/dark mode), monitoramento ao vivo, relatório completo, navegação por seções, scrollspy (corrigido IntersectionObserver ambíguo por cálculo determinístico de rolagem), botão copiar com toast, rodapé fixo. Zero erros de console.
- Criada a pasta `python-reference/` com a implementação de referência na stack original do blueprint (LangChain + asyncio + Streamlit): `anima_agents.py`, `orchestrator.py`, `app.py`, `README.md` — sintaxe validada com py_compile.
- Lint (ESLint) passando sem erros; dev.log sem erros de runtime.

Stage Summary:
- MVP do ANIMA 100% funcional e verificado no navegador: usuário digita uma obra → pesquisador busca na web e compila dossiê → 6 especialistas analisam em paralelo → relatório consolidado com 7 seções, download .md e histórico persistido (SQLite/Prisma).
- Decisões-chave: progresso por linha de `AgentResult` (evita corrida de escrita); disparo escalonado de 2,5s + backoff 9s×n contra 429; análise parcial é preferível a falha total; prompts ancorados no dossiê factual para reduzir alucinação; retry granular por agente.
- Artefatos: app Next.js (rotas `/` + `/api/analyses*`), schema Prisma, `python-reference/` pronto para GitHub, 2 análises de demonstração no banco (Dom Casmurro 6/6, Interestelar 6/6).
- Próximos passos sugeridos (Fase 2): debate entre agentes (síntese crítica), comparação entre obras, autenticação de usuários, exportação PDF.
