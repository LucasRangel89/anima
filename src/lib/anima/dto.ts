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
import { AGENT_KEYS, DEPTHS, WORK_KINDS } from './types';
import type { AnalysisRow, AnalysisSummaryRow } from './store';

function parseSources(raw: string | null): SourceDTO[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SourceDTO[]) : [];
  } catch {
    return [];
  }
}

const asKind = (v: string): WorkKind => ((WORK_KINDS as readonly string[]).includes(v) ? (v as WorkKind) : 'auto');
const asDepth = (v: string): Depth => ((DEPTHS as readonly string[]).includes(v) ? (v as Depth) : 'standard');

export function toAnalysisDTO(row: AnalysisRow): AnalysisDTO {
  const byKey = new Map(row.results.map((r) => [r.agentKey, r]));
  // Agentes ausentes = análise gerada antes de o agente existir → "skipped"
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
  };
}

export function toAnalysisSummaryDTO(row: AnalysisSummaryRow): AnalysisSummaryDTO {
  return {
    id: row.id,
    title: row.title,
    hint: row.hint,
    kind: asKind(row.kind),
    depth: asDepth(row.depth),
    status: row.status as AnalysisStatus,
    createdAt: row.createdAt.toISOString(),
    durationMs: row.durationMs,
    doneAgents: row.doneAgents,
    totalAgents: AGENT_KEYS.length,
  };
}
