"""
ANIMA — interface Streamlit (prototipagem rápida).

Como rodar:
    pip install streamlit
    streamlit run app.py

A interface acompanha o pipeline em tempo real: pesquisa -> 6 especialistas
em paralelo -> relatório consolidado.
"""

from __future__ import annotations

import asyncio

import streamlit as st

from anima_agents import PAINEL_DE_ESPECIALISTAS, PESQUISADOR
from orchestrator import OrquestradorANIMA

st.set_page_config(page_title="ANIMA — Análise Narrativa Multiagente", page_icon="🎭")


@st.cache_resource
def obter_orquestrador() -> OrquestradorANIMA:
    """Cria o orquestrador uma única vez por sessão."""
    return OrquestradorANIMA()


async def rodar_painel(orquestrador: OrquestradorANIMA, dossie, barras: dict) -> dict:
    """Dispara os 6 especialistas em paralelo e atualiza as barras de progresso."""
    tarefas = {
        agente.chave: asyncio.create_task(orquestrador.analisar_agente(agente, dossie))
        for agente in PAINEL_DE_ESPECIALISTAS
    }
    for chave, barra in barras.items():
        barra.progress(0.3, text=f"{chave} — analisando…")

    analises: dict[str, str] = {}
    for chave, tarefa in tarefas.items():
        resultado_chave, conteudo = await tarefa
        barras[resultado_chave].progress(1.0, text=f"{resultado_chave} — concluído ✅")
        analises[resultado_chave] = conteudo
    return analises


def main() -> None:
    st.title("🎭 ANIMA")
    st.caption("Analisador Narrativo Inteligente Multiagente")

    obra = st.text_input(
        "Qual obra vamos analisar?",
        placeholder="ex.: Dom Casmurro, Interestelar, Breaking Bad…",
    )

    if not st.button("Analisar obra", type="primary", disabled=len(obra.strip()) < 2):
        return

    orquestrador = obter_orquestrador()

    # Fase 1 — Pesquisador
    with st.status(f"🔎 {PESQUISADOR.nome} compilando o dossiê…", expanded=True) as status:
        dossie = asyncio.run(orquestrador.pesquisar(obra.strip()))
        status.update(label="✅ Dossiê factual pronto", state="complete", expanded=False)

    st.subheader("📋 Dossiê de Pesquisa")
    with st.expander("Ver resumo, personagens e contexto"):
        st.markdown(dossie.conteudo)

    # Fase 2 — Especialistas em paralelo (barras de progresso independentes)
    st.subheader("🧠 Painel de Especialistas")
    colunas = st.columns(3)
    barras = {
        agente.chave: colunas[i % 3].progress(0.0, text=f"{agente.nome} — na fila")
        for i, agente in enumerate(PAINEL_DE_ESPECIALISTAS)
    }

    analises = asyncio.run(rodar_painel(orquestrador, dossie, barras))

    # Fase 3 — Relatório consolidado
    st.divider()
    st.subheader("📄 Relatório final")
    for agente in PAINEL_DE_ESPECIALISTAS:
        with st.expander(f"{agente.nome} — {agente.cargo}"):
            st.markdown(analises.get(agente.chave, "_(análise indisponível)_"))

    st.download_button(
        "⬇️ Baixar relatório completo (.md)",
        data=orquestrador.compilar_relatorio(dossie, analises),
        file_name=f"anima-{obra.strip().lower().replace(' ', '-')}.md",
        mime="text/markdown",
    )


if __name__ == "__main__":
    main()
