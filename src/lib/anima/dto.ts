// ANIMA — conversão das linhas do Prisma para DTOs da API

import type { Analysis, AgentResult } from '@prisma/client';
import type { AgentKey, AgentResultDTO, AnalysisDTO, AnalysisSummaryDTO } from './types';
import { AGENT_KEYS } from './types';

type AnalysisWithResults = Analysis & { results: AgentResult[] };

export function toAgentResultDTO(row: AgentResult): AgentResultDTO {
  return {
    agentKey: row.agentKey as AgentKey,
    status: row.status as AgentResultDTO['status'],
    content: row.content,
    error: row.error,
    durationMs: row.durationMs,
  };
}

export function toAnalysisDTO(row: AnalysisWithResults): AnalysisDTO {
  const byKey = new Map(row.results.map((r) => [r.agentKey, r]));
  // Garante a ordem canônica dos agentes e inclui pendentes ausentes
  const results: AgentResultDTO[] = AGENT_KEYS.map((key) => {
    const r = byKey.get(key);
    return r
      ? toAgentResultDTO(r)
      : { agentKey: key, status: 'pending', content: null, error: null, durationMs: null };
  });
  return {
    id: row.id,
    title: row.title,
    status: row.status as AnalysisDTO['status'],
    research: row.research,
    researchStatus: row.researchStatus as AnalysisDTO['researchStatus'],
    error: row.error,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    results,
  };
}

export function toAnalysisSummaryDTO(row: AnalysisWithResults): AnalysisSummaryDTO {
  return {
    id: row.id,
    title: row.title,
    status: row.status as AnalysisSummaryDTO['status'],
    createdAt: row.createdAt.toISOString(),
    durationMs: row.durationMs,
    doneAgents: row.results.filter((r) => r.status === 'done').length,
    totalAgents: AGENT_KEYS.length,
  };
}
