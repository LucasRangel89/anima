"""
ANIMA — Orquestrador (referência em Python + LangChain).

O Orquestrador é o cérebro do sistema:
  1. recebe o título da obra;
  2. aciona o Agente Pesquisador (busca na web + LLM) para montar o dossiê;
  3. dispara os 6 Especialistas EM PARALELO, cada um com o mesmo dossiê;
  4. aguarda todos, coleta os relatórios e compila o documento final.

Como rodar:
    pip install langchain langchain-openai langchain-community python-dotenv
    export OPENAI_API_KEY="sk-..."   # ou qualquer endpoint compatível
    python orchestrator.py "Dom Casmurro"

Para usar outros provedores (Gemini, GLM, etc.), basta trocar o ChatOpenAI
por outra integração LangChain e, se necessário, apontar `base_url`
para um endpoint compatível com a API da OpenAI.
"""

from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass, field

from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI

from anima_agents import PAINEL_DE_ESPECIALISTAS, PESQUISADOR

# Busca web: DuckDuckGo é gratuita (sem chave). Em produção, considere a Tavily
# (mais estável, requer TAVILY_API_KEY) ou a SearchAPI.
from langchain_community.tools import DuckDuckGoSearchRun


@dataclass
class Dossie:
    """Resultado da fase de pesquisa — a base factual compartilhada."""
    obra: str
    conteudo: str = ""
    fontes: list[str] = field(default_factory=list)


class OrquestradorANIMA:
    """Gerencia o fluxo completo: pesquisa -> especialização paralela -> relatório."""

    def __init__(self, llm: ChatOpenAI | None = None, buscador=None) -> None:
        # temperature baixa: queremos análise rigorosa, não criatividade solta
        self.llm = llm or ChatOpenAI(model="gpt-4o-mini", temperature=0.3)
        self.buscador = buscador or DuckDuckGoSearchRun()

    # ------------------------------------------------------------------ #
    # FASE 1 — Agente Pesquisador
    # ------------------------------------------------------------------ #
    async def pesquisar(self, obra: str) -> Dossie:
        """Busca na web e compila o dossiê factual da obra."""
        print(f"[1/3] 🔎 Pesquisador coletando dados sobre “{obra}”…")

        # Duas buscas complementares (rode em paralelo com asyncio.gather)
        consultas = [
            f'"{obra}" obra resumo enredo personagens',
            f'"{obra}" análise crítica contexto histórico',
        ]
        resultados = await asyncio.gather(
            *[asyncio.to_thread(self.buscador.run, q) for q in consultas]
        )
        contexto_busca = "\n\n---\n\n".join(resultados)

        prompt = ChatPromptTemplate.from_messages([
            ("system", PESQUISADOR.prompt_sistema),
            ("user", "Obra solicitada: {obra}\n\n"
                     "=== RESULTADOS DE BUSCA ===\n{buscas}\n=== FIM ===\n\n"
                     "Compile o dossiê factual no formato especificado."),
        ])
        cadeia = prompt | self.llm
        dossie = await cadeia.ainvoke({"obra": obra, "buscas": contexto_busca})

        print(f"      ✅ Dossiê pronto ({len(dossie.content)} caracteres).")
        return Dossie(obra=obra, conteudo=dossie.content)

    # ------------------------------------------------------------------ #
    # FASE 2 — Especialistas em paralelo
    # ------------------------------------------------------------------ #
    async def analisar_agente(self, agente, dossie: Dossie) -> tuple[str, str]:
        """Executa UM especialista. Falhas não derrubam os demais."""
        print(f"      ⏳ {agente.nome} ({agente.cargo}) analisando…")
        prompt = ChatPromptTemplate.from_messages([
            ("system", agente.prompt_sistema),
            ("user", 'Obra a analisar: "{obra}"\n\n'
                     "=== DOSSIÊ FACTUAL ===\n{dossie}\n=== FIM ===\n\n"
                     "Execute a sua análise especializada completa."),
        ])
        cadeia = prompt | self.llm
        try:
            resposta = await cadeia.ainvoke({"obra": dossie.obra, "dossie": dossie.conteudo})
            print(f"      ✅ {agente.nome} concluiu.")
            return agente.chave, resposta.content
        except Exception as erro:  # noqa: BLE001 — resiliência é intencional
            print(f"      ❌ {agente.nome} falhou: {erro}")
            return agente.chave, f"_(este agente não concluiu: {erro})_"

    async def analisar_painel(self, dossie: Dossie) -> dict[str, str]:
        """Dispara os 6 especialistas simultaneamente e aguarda todos."""
        print("[2/3] 🧠 Disparando 6 especialistas em paralelo…")
        pares = await asyncio.gather(
            *[self.analisar_agente(ag, dossie) for ag in PAINEL_DE_ESPECIALISTAS]
        )
        return dict(pares)

    # ------------------------------------------------------------------ #
    # FASE 3 — Consolidação
    # ------------------------------------------------------------------ #
    def compilar_relatorio(self, dossie: Dossie, analises: dict[str, str]) -> str:
        print("[3/3] 📄 Compilando relatório final…")
        partes = [f"# Relatório ANIMA — {dossie.obra}", ""]
        partes += ["## Dossiê de Pesquisa (Agente Pesquisador)", "", dossie.conteudo, ""]
        for agente in PAINEL_DE_ESPECIALISTAS:  # preserva a ordem canônica
            partes += [
                "---",
                "",
                f"## {agente.nome} — {agente.cargo}",
                "",
                analises.get(agente.chave, "_(análise indisponível)_"),
                "",
            ]
        return "\n".join(partes)

    # ------------------------------------------------------------------ #
    # Pipeline completo
    # ------------------------------------------------------------------ #
    async def executar(self, obra: str) -> str:
        dossie = await self.pesquisar(obra)
        analises = await self.analisar_painel(dossie)
        return self.compilar_relatorio(dossie, analises)


async def main() -> None:
    obra = sys.argv[1] if len(sys.argv) > 1 else "Dom Casmurro"
    orquestrador = OrquestradorANIMA(
        llm=ChatOpenAI(
            model=os.getenv("ANIMA_MODEL", "gpt-4o-mini"),
            temperature=0.3,
            # base_url=os.getenv("ANIMA_BASE_URL"),  # endpoint compatível com OpenAI
        )
    )
    relatorio = await orquestrador.executar(obra)

    nome_arquivo = f"relatorio-{obra.lower().replace(' ', '-')}.md"
    with open(nome_arquivo, "w", encoding="utf-8") as f:
        f.write(relatorio)
    print(f"\n🎉 Relatório salvo em: {nome_arquivo}")


if __name__ == "__main__":
    asyncio.run(main())
