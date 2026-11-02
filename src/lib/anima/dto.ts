// ANIMA — conversão das linhas de persistência para DTOs da API.

import type {
  AgentKey,
  AgentResultDTO,
  AnalysisDTO,
  AnalysisSummaryDTO,
  AnalysisStatus,
  Depth,
  SourceDTO,
  WorkKind,
} from './types';
import { AGENT_KEYS, DEPTHS, SOURCE_ORIGINS, WORK_KINDS } from './types';
import type { AnalysisRow, AnalysisSummaryRow } from './store';

/** Peso de cada fase no progresso exibido (soma 100). */
const WEIGHTS = { research: 20, agents: 65, synthesis: 15 } as const;

interface ProgressInput {
  status: string;
  researchStatus: string;
  synthesisStatus: string;
  results: Array<{ status: string }>;
}

/**
 * Progresso determinístico a partir do estado persistido de cada etapa.
 * Nunca chega a 100 antes de `completed`, para não sugerir que terminou.
 */
export function computeProgress({ status, researchStatus, synthesisStatus, results }: ProgressInput): number {
  if (status === 'queued') return 0;
  if (status === 'completed') return 100;

  const research =
    researchStatus === 'done' ? WEIGHTS.research : researchStatus === 'running' ? WEIGHTS.research * 0.4 : 0;

  const total = results.length;
  const finished = results.filter((r) => ['done', 'failed', 'skipped'].includes(r.status)).length;
  const agents = total > 0 ? (finished / total) * WEIGHTS.agents : 0;

  const synthesis =
    synthesisStatus === 'done'
      ? WEIGHTS.synthesis
      : synthesisStatus === 'running'
        ? WEIGHTS.synthesis * 0.5
        : synthesisStatus === 'failed'
          ? WEIGHTS.synthesis * 0.2
          : 0;

  return Math.min(99, Math.round(research + agents + synthesis));
}

function parseSources(raw: string | null): SourceDTO[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is SourceDTO => Boolean(s) && typeof (s as SourceDTO).title === 'string')
      .map((s) => ({
        ...s,
        origin: (SOURCE_ORIGINS as readonly string[]).includes(s.origin) ? s.origin : 'wikipedia',
      }));
  } catch {
    return [];
  }
}

const asKind = (v: string): WorkKind => ((WORK_KINDS as readonly string[]).includes(v) ? (v as WorkKind) : 'auto');
const asDepth = (v: string): Depth => ((DEPTHS as readonly string[]).includes(v) ? (v as Depth) : 'standard');

export interface DtoContext {
  /** Posição na fila (1 = próxima), se estiver aguardando */
  queuePosition?: number | null;
}

export function toAnalysisDTO(row: AnalysisRow, ctx: DtoContext = {}): AnalysisDTO {
  const byKey = new Map(row.results.map((r) => [r.agentKey, r]));
  // Agentes ausentes = análise gerada antes de o agente existir, ou lente não selecionada → "skipped"
  const results: AgentResultDTO[] = AGENT_KEYS.map((key: AgentKey) => {
    const r = byKey.get(key);
    return r
      ? {
          agentKey: key,
          status: r.status as AgentResultDTO['status'],
          content: r.content,
          error: r.error,
          durationMs: r.durationMs,
        }
      : { agentKey: key, status: 'skipped', content: null, error: null, durationMs: null };
  });

  return {
    id: row.id,
    title: row.title,
    hint: row.hint,
    focus: row.focus ?? null,
    kind: asKind(row.kind),
    depth: asDepth(row.depth),
    status: row.status as AnalysisStatus,
    research: row.research,
    researchStatus: row.researchStatus as AnalysisDTO['researchStatus'],
    sources: parseSources(row.sources),
    synthesis: row.synthesis,
    synthesisStatus: row.synthesisStatus as AnalysisDTO['synthesisStatus'],
    error: row.error,
    durationMs: row.durationMs,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    results,
    progress: computeProgress({
      status: row.status,
      researchStatus: row.researchStatus,
      synthesisStatus: row.synthesisStatus,
      results: row.results,
    }),
    queuePosition: ctx.queuePosition ?? null,
  };
}

export function toAnalysisSummaryDTO(row: AnalysisSummaryRow, ctx: DtoContext = {}): AnalysisSummaryDTO {
  const totalAgents = row.totalAgents || AGENT_KEYS.length;
  const doneAgents = row.doneAgents;
  // Aproximação suficiente para o histórico: o detalhe exato vem de toAnalysisDTO.
  const finished = doneAgents;
  const progress = computeProgress({
    status: row.status,
    researchStatus: row.researchStatus,
    synthesisStatus: row.synthesisStatus,
    results: Array.from({ length: totalAgents }, (_, i) => ({ status: i < finished ? 'done' : 'pending' })),
  });

  return {
    id: row.id,
    title: row.title,
    hint: row.hint,
    focus: row.focus ?? null,
    kind: asKind(row.kind),
    depth: asDepth(row.depth),
    status: row.status as AnalysisStatus,
    createdAt: row.createdAt.toISOString(),
    durationMs: row.durationMs,
    doneAgents,
    totalAgents,
    progress,
    queuePosition: ctx.queuePosition ?? null,
  };
}
