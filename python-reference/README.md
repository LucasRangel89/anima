# ANIMA — Código de referência (Python + LangChain)

> **Analisador Narrativo Inteligente Multiagente**: um pesquisador e seis
> especialistas de IA analisam qualquer obra narrativa e produzem um
> relatório consolidado.

Esta pasta contém a implementação de referência do blueprint do ANIMA na
stack Python sugerida no planejamento (LangChain + Streamlit), organizada
para você publicar no GitHub.

## Arquivos

| Arquivo | Papel |
|---|---|
| `anima_agents.py` | Definição dos 7 agentes (Pesquisador + 6 Especialistas) com seus prompts de sistema |
| `orchestrator.py` | O Orquestrador: pesquisa → especialistas em paralelo (`asyncio`) → consolidação |
| `app.py` | Interface Streamlit com progresso em tempo real |

## Arquitetura (Fase 1 — especialização isolada)

```
                ┌──────────────────────┐
 título ───────▶│  ORQUESTRADOR        │
                └──────────┬───────────┘
                           │ 1ª fase
                           ▼
                ┌──────────────────────┐
                │ AGENTE PESQUISADOR   │  busca web (DuckDuckGo/Tavily)
                │ → dossiê factual     │  + LLM para compilar
                └──────────┬───────────┘
                           │ 2ª fase (o mesmo dossiê para todos,
                           │  em paralelo e sem comunicação)
        ┌────────┬─────────┼─────────┬─────────┬────────┐
        ▼        ▼         ▼         ▼         ▼        ▼
    Estrutural Personagens Temático Estilístico Psicológico Cultural
        └────────┴─────────┼─────────┴─────────┴────────┘
                           │ 3ª fase
                           ▼
                ┌──────────────────────┐
                │ RELATÓRIO CONSOLIDADO│  Markdown, 6 seções
                └──────────────────────┘
```

## Instalação

```bash
python -m venv .venv && source .venv/bin/activate
pip install langchain langchain-openai langchain-community duckduckgo-search streamlit

export OPENAI_API_KEY="sk-..."        # ou outro provedor via base_url
# export ANIMA_MODEL="gpt-4o-mini"    # opcional
# export ANIMA_BASE_URL="https://..." # endpoint compatível com a API OpenAI
```

## Uso

```bash
# CLI: gera relatorio-dom-casmurro.md
python orchestrator.py "Dom Casmurro"

# Interface web (Streamlit)
streamlit run app.py
```

## Roadmap

- [ ] **Fase 2 — Debate entre agentes**: os especialistas leem o relatório
      uns dos outros e produzem uma síntese crítica (o Orquestrador passa a
      orquestrar rodadas de discussão).
- [ ] **Fase 3 — Memória e usuários**: histórico de análises (SQLite),
      comparação entre obras, exportação em PDF.
- [ ] Avaliação de qualidade: rubrica automática + revisão humana.

## Observações de produção

1. **Limite de requisições (429)**: disparar 6 LLMs simultaneamente pode
   estourar o rate limit do provedor. Estratégias: espaçar os disparos
   (stagger), usar backoff exponencial e tratar falha por agente sem
   abortar o pipeline (análise parcial é melhor que nada).
2. **Custo**: cada análise = 7 chamadas de LLM. Monitore tokens e ofereça
   modo "rascunho" (modelo menor) vs. "profundo".
3. **Qualidade da pesquisa**: a precisão do dossiê limita a de todo o
   relatório. Prefira Tavily/SearchAPI em produção e sempre cite as fontes.
