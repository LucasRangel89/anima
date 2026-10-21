// ANIMA — Orquestrador: o cérebro do sistema.
// Fluxo: Pesquisador (web search + LLM) -> 6 Especialistas em paralelo -> Consolidação.
// O progresso de cada agente é persistido individualmente para a UI acompanhar ao vivo.

import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { AGENT_KEYS, type AgentKey } from './types';
import {
  RESEARCHER_PROMPT,
  getSpecialistPrompt,
  buildSpecialistUserMessage,
  buildResearcherUserMessage,
} from './prompts';

const LLM_TIMEOUT_MS = 200_000; // 200s por chamada de LLM
const SEARCH_TIMEOUT_MS = 30_000; // 30s por busca web
const MAX_ATTEMPTS = 3; // até 2 retries automáticos por chamada
const AGENT_STAGGER_MS = 2_500; // espaçamento entre disparos dos especialistas

/** Envelopa uma promise com timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: tempo limite de ${Math.round(ms / 1000)}s excedido`)), ms)
    ),
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Erros de limite de requisições (429) merecem espera mais longa. */
function isRateLimitError(error: unknown): boolean {
  return error instanceof Error && /429|too many requests/i.test(error.message);
}

/** Chamada de LLM com retry, timeout e backoff adaptativo. Usa a role 'assistant' como prompt de sistema (conforme SDK). */
async function callLLM(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  systemPrompt: string,
  userMessage: string,
  label: string
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      const delay = isRateLimitError(lastError) ? 9_000 * (attempt - 1) : 1_500 * (attempt - 1);
      await sleep(delay);
    }
    try {
      const completion = await withTimeout(
        zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          thinking: { type: 'disabled' },
        }),
        LLM_TIMEOUT_MS,
        label
      );
      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) throw new Error(`${label}: resposta vazia do modelo`);
      return content;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Agente Pesquisador: busca na web e compila o dossiê factual. */
async function runResearcher(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  title: string
): Promise<string> {
  // Duas buscas em paralelo: enredo/personagens + contexto/recepção
  const [plotResults, contextResults] = await Promise.all([
    withTimeout(
      zai.functions.invoke('web_search', {
        query: `"${title}" obra resumo enredo personagens`,
        num: 6,
      }),
      SEARCH_TIMEOUT_MS,
      'Busca web (enredo)'
    ).catch(() => []),
    withTimeout(
      zai.functions.invoke('web_search', {
        query: `"${title}" análise crítica contexto histórico recepção`,
        num: 6,
      }),
      SEARCH_TIMEOUT_MS,
      'Busca web (contexto)'
    ).catch(() => []),
  ]);

  const seen = new Set<string>();
  const searchContext = [...plotResults, ...contextResults]
    .filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    })
    .map((r) => `### ${r.name} (${r.host_name})\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  return callLLM(
    zai,
    RESEARCHER_PROMPT,
    buildResearcherUserMessage(title, searchContext),
    'Pesquisador'
  );
}

/** Executa um especialista individual e persiste o resultado. */
async function runSpecialist(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  analysisId: string,
  agentKey: AgentKey,
  title: string,
  dossier: string
): Promise<void> {
  const startedAt = Date.now();
  await db.agentResult.update({
    where: { analysisId_agentKey: { analysisId, agentKey } },
    data: { status: 'running', error: null },
  });
  try {
    const content = await callLLM(
      zai,
      getSpecialistPrompt(agentKey),
      buildSpecialistUserMessage(title, dossier),
      `Especialista ${agentKey}`
    );
    await db.agentResult.update({
      where: { analysisId_agentKey: { analysisId, agentKey } },
      data: { status: 'done', content, durationMs: Date.now() - startedAt },
    });
  } catch (error) {
    await db.agentResult.update({
      where: { analysisId_agentKey: { analysisId, agentKey } },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
    });
  }
}

/**
 * Pipeline completo de uma análise. Executado em background após o POST.
 * Falha do Pesquisador aborta tudo (os especialistas dependem do dossiê);
 * falha de um especialista não afeta os demais (análise parcial é válida).
 */
export async function runAnalysisPipeline(analysisId: string): Promise<void> {
  const startedAt = Date.now();
  try {
    const analysis = await db.analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) return;

    const zai = await ZAI.create();

    // Fase 1 — Pesquisador
    await db.analysis.update({
      where: { id: analysisId },
      data: { status: 'researching', researchStatus: 'running', error: null },
    });
    const dossier = await runResearcher(zai, analysis.title);
    await db.analysis.update({
      where: { id: analysisId },
      data: { research: dossier, researchStatus: 'done', status: 'analyzing' },
    });

    // Fase 2 — Especialistas em paralelo com disparo escalonado
    // (evita estourar o limite de requisições simultâneas da API de LLM;
    //  cada um grava seu resultado ao terminar)
    await Promise.all(
      AGENT_KEYS.map((key, i) =>
        sleep(i * AGENT_STAGGER_MS).then(() =>
          runSpecialist(zai, analysisId, key, analysis.title, dossier)
        )
      )
    );

    // Fase 3 — Consolidação
    await db.analysis.update({
      where: { id: analysisId },
      data: { status: 'completed', durationMs: Date.now() - startedAt },
    });
  } catch (error) {
    await db.analysis
      .update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          researchStatus: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Falha inesperada durante a análise. Tente novamente.',
          durationMs: Date.now() - startedAt,
        },
      })
      .catch(() => undefined);
  }
}

/**
 * Reexecuta o Pesquisador (se o dossiê não existir) e/ou os especialistas
 * indicados (por padrão, todos com status 'failed').
 */
export async function retryAnalysis(
  analysisId: string,
  agentKeys?: AgentKey[]
): Promise<{ ok: boolean; message: string }> {
  const analysis = await db.analysis.findUnique({
    where: { id: analysisId },
    include: { results: true },
  });
  if (!analysis) return { ok: false, message: 'Análise não encontrada.' };

  let dossier = analysis.research;
  const zai = await ZAI.create();
  const startedAt = Date.now();

  // Reexecuta a pesquisa se não há dossiê
  if (!dossier) {
    await db.analysis.update({
      where: { id: analysisId },
      data: { status: 'researching', researchStatus: 'running', error: null },
    });
    try {
      dossier = await runResearcher(zai, analysis.title);
      await db.analysis.update({
        where: { id: analysisId },
        data: { research: dossier, researchStatus: 'done', status: 'analyzing' },
      });
    } catch (error) {
      await db.analysis.update({
        where: { id: analysisId },
        data: {
          status: 'failed',
          researchStatus: 'failed',
          error: error instanceof Error ? error.message : 'Falha na pesquisa.',
        },
      });
      return { ok: false, message: 'A pesquisa falhou novamente. Tente mais tarde.' };
    }
  }

  // Seleciona especialistas: os pedidos, ou todos que falharam
  const targets = agentKeys?.length
    ? agentKeys
    : analysis.results.filter((r) => r.status === 'failed').map((r) => r.agentKey as AgentKey);
  const validTargets = targets.filter((k) => AGENT_KEYS.includes(k));
  if (validTargets.length === 0) {
    return { ok: false, message: 'Nenhum agente para reexecutar.' };
  }

  await db.analysis.update({
    where: { id: analysisId },
    data: { status: 'analyzing', error: null },
  });

  void Promise.all(
    validTargets.map((key, i) =>
      sleep(i * AGENT_STAGGER_MS).then(() =>
        runSpecialist(zai, analysisId, key, analysis.title, dossier!)
      )
    )
  ).then(async () => {
    await db.analysis
      .update({
        where: { id: analysisId },
        data: { status: 'completed', durationMs: Date.now() - startedAt },
      })
      .catch(() => undefined);
  });

  return { ok: true, message: `Reexecutando ${validTargets.length} agente(s).` };
}
