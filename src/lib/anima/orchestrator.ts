// ANIMA — Orquestrador: o cérebro do sistema.
//
// Fluxo:  Fila → Pesquisador (fontes + dossiê) → Especialistas (concorrência limitada) → Síntese (Curador)
//
// Decisões de arquitetura:
//  • Persistência atrás de `AnalysisStore` (testável sem banco).
//  • Concorrência de LLM limitada globalmente (LLM_CONCURRENCY).
//  • Concorrência de análises limitada (ANIMA_MAX_ACTIVE); o excedente entra numa fila em processo
//    (ANIMA_MAX_QUEUE) em vez de ser recusado — o usuário não perde o pedido.
//  • Cada agente persiste seu estado individualmente → a UI mostra progresso e resultados parciais.
//  • Falha de um especialista não aborta a análise; falha do Pesquisador sim (os demais dependem do dossiê).
//  • Cancelamento é real: um AbortController por execução corta as chamadas HTTP em curso.
//  • Execuções ativas ficam em um registro; linhas "ativas" sem execução (ex.: servidor reiniciado)
//    são marcadas como `interrupted` por `reapOrphans()` e podem ser retomadas.
//  • As execuções rodam no processo Node (exige servidor persistente; não use funções serverless).

import {
  createLLM,
  isFatalLLMError,
  isRateLimitError,
  LLMError,
  type LLM,
} from './llm';
import {
  AbortedError,
  createLimiter,
  errorMessage,
  isAbortError,
  retry,
  TimeoutError,
  withTimeout,
} from './async-utils';
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
import { AGENT_KEYS, asDepth, asWorkKind, isAgentKey, type AgentKey, type Depth, type WorkKind } from './types';
import type { UserSourceInput } from './user-sources';

const MAX_ATTEMPTS = 3;
/** Síntese exige pelo menos isto de especialistas concluídos (ou todas as lentes pedidas, se forem menos). */
const MIN_ANALYSES_FOR_SYNTHESIS = 3;
const ORPHAN_GRACE_MS = 20_000;

/* ───────────────────────── Estado compartilhado do processo ───────────────────────── */

export interface RunPlan {
  research: boolean;
  agents: AgentKey[];
  synthesis: boolean;
}

interface Globals {
  __animaRuns?: Map<string, Promise<void>>;
  __animaControllers?: Map<string, AbortController>;
  __animaQueue?: Map<string, RunPlan>;
  __animaLimiter?: { max: number; run: ReturnType<typeof createLimiter> };
}
const g = globalThis as unknown as Globals;

const runs = (): Map<string, Promise<void>> => (g.__animaRuns ??= new Map());
const controllers = (): Map<string, AbortController> => (g.__animaControllers ??= new Map());
const pending = (): Map<string, RunPlan> => (g.__animaQueue ??= new Map());

function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    concurrency: Math.floor(num(env.LLM_CONCURRENCY, 3)),
    timeoutMs: num(env.LLM_TIMEOUT_SECONDS, 180) * 1000,
    maxActive: Math.floor(num(env.ANIMA_MAX_ACTIVE, 3)),
    maxQueue: Math.floor(num(env.ANIMA_MAX_QUEUE, 8)),
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
export function maxQueuedRuns(): number {
  return readConfig().maxQueue;
}
export function queueLength(): number {
  return pending().size;
}
/** Posição na fila (1 = próxima) ou null se não estiver esperando. */
export function queuePosition(id: string): number | null {
  const ids = [...pending().keys()];
  const index = ids.indexOf(id);
  return index === -1 ? null : index + 1;
}
/** Aguarda o término da execução (útil em testes). */
export async function waitForRun(id: string): Promise<void> {
  for (;;) {
    const run = runs().get(id);
    if (run) {
      await run;
      return;
    }
    if (!pending().has(id)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
/** Aguarda todas as execuções e a fila esvaziarem (útil em testes). */
export async function waitForIdle(): Promise<void> {
  for (;;) {
    if (runs().size === 0 && pending().size === 0) return;
    await Promise.allSettled([...runs().values()]);
    if (runs().size === 0 && pending().size === 0) return;
  }
}

/* ───────────────────────── Chamada de LLM com retry ───────────────────────── */

/** Traduz erros técnicos em mensagens úteis para o usuário. */
export function describeError(error: unknown): string {
  if (error instanceof AbortedError) return 'Análise cancelada por você.';
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
  req: { system: string; user: string; label: string; maxTokens: number; temperature: number },
  signal: AbortSignal
): Promise<string> {
  const { timeoutMs } = readConfig();
  // O limitador envolve a chamada inteira (inclusive pausas de retry), o que também desacelera a fila em caso de 429.
  return limiter()(() =>
    retry(
      () => withTimeout((inner) => llm.complete({ ...req, signal: inner }), timeoutMs, req.label, signal),
      {
        attempts: MAX_ATTEMPTS,
        shouldRetry: (e) => !isFatalLLMError(e) && !isAbortError(e) && !signal.aborted,
        delayMs: (e, attempt) =>
          isRateLimitError(e) ? (e instanceof LLMError && e.retryAfterMs) || 8_000 * attempt : 1_500 * attempt,
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

function parseUserSources(raw: string | null): UserSourceInput[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is UserSourceInput =>
        Boolean(s) &&
        typeof (s as UserSourceInput).value === 'string' &&
        ((s as UserSourceInput).type === 'url' || (s as UserSourceInput).type === 'text')
    );
  } catch {
    return [];
  }
}

/* ───────────────────────── Etapas ───────────────────────── */

interface RunContext {
  store: AnalysisStore;
  llm: LLM;
  id: string;
  title: string;
  hint: string | null;
  focus: string | null;
  kind: WorkKind;
  depth: Depth;
  userSources: UserSourceInput[];
  signal: AbortSignal;
}

async function runResearch(ctx: RunContext): Promise<string> {
  const { store, llm, id, title, hint, focus, kind, depth, userSources, signal } = ctx;
  await store.update(id, { status: 'researching', researchStatus: 'running', error: null });

  const gathered = await gatherSources({ title, hint, focus, kind, depth, userSources });
  await safe(() => store.update(id, { sources: JSON.stringify(gathered.sources) }));

  const dossier = await callLLM(
    llm,
    {
      system: RESEARCHER_PROMPT,
      user: buildResearcherUserMessage(title, hint, kind, gathered.context, focus),
      label: 'pesquisador',
      maxTokens: DEPTH_CONFIG[depth].dossierTokens,
      temperature: 0.2,
    },
    signal
  );
  await safe(() => store.update(id, { research: dossier, researchStatus: 'done' }));
  return dossier;
}

async function runSpecialist(ctx: RunContext, key: AgentKey, dossier: string): Promise<void> {
  const { store, llm, id, title, hint, focus, kind, depth, signal } = ctx;
  if (signal.aborted) return;
  const startedAt = Date.now();
  await safe(() => store.updateAgent(id, key, { status: 'running', error: null }));
  try {
    const content = await callLLM(
      llm,
      {
        system: getSpecialistPrompt(key, { depth, kind }),
        user: buildSpecialistUserMessage(title, hint, kind, dossier, focus),
        label: `especialista:${key}`,
        maxTokens: DEPTH_CONFIG[depth].maxTokens,
        temperature: 0.5,
      },
      signal
    );
    if (signal.aborted) return;
    await safe(() =>
      store.updateAgent(id, key, { status: 'done', content, error: null, durationMs: Date.now() - startedAt })
    );
  } catch (error) {
    if (signal.aborted) {
      await safe(() =>
        store.updateAgent(id, key, {
          status: 'failed',
          error: 'Cancelado por você.',
          durationMs: Date.now() - startedAt,
        })
      );
      return;
    }
    await safe(() =>
      store.updateAgent(id, key, { status: 'failed', error: describeError(error), durationMs: Date.now() - startedAt })
    );
  }
}

async function runSynthesis(ctx: RunContext, dossier: string, row: AnalysisRow): Promise<void> {
  const { store, llm, id, title, hint, focus, kind, depth, signal } = ctx;
  const doneAgents = row.results.filter((r) => r.status === 'done' && r.content && isAgentKey(r.agentKey));
  const missing = AGENT_KEYS.filter((k) => !doneAgents.some((r) => r.agentKey === k));
  const required = Math.min(MIN_ANALYSES_FOR_SYNTHESIS, row.results.length);

  if (doneAgents.length < required) {
    await safe(() =>
      store.update(id, {
        synthesisStatus: 'failed',
        error: `Síntese não gerada: apenas ${doneAgents.length} especialista(s) concluíram (mínimo ${required}).`,
      })
    );
    return;
  }

  await store.update(id, { status: 'synthesizing', synthesisStatus: 'running', error: null });
  try {
    const synthesis = await callLLM(
      llm,
      {
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
          missing,
          focus
        ),
        label: 'sintese',
        maxTokens: DEPTH_CONFIG[depth].synthesisTokens,
        temperature: 0.4,
      },
      signal
    );
    if (signal.aborted) return;
    await safe(() => store.update(id, { synthesis, synthesisStatus: 'done' }));
  } catch (error) {
    if (signal.aborted) {
      await safe(() => store.update(id, { synthesisStatus: 'failed', error: 'Síntese cancelada por você.' }));
      return;
    }
    await safe(() =>
      store.update(id, { synthesisStatus: 'failed', error: `A síntese falhou: ${describeError(error)}` })
    );
  }
}

/* ───────────────────────── Execução ───────────────────────── */

async function execute(id: string, plan: RunPlan, llm: LLM, signal: AbortSignal): Promise<void> {
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
      focus: row.focus ?? null,
      kind: asWorkKind(row.kind),
      depth: asDepth(row.depth),
      userSources: parseUserSources(row.userSources),
      signal,
    };

    // Fase 1 — Pesquisador (falha aqui aborta a análise)
    let dossier = row.research;
    if (plan.research || !dossier) {
      try {
        dossier = await runResearch(ctx);
      } catch (error) {
        if (signal.aborted) return;
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
    if (signal.aborted) return;

    // Fase 2 — Especialistas (concorrência limitada de forma global)
    if (plan.agents.length > 0) {
      await store.update(id, { status: 'analyzing', error: null });
      await Promise.all(plan.agents.map((key) => runSpecialist(ctx, key, dossier!)));
    }
    if (signal.aborted) return;

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
    if (signal.aborted) return;

    // Mantém um erro de síntese visível, mas encerra a análise como concluída (resultado parcial é válido)
    await safe(() =>
      store.update(id, { status: 'completed', durationMs: (row.durationMs ?? 0) + (Date.now() - startedAt) })
    );
  } catch (error) {
    if (signal.aborted) return;
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
  const controller = new AbortController();
  controllers().set(id, controller);

  const promise = execute(id, plan, llm, controller.signal)
    .catch((error) => console.error('[anima] execução abortada:', error))
    .finally(() => {
      runs().delete(id);
      controllers().delete(id);
      // `drainQueue` é síncrono ao registrar a próxima execução, então a vaga recém-liberada é reaproveitada.
      drainQueue();
    });
  runs().set(id, promise);
}

/** Inicia as próximas análises da fila enquanto houver vagas. */
function drainQueue(): void {
  const { maxActive } = readConfig();
  while (runs().size < maxActive && pending().size > 0) {
    const [id, plan] = pending().entries().next().value as [string, RunPlan];
    pending().delete(id);
    launch(id, plan);
  }
}

/* ───────────────────────── API pública ───────────────────────── */

export interface StartInput {
  title: string;
  hint: string | null;
  focus: string | null;
  kind: WorkKind;
  depth: Depth;
  agents?: readonly AgentKey[];
  userSources?: UserSourceInput[];
}

export interface StartResult {
  row: AnalysisRow;
  queued: boolean;
  queuePosition: number | null;
}

export async function startAnalysis(input: StartInput): Promise<StartResult> {
  const store = await getStore();
  const agentKeys: AgentKey[] = input.agents?.length ? [...input.agents] : [...AGENT_KEYS];
  const row = await store.create({
    title: input.title,
    hint: input.hint,
    focus: input.focus,
    kind: input.kind,
    depth: input.depth,
    agentKeys,
    userSources: input.userSources?.length ? JSON.stringify(input.userSources) : null,
    model: createLLM().model,
  });

  const plan: RunPlan = { research: true, agents: agentKeys, synthesis: true };
  if (runs().size >= readConfig().maxActive) {
    // Sem vaga: entra na fila e a UI mostra a posição
    await store.update(row.id, { status: 'queued', researchStatus: 'pending', synthesisStatus: 'pending' });
    pending().set(row.id, plan);
    return { row: { ...row, status: 'queued', researchStatus: 'pending' }, queued: true, queuePosition: queuePosition(row.id) };
  }

  launch(row.id, plan);
  return { row, queued: false, queuePosition: null };
}

export interface RetryOptions {
  agentKeys?: AgentKey[];
  research?: boolean;
  synthesis?: boolean;
}

export type RetryResult =
  | { ok: true; message: string; queued: boolean }
  | { ok: false; code: 'not_found' | 'busy' | 'nothing' | 'full'; message: string };

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
        // 'running' sem execução ativa = interrompido; ausentes (lentes não selecionadas) só entram se pedidos
        return r !== undefined && ['failed', 'pending', 'running'].includes(r.status);
      });

  const synthesis = opts.synthesis ?? (agents.length > 0 || research || row.synthesisStatus !== 'done');

  if (!research && agents.length === 0 && !synthesis) {
    return { ok: false, code: 'nothing', message: 'Nada para reexecutar.' };
  }

  const plan: RunPlan = { research, agents, synthesis };
  if (runs().size >= readConfig().maxActive) {
    if (pending().size >= readConfig().maxQueue) {
      return { ok: false, code: 'full', message: 'A fila está cheia. Aguarde uma análise concluir.' };
    }
    await store.update(id, {
      status: 'queued',
      error: null,
      ...(synthesis ? { synthesisStatus: 'pending' as const } : {}),
    });
    pending().set(id, plan);
  } else {
    pending().delete(id);
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
    launch(id, plan);
  }

  const parts = [
    research ? 'pesquisa' : null,
    agents.length ? `${agents.length} especialista(s)` : null,
    synthesis ? 'síntese' : null,
  ].filter(Boolean);
  const queued = pending().has(id);
  return {
    ok: true,
    message: queued
      ? `Na fila (posição ${queuePosition(id)}): ${parts.join(', ')}.`
      : `Reexecutando: ${parts.join(', ')}.`,
    queued,
  };
}

/**
 * Cancela uma análise: remove da fila ou aborta as chamadas em curso e marca o estado.
 * O que já foi escrito é preservado — a análise fica `interrupted` e pode ser retomada depois.
 */
export async function cancelAnalysis(id: string): Promise<boolean> {
  const store = await getStore();
  const row = await store.get(id);
  if (!row) return false;

  const wasQueued = pending().delete(id) || row.status === 'queued';
  const controller = controllers().get(id);
  const wasRunning = Boolean(controller);
  if (!wasQueued && !wasRunning) return false;

  controller?.abort();

  await Promise.all(
    row.results
      .filter((r) => r.status === 'running' || r.status === 'pending')
      .map((r) =>
        safe(() =>
          store.updateAgent(id, r.agentKey as AgentKey, {
            status: 'failed',
            error: wasQueued ? 'Cancelado antes de começar.' : 'Cancelado por você.',
          })
        )
      )
  );

  await safe(() =>
    store.update(id, {
      status: 'interrupted',
      error: wasQueued
        ? 'Análise cancelada na fila. Você pode retomá-la quando quiser.'
        : 'Análise cancelada por você. O que já foi escrito está preservado e pode ser retomado.',
      ...(row.researchStatus === 'running' ? { researchStatus: 'failed' as const } : {}),
      ...(row.synthesisStatus === 'running' ? { synthesisStatus: 'failed' as const } : {}),
    })
  );
  return true;
}

/** Exclui a análise e cancela escritas pendentes da execução em curso. */
export async function deleteAnalysis(id: string): Promise<boolean> {
  const store = await getStore();
  pending().delete(id);
  controllers().get(id)?.abort();
  return store.delete(id);
}

/**
 * Marca como `interrupted` as análises ativas no banco sem execução correspondente neste processo
 * (ex.: servidor reiniciado no meio do pipeline ou com a fila pendente). Podem ser retomadas.
 */
export async function reapOrphans(): Promise<number> {
  const store = await getStore();
  const active = await store.listActive();
  let reaped = 0;
  for (const { id, updatedAt } of active) {
    if (isRunActive(id) || pending().has(id)) continue;
    if (Date.now() - updatedAt.getTime() < ORPHAN_GRACE_MS) continue;
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
      error:
        row.status === 'queued'
          ? 'A análise estava na fila quando o servidor reiniciou. Você pode retomá-la.'
          : 'A análise foi interrompida antes de terminar. Você pode retomá-la.',
    });
    reaped++;
  }
  return reaped;
}
