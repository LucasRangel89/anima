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
  MAX_RETRY_AFTER_MS,
  type LLM,
  type LLMUsage,
} from './llm';
import {
  addNotice,
  contextLimit,
  describeShrink,
  emptyUsage,
  estimateTokens,
  fitTogether,
  recordCall,
  shrink,
  type AnalysisUsage,
} from './budget';
import { AGENTS } from './agent-meta';
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
    // Padrão 2 (era 3): provedores gratuitos devolvem 429 com três chamadas simultâneas.
    concurrency: Math.floor(num(env.LLM_CONCURRENCY, 2)),
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
    if (error.status === 429) {
      const wait = error.retryAfterMs ? ` O provedor pediu para aguardar ~${Math.round(error.retryAfterMs / 1000)}s.` : '';
      const hint = process.env.LLM_FALLBACK_MODEL
        ? ' O modelo alternativo (LLM_FALLBACK_MODEL) também está no limite.'
        : ' Defina LLM_FALLBACK_MODEL para continuar com outro modelo, reduza LLM_CONCURRENCY ou tente mais tarde.';
      return `Limite de requisições do provedor excedido.${wait}${hint}`;
    }
    if (error.status && error.status >= 500) return `O provedor de LLM está instável (${error.status}). Tente novamente.`;
  }
  if (error instanceof TimeoutError) return `${error.message}. Tente novamente ou aumente LLM_TIMEOUT_SECONDS.`;
  return errorMessage(error);
}

interface CallResult {
  text: string;
  usage?: LLMUsage;
  model: string;
  /** `true` quando o LLM_FALLBACK_MODEL entrou em cena. */
  fallbackUsed: boolean;
}

/** Espera longa demais para valer nova tentativa: melhor trocar de modelo do que travar a análise. */
function waitsTooLong(error: unknown): boolean {
  return error instanceof LLMError && (error.retryAfterMs ?? 0) > MAX_RETRY_AFTER_MS;
}

async function callLLM(
  llm: LLM,
  req: { system: string; user: string; label: string; maxTokens: number; temperature: number },
  signal: AbortSignal
): Promise<CallResult> {
  const { timeoutMs } = readConfig();
  const fallbackModel = (process.env.LLM_FALLBACK_MODEL ?? '').trim();

  // O limitador envolve a chamada inteira (inclusive pausas de retry), o que também desacelera a fila em caso de 429.
  const attempt = (target: LLM, attempts: number) =>
    limiter()(() =>
      retry(
        () => withTimeout((inner) => target.complete({ ...req, signal: inner }), timeoutMs, req.label, signal),
        {
          attempts,
          shouldRetry: (e) =>
            !isFatalLLMError(e) && !isAbortError(e) && !signal.aborted && !waitsTooLong(e),
          delayMs: (e, n) =>
            isRateLimitError(e) ? (e instanceof LLMError && e.retryAfterMs) || 8_000 * n : 1_500 * n,
        }
      )
    );

  try {
    const result = await attempt(llm, MAX_ATTEMPTS);
    return { ...result, model: llm.model, fallbackUsed: false };
  } catch (error) {
    // 429 persistente (ou espera absurda) e há modelo alternativo: uma tentativa, sem laço infinito.
    const alternative = fallbackModel && isRateLimitError(error) && !signal.aborted ? llm.withModel?.(fallbackModel) : undefined;
    if (!alternative) throw error;
    const result = await attempt(alternative, 1);
    return { ...result, model: alternative.model, fallbackUsed: true };
  }
}

/** Contabiliza a chamada: usa o `usage` do provedor quando existe; senão, estima e marca como estimado. */
function accountCall(
  ctx: RunContext,
  stage: string,
  prompt: string,
  result: CallResult
): void {
  const tokens = result.usage
    ? {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
        estimated: result.usage.estimated,
      }
    : { prompt: estimateTokens(prompt), completion: estimateTokens(result.text), estimated: true };
  recordCall(ctx.usage, stage, tokens);
  if (result.fallbackUsed) {
    addNotice(ctx.usage, `Limite do modelo principal atingido: a análise seguiu com ${result.model} (LLM_FALLBACK_MODEL).`);
    // Rastreabilidade: o relatório deve dizer qual modelo realmente escreveu.
    void safe(() => ctx.store.update(ctx.id, { model: result.model }));
  }
}

function persistUsage(ctx: RunContext): Promise<void> {
  const snapshot = JSON.stringify(ctx.usage);
  return safe(() => ctx.store.update(ctx.id, { usage: snapshot }));
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

/** Restaura a contabilidade de uma execução anterior (retomada mantém os números já gastos). */
function parseUsage(raw: string | null): AnalysisUsage | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnalysisUsage>;
    if (!Array.isArray(parsed.notices) || typeof parsed.calls !== 'number') return null;
    return { ...emptyUsage(contextLimit()), ...parsed } as AnalysisUsage;
  } catch {
    return null;
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
  /** Contabilidade de chamadas e tokens desta análise (persistida como JSON). */
  usage: AnalysisUsage;
  /** Contexto efetivo do modelo, para dimensionar dossiê e síntese. */
  contextLimit: number;
  /** Dossiê já reduzido para caber no contexto dos especialistas (calculado uma vez). */
  dossierForAgents?: string;
}

/**
 * Quanto sobra para o CONTEÚDO de entrada de uma etapa: limite − saída reservada − prompts fixos.
 * Nunca abaixo de 1k tokens, para não gerar prompts degenerados.
 */
function inputRoom(ctx: RunContext, outputTokens: number, fixedText: string): number {
  return Math.max(1_024, ctx.contextLimit - outputTokens - estimateTokens(fixedText) - 256);
}

/** Registra no relatório quando o conteúdo precisou ser reduzido para caber. */
function noteShrink(ctx: RunContext, label: string, result: { method: string; before: number; after: number }): void {
  if (result.method === 'nenhum') return;
  const notice = describeShrink(label, result as Parameters<typeof describeShrink>[1]);
  if (notice) addNotice(ctx.usage, notice);
}

async function runResearch(ctx: RunContext): Promise<string> {
  const { store, llm, id, title, hint, focus, kind, depth, userSources, signal } = ctx;
  await store.update(id, { status: 'researching', researchStatus: 'running', error: null });

  const gathered = await gatherSources({ title, hint, focus, kind, depth, userSources });
  await safe(() => store.update(id, { sources: JSON.stringify(gathered.sources) }));

  // O contexto das fontes é a parte elástica do prompt: cabe o quanto o modelo suportar.
  const emptyMessage = buildResearcherUserMessage(title, hint, kind, '', focus);
  const room = inputRoom(ctx, DEPTH_CONFIG[depth].dossierTokens, `${RESEARCHER_PROMPT}\n${emptyMessage}`);
  const fitted = shrink(gathered.context, room);
  noteShrink(ctx, 'Dossiê de fontes', fitted);

  const userMessage = buildResearcherUserMessage(title, hint, kind, fitted.text, focus);
  const result = await callLLM(
    llm,
    {
      system: RESEARCHER_PROMPT,
      user: userMessage,
      label: 'pesquisador',
      maxTokens: DEPTH_CONFIG[depth].dossierTokens,
      temperature: 0.2,
    },
    signal
  );
  accountCall(ctx, 'pesquisador', `${RESEARCHER_PROMPT}\n${userMessage}`, result);
  await persistUsage(ctx);

  await safe(() => store.update(id, { research: result.text, researchStatus: 'done' }));
  return result.text;
}

/** Nome legível de uma lente, para os avisos ("Análise de Personagens"). */
function agentName(key: string): string {
  return AGENTS.find((agent) => agent.key === key)?.name ?? key;
}

/** Dossiê reduzido para caber no contexto de um especialista (todas as lentes compartilham o mesmo). */
function dossierForAgents(ctx: RunContext, dossier: string): string {
  if (ctx.dossierForAgents === undefined) {
    const emptyMessage = buildSpecialistUserMessage(ctx.title, ctx.hint, ctx.kind, '', ctx.focus);
    const room = inputRoom(
      ctx,
      DEPTH_CONFIG[ctx.depth].maxTokens,
      `${getSpecialistPrompt('structural', { depth: ctx.depth, kind: ctx.kind })}\n${emptyMessage}`
    );
    const fitted = shrink(dossier, room);
    noteShrink(ctx, 'Dossiê enviado aos especialistas', fitted);
    ctx.dossierForAgents = fitted.text;
  }
  return ctx.dossierForAgents;
}

async function runSpecialist(ctx: RunContext, key: AgentKey, dossier: string): Promise<void> {
  const { store, llm, id, title, hint, focus, kind, depth, signal } = ctx;
  if (signal.aborted) return;
  const startedAt = Date.now();
  await safe(() => store.updateAgent(id, key, { status: 'running', error: null }));
  try {
    const system = getSpecialistPrompt(key, { depth, kind });
    const userMessage = buildSpecialistUserMessage(title, hint, kind, dossierForAgents(ctx, dossier), focus);
    const result = await callLLM(
      llm,
      { system, user: userMessage, label: `especialista:${key}`, maxTokens: DEPTH_CONFIG[depth].maxTokens, temperature: 0.5 },
      signal
    );
    accountCall(ctx, `especialista:${key}`, `${system}\n${userMessage}`, result);
    await persistUsage(ctx);
    if (signal.aborted) return;
    await safe(() =>
      store.updateAgent(id, key, { status: 'done', content: result.text, error: null, durationMs: Date.now() - startedAt })
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
    // A síntese é o prompt mais pesado: dossiê + as N análises. Dividimos o orçamento entre as partes
    // em vez de deixar o dossiê ocupar tudo e truncar silenciosamente as lentes do fim da lista.
    const system = getSynthesisPrompt(depth, kind);
    const present = AGENT_KEYS.filter((k) => !missing.includes(k));
    const sections = [
      // Dossiê na síntese só precisa reancorar fatos: metade do espaço das análises é suficiente.
      { key: 'dossie', text: dossier },
      ...present.map((k) => ({
        key: k,
        text: doneAgents.find((r) => r.agentKey === k)!.content!,
      })),
    ];
    const emptyMessage = buildSynthesisUserMessage(title, hint, kind, '', [], missing, focus);
    const room = inputRoom(ctx, DEPTH_CONFIG[depth].synthesisTokens, `${system}\n${emptyMessage}`);
    const fitted = fitTogether(sections, room);
    const textFor = (key: string) => fitted.parts.find((part) => part.key === key)?.text ?? '';

    // Um aviso agregado rende mais que nove linhas ("análise X cortada", "análise Y cortada"…):
    // o usuário precisa saber o que fazer, não a lista de vítimas.
    const shrunk = fitted.parts.filter((part) => part.shrink.method !== 'nenhum');
    if (shrunk.length > 0) {
      const smallest = Math.min(...shrunk.map((part) => part.shrink.after));
      const biggest = Math.max(...shrunk.map((part) => part.shrink.before));
      const names = shrunk.filter((p) => p.key !== 'dossie').map((p) => agentName(p.key));
      addNotice(
        ctx.usage,
        `Síntese com contexto reduzido: ${shrunk.length} de ${fitted.parts.length} textos foram condensados ou cortados ` +
          `(o maior tinha ~${biggest.toLocaleString('pt-BR')} tokens; o menor ficou com ~${smallest.toLocaleString('pt-BR')}). ` +
          `Contexto configurado: ${ctx.contextLimit.toLocaleString('pt-BR')} tokens. ` +
          `Para um relatório mais fiel, use menos lentes, profundidade menor ou aumente LLM_CONTEXT_TOKENS.` +
          (names.length ? ` Lentes afetadas: ${names.join(', ')}.` : '')
      );
    }

    const userMessage = buildSynthesisUserMessage(
      title,
      hint,
      kind,
      textFor('dossie'),
      present.map((k) => ({ agent: k, content: textFor(k) })),
      missing,
      focus
    );
    const result = await callLLM(
      llm,
      { system, user: userMessage, label: 'sintese', maxTokens: DEPTH_CONFIG[depth].synthesisTokens, temperature: 0.4 },
      signal
    );
    accountCall(ctx, 'sintese', `${system}\n${userMessage}`, result);
    await persistUsage(ctx);
    if (signal.aborted) return;
    await safe(() => store.update(id, { synthesis: result.text, synthesisStatus: 'done' }));
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

    const usage = parseUsage(row.usage) ?? emptyUsage(contextLimit());
    // Diagnóstico antecipado: se o contexto mal comporta uma única saída desta profundidade,
    // a síntese vai resumir tudo. Melhor avisar agora do que o usuário descobrir no relatório.
    if (usage.calls === 0 && usage.contextLimit < DEPTH_CONFIG[asDepth(row.depth)].maxTokens * 2) {
      addNotice(
        usage,
        `Contexto apertado: LLM_CONTEXT_TOKENS=${usage.contextLimit.toLocaleString('pt-BR')} é pouco para a profundidade ` +
          `"${asDepth(row.depth)}", que pede até ${DEPTH_CONFIG[asDepth(row.depth)].maxTokens.toLocaleString('pt-BR')} tokens por lente. ` +
          `A síntese receberá trechos reduzidos.`
      );
    }
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
      usage,
      contextLimit: contextLimit(),
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
