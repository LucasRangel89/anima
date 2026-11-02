// ANIMA — Orquestrador: o cérebro do sistema.
//
// Fluxo:  Pesquisador (fontes + dossiê) → 8 Especialistas (concorrência limitada) → Síntese (Curador)
//
// Decisões de arquitetura:
//  • Persistência atrás de `AnalysisStore` (testável sem banco).
//  • Concorrência de LLM limitada globalmente (LLM_CONCURRENCY) em vez de "disparo escalonado" fixo.
//  • Cada agente persiste seu estado individualmente → a UI mostra progresso e resultados parciais.
//  • Falha de um especialista não aborta a análise; falha do Pesquisador sim (os demais dependem do dossiê).
//  • Execuções ativas ficam em um registro; linhas "ativas" sem execução (ex.: servidor reiniciado)
//    são marcadas como `interrupted` por `reapOrphans()` e podem ser retomadas.
//  • As execuções rodam no processo Node (exige servidor persistente; não use funções serverless).

import { createLLM, isFatalLLMError, isRateLimitError, LLMError, type LLM } from './llm';
import { createLimiter, errorMessage, retry, TimeoutError, withTimeout } from './async-utils';
import { gatherSources } from './search';
import {
  DEPTH_CONFIG,
  RESEARCHER_PROMPT,
  buildResearcherUserMessage,
  buildSpecialistUserMessage,
  buildSynthesisUserMessage,
  getSpecialistPrompt,
  getSynthesisPrompt,
} from './prompts';
import { getStore } from './store-index';
import type { AnalysisRow, AnalysisStore } from './store';
import { AGENT_KEYS, isAgentKey, type AgentKey, type Depth, type WorkKind } from './types';

const MAX_ATTEMPTS = 3;
const MIN_ANALYSES_FOR_SYNTHESIS = 3;
const ORPHAN_GRACE_MS = 20_000;

/* ───────────────────────── Estado compartilhado do processo ───────────────────────── */

interface Globals {
  __animaRuns?: Map<string, Promise<void>>;
  __animaCancelled?: Set<string>;
  __animaLimiter?: { max: number; run: ReturnType<typeof createLimiter> };
}
const g = globalThis as unknown as Globals;
const runs = (): Map<string, Promise<void>> => (g.__animaRuns ??= new Map());
const cancelled = (): Set<string> => (g.__animaCancelled ??= new Set());

function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    concurrency: Math.floor(num(env.LLM_CONCURRENCY, 3)),
    timeoutMs: num(env.LLM_TIMEOUT_SECONDS, 180) * 1000,
    maxActive: Math.floor(num(env.ANIMA_MAX_ACTIVE, 3)),
  };
}

/** Limitador compartilhado por TODAS as análises em andamento. */
function limiter() {
  const { concurrency } = readConfig();
  if (!g.__animaLimiter || g.__animaLimiter.max !== concurrency) {
    g.__animaLimiter = { max: concurrency, run: createLimiter(concurrency) };
  }
  return g.__animaLimiter.run;
}

export function isRunActive(id: string): boolean {
  return runs().has(id);
}
export function activeRunCount(): number {
  return runs().size;
}
export function maxActiveRuns(): number {
  return readConfig().maxActive;
}
/** Aguarda o término da execução (útil em testes). */
export async function waitForRun(id: string): Promise<void> {
  await runs().get(id);
}

/* ───────────────────────── Chamada de LLM com retry ───────────────────────── */

/** Traduz erros técnicos em mensagens úteis para o usuário. */
export function describeError(error: unknown): string {
  if (error instanceof LLMError) {
    if (error.status === 401 || error.status === 403)
      return 'Credenciais do LLM inválidas ou sem permissão. Verifique LLM_API_KEY.';
    if (error.status === 404) return 'Modelo ou endpoint não encontrado. Verifique LLM_MODEL e LLM_BASE_URL.';
    if (error.status === 429) return 'Limite de requisições do provedor excedido. Reduza LLM_CONCURRENCY e tente de novo.';
    if (error.status && error.status >= 500) return `O provedor de LLM está instável (${error.status}). Tente novamente.`;
  }
  if (error instanceof TimeoutError) return `${error.message}. Tente novamente ou aumente LLM_TIMEOUT_SECONDS.`;
  return errorMessage(error);
}

async function callLLM(
  llm: LLM,
  req: { system: string; user: string; label: string; maxTokens: number; temperature: number }
): Promise<string> {
  const { timeoutMs } = readConfig();
  // O limitador envolve a chamada inteira (inclusive pausas de retry), o que também desacelera a fila em caso de 429.
  return limiter()(() =>
    retry(
      () => withTimeout((signal) => llm.complete({ ...req, signal }), timeoutMs, req.label),
      {
        attempts: MAX_ATTEMPTS,
        shouldRetry: (e) => !isFatalLLMError(e),
        delayMs: (e, attempt) =>
          isRateLimitError(e)
            ? (e instanceof LLMError && e.retryAfterMs) || 8_000 * attempt
            : 1_500 * attempt,
      }
    )
  );
}

/* ───────────────────────── Persistência tolerante a exclusões ───────────────────────── */

/** Se o usuário excluir a análise durante a execução, escritas posteriores falham: ignoramos. */
async function safe(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.warn('[anima] escrita ignorada:', errorMessage(error));
  }
}

/* ───────────────────────── Etapas ───────────────────────── */

interface RunContext {
  store: AnalysisStore;
  llm: LLM;
  id: string;
  title: string;
  hint: string | null;
  kind: WorkKind;
  depth: Depth;
}

async function runResearch(ctx: RunContext): Promise<string> {
  const { store, llm, id, title, hint, kind } = ctx;
  await store.update(id, { status: 'researching', researchStatus: 'running', error: null });

  const gathered = await gatherSources({ title, hint, kind });
  await safe(() => store.update(id, { sources: JSON.stringify(gathered.sources) }));

  const dossier = await callLLM(llm, {
    system: RESEARCHER_PROMPT,
    user: buildResearcherUserMessage(title, hint, kind, gathered.context),
    label: 'pesquisador',
    maxTokens: 3200,
    temperature: 0.2,
  });
  await safe(() => store.update(id, { research: dossier, researchStatus: 'done' }));
  return dossier;
}

async function runSpecialist(ctx: RunContext, key: AgentKey, dossier: string): Promise<void> {
  const { store, llm, id, title, hint, kind, depth } = ctx;
  if (cancelled().has(id)) return;
  const startedAt = Date.now();
  await safe(() => store.updateAgent(id, key, { status: 'running', error: null }));
  try {
    const content = await callLLM(llm, {
      system: getSpecialistPrompt(key, { depth, kind }),
      user: buildSpecialistUserMessage(title, hint, kind, dossier),
      label: `especialista:${key}`,
      maxTokens: DEPTH_CONFIG[depth].maxTokens,
      temperature: 0.5,
    });
    await safe(() => store.updateAgent(id, key, { status: 'done', content, error: null, durationMs: Date.now() - startedAt }));
  } catch (error) {
    await safe(() =>
      store.updateAgent(id, key, { status: 'failed', error: describeError(error), durationMs: Date.now() - startedAt })
    );
  }
}

async function runSynthesis(ctx: RunContext, dossier: string, row: AnalysisRow): Promise<void> {
  const { store, llm, id, title, hint, kind, depth } = ctx;
  const doneAgents = row.results.filter((r) => r.status === 'done' && r.content && isAgentKey(r.agentKey));
  const missing = AGENT_KEYS.filter((k) => !doneAgents.some((r) => r.agentKey === k));

  if (doneAgents.length < MIN_ANALYSES_FOR_SYNTHESIS) {
    await safe(() =>
      store.update(id, {
        synthesisStatus: 'failed',
        error: `Síntese não gerada: apenas ${doneAgents.length} especialista(s) concluíram (mínimo ${MIN_ANALYSES_FOR_SYNTHESIS}).`,
      })
    );
    return;
  }

  await store.update(id, { status: 'synthesizing', synthesisStatus: 'running', error: null });
  try {
    const synthesis = await callLLM(llm, {
      system: getSynthesisPrompt(depth, kind),
      user: buildSynthesisUserMessage(
        title,
        hint,
        kind,
        dossier,
        AGENT_KEYS.filter((k) => !missing.includes(k)).map((k) => ({
          agent: k,
          content: doneAgents.find((r) => r.agentKey === k)!.content!,
        })),
        missing
      ),
      label: 'sintese',
      maxTokens: DEPTH_CONFIG[depth].synthesisTokens,
      temperature: 0.4,
    });
    await safe(() => store.update(id, { synthesis, synthesisStatus: 'done' }));
  } catch (error) {
    await safe(() =>
      store.update(id, { synthesisStatus: 'failed', error: `A síntese falhou: ${describeError(error)}` })
    );
  }
}

/* ───────────────────────── Execução ───────────────────────── */

export interface RunPlan {
  research: boolean;
  agents: AgentKey[];
  synthesis: boolean;
}

async function execute(id: string, plan: RunPlan, llm: LLM): Promise<void> {
  const store = await getStore();
  const startedAt = Date.now();
  try {
    const row = await store.get(id);
    if (!row) return;

    const ctx: RunContext = {
      store,
      llm,
      id,
      title: row.title,
      hint: row.hint,
      kind: row.kind as WorkKind,
      depth: row.depth as Depth,
    };

    // Fase 1 — Pesquisador (falha aqui aborta a análise)
    let dossier = row.research;
    if (plan.research || !dossier) {
      try {
        dossier = await runResearch(ctx);
      } catch (error) {
        await safe(() =>
          store.update(id, {
            status: 'failed',
            researchStatus: 'failed',
            error: `A pesquisa falhou: ${describeError(error)}`,
            durationMs: (row.durationMs ?? 0) + (Date.now() - startedAt),
          })
        );
        return;
      }
    }

    // Fase 2 — Especialistas (concorrência limitada de forma global)
    if (plan.agents.length > 0) {
      await store.update(id, { status: 'analyzing', error: null });
      await Promise.all(plan.agents.map((key) => runSpecialist(ctx, key, dossier!)));
    }
    if (cancelled().has(id)) return;

    // Fase 3 — Síntese
    const afterSpecialists = await store.get(id);
    if (!afterSpecialists) return;
    const doneCount = afterSpecialists.results.filter((r) => r.status === 'done').length;

    if (doneCount === 0) {
      const firstError = afterSpecialists.results.find((r) => r.error)?.error;
      await safe(() =>
        store.update(id, {
          status: 'failed',
          error: `Nenhum especialista concluiu a análise.${firstError ? ` Motivo: ${firstError}` : ''}`,
          durationMs: (row.durationMs ?? 0) + (Date.now() - startedAt),
        })
      );
      return;
    }

    if (plan.synthesis) await runSynthesis(ctx, dossier!, afterSpecialists);

    // Mantém um erro de síntese visível, mas encerra a análise como concluída (resultado parcial é válido)
    await safe(() =>
      store.update(id, { status: 'completed', durationMs: (row.durationMs ?? 0) + (Date.now() - startedAt) })
    );
  } catch (error) {
    await safe(async () =>
      store.update(id, {
        status: 'failed',
        error: describeError(error),
        durationMs: Date.now() - startedAt,
      })
    );
  }
}

/** Registra e dispara a execução em background. O registro é síncrono, evitando corrida com `reapOrphans`. */
function launch(id: string, plan: RunPlan): void {
  const llm = createLLM();
  const promise = execute(id, plan, llm)
    .catch((error) => console.error('[anima] execução abortada:', error))
    .finally(() => {
      runs().delete(id);
      cancelled().delete(id);
    });
  runs().set(id, promise);
}

/* ───────────────────────── API pública ───────────────────────── */

export interface StartInput {
  title: string;
  hint: string | null;
  kind: WorkKind;
  depth: Depth;
}

export async function startAnalysis(input: StartInput): Promise<AnalysisRow> {
  const store = await getStore();
  const row = await store.create({ ...input, agentKeys: AGENT_KEYS, model: createLLM().model });
  launch(row.id, { research: true, agents: [...AGENT_KEYS], synthesis: true });
  return row;
}

export interface RetryOptions {
  agentKeys?: AgentKey[];
  research?: boolean;
  synthesis?: boolean;
}

export type RetryResult =
  | { ok: true; message: string }
  | { ok: false; code: 'not_found' | 'busy' | 'nothing'; message: string };

export async function retryAnalysis(id: string, opts: RetryOptions = {}): Promise<RetryResult> {
  const store = await getStore();
  const row = await store.get(id);
  if (!row) return { ok: false, code: 'not_found', message: 'Análise não encontrada.' };
  if (isRunActive(id)) return { ok: false, code: 'busy', message: 'Esta análise já está em andamento.' };

  const research = Boolean(opts.research) || !row.research;
  const explicit = opts.agentKeys?.length ? opts.agentKeys.filter(isAgentKey) : null;
  const agents: AgentKey[] = explicit
    ? [...new Set(explicit)]
    : AGENT_KEYS.filter((k) => {
        const r = row.results.find((x) => x.agentKey === k);
        // 'running' sem execução ativa = interrompido; ausentes (análises antigas) só entram se pedidos explicitamente
        return r !== undefined && ['failed', 'pending', 'running'].includes(r.status);
      });

  const synthesis = opts.synthesis ?? (agents.length > 0 || research || row.synthesisStatus !== 'done');

  if (!research && agents.length === 0 && !synthesis) {
    return { ok: false, code: 'nothing', message: 'Nada para reexecutar.' };
  }

  if (activeRunCount() >= maxActiveRuns()) {
    return { ok: false, code: 'busy', message: `Já existem ${activeRunCount()} análises em andamento. Aguarde uma concluir.` };
  }

  // Estado "na fila" imediato para a UI refletir o pedido
  await store.update(id, {
    status: research ? 'researching' : agents.length > 0 ? 'analyzing' : 'synthesizing',
    error: null,
    ...(research ? { researchStatus: 'running' as const } : {}),
    ...(synthesis ? { synthesisStatus: 'pending' as const } : {}),
  });
  for (const key of agents) {
    await store.updateAgent(id, key, { status: 'pending', content: null, error: null, durationMs: null });
  }

  launch(id, { research, agents, synthesis });
  const parts = [
    research ? 'pesquisa' : null,
    agents.length ? `${agents.length} especialista(s)` : null,
    synthesis ? 'síntese' : null,
  ].filter(Boolean);
  return { ok: true, message: `Reexecutando: ${parts.join(', ')}.` };
}

/** Exclui a análise e cancela escritas pendentes da execução em curso. */
export async function deleteAnalysis(id: string): Promise<boolean> {
  const store = await getStore();
  if (isRunActive(id)) cancelled().add(id);
  return store.delete(id);
}

/**
 * Marca como `interrupted` as análises ativas no banco sem execução correspondente neste processo
 * (ex.: servidor reiniciado no meio do pipeline). Podem ser retomadas por `retryAnalysis`.
 */
export async function reapOrphans(): Promise<number> {
  const store = await getStore();
  const active = await store.listActive();
  let reaped = 0;
  for (const { id, updatedAt } of active) {
    if (isRunActive(id) || Date.now() - updatedAt.getTime() < ORPHAN_GRACE_MS) continue;
    const row = await store.get(id);
    if (!row) continue;
    for (const r of row.results) {
      if (r.status === 'running') {
        await store.updateAgent(id, r.agentKey as AgentKey, {
          status: 'failed',
          error: 'Execução interrompida (o servidor foi reiniciado).',
        });
      }
    }
    await store.update(id, {
      status: 'interrupted',
      ...(row.researchStatus === 'running' ? { researchStatus: 'failed' as const } : {}),
      ...(row.synthesisStatus === 'running' ? { synthesisStatus: 'failed' as const } : {}),
      error: 'A análise foi interrompida antes de terminar. Você pode retomá-la.',
    });
    reaped++;
  }
  return reaped;
}
