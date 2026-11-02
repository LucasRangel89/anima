// ANIMA — contrato de persistência. O orquestrador depende só desta interface;
// há uma implementação Prisma (produção) e uma em memória (testes / demonstração).

import type { AgentKey, AgentStatus, AnalysisStatus, Depth, WorkKind } from './types';

export interface AgentResultRow {
  agentKey: string;
  status: string;
  content: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface AnalysisRow {
  id: string;
  title: string;
  hint: string | null;
  kind: string;
  depth: string;
  status: string;
  research: string | null;
  researchStatus: string;
  /** JSON de SourceDTO[] */
  sources: string | null;
  synthesis: string | null;
  synthesisStatus: string;
  error: string | null;
  durationMs: number | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  results: AgentResultRow[];
}

export interface AnalysisSummaryRow {
  id: string;
  title: string;
  hint: string | null;
  kind: string;
  depth: string;
  status: string;
  createdAt: Date;
  durationMs: number | null;
  doneAgents: number;
}

export interface CreateAnalysisInput {
  title: string;
  hint: string | null;
  kind: WorkKind;
  depth: Depth;
  agentKeys: readonly AgentKey[];
  model: string | null;
}

export interface AnalysisPatch {
  status?: AnalysisStatus;
  research?: string | null;
  researchStatus?: AgentStatus;
  sources?: string | null;
  synthesis?: string | null;
  synthesisStatus?: AgentStatus;
  error?: string | null;
  durationMs?: number | null;
  model?: string | null;
}

export interface AgentPatch {
  status?: AgentStatus;
  content?: string | null;
  error?: string | null;
  durationMs?: number | null;
}

export interface AnalysisStore {
  create(input: CreateAnalysisInput): Promise<AnalysisRow>;
  get(id: string): Promise<AnalysisRow | null>;
  list(limit: number): Promise<AnalysisSummaryRow[]>;
  /** Análises em andamento (researching | analyzing | synthesizing). */
  listActive(): Promise<Array<{ id: string; updatedAt: Date }>>;
  update(id: string, patch: AnalysisPatch): Promise<void>;
  /** Cria a linha do agente se ainda não existir (análises antigas). */
  updateAgent(id: string, agentKey: AgentKey, patch: AgentPatch): Promise<void>;
  delete(id: string): Promise<boolean>;
  findLatestCompleted(title: string, kind: WorkKind, depth: Depth, hint: string | null): Promise<AnalysisRow | null>;
}
