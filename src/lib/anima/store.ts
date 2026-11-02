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
  /** Recorte pedido pelo usuário (capítulo, temporada, personagem…) */
  focus: string | null;
  kind: string;
  depth: string;
  status: string;
  research: string | null;
  researchStatus: string;
  /** JSON de SourceDTO[] */
  sources: string | null;
  /** JSON de UserSourceInput[] enviados no formulário */
  userSources: string | null;
  synthesis: string | null;
  synthesisStatus: string;
  error: string | null;
  durationMs: number | null;
  model: string | null;
  /** JSON de AnalysisUsage: chamadas, tokens e avisos de contexto desta análise. */
  usage: string | null;
  createdAt: Date;
  updatedAt: Date;
  results: AgentResultRow[];
}

export interface AnalysisSummaryRow {
  id: string;
  title: string;
  hint: string | null;
  focus: string | null;
  kind: string;
  depth: string;
  status: string;
  researchStatus: string;
  synthesisStatus: string;
  createdAt: Date;
  durationMs: number | null;
  doneAgents: number;
  totalAgents: number;
}

export interface CreateAnalysisInput {
  title: string;
  hint: string | null;
  focus: string | null;
  kind: WorkKind;
  depth: Depth;
  /** Lentes selecionadas (subconjunto de AGENT_KEYS) */
  agentKeys: readonly AgentKey[];
  /** JSON de UserSourceInput[]; null quando não há fontes do usuário */
  userSources: string | null;
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
  usage?: string | null;
}

export interface AgentPatch {
  status?: AgentStatus;
  content?: string | null;
  error?: string | null;
  durationMs?: number | null;
}

export type StatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'interrupted';

export interface ListOptions {
  limit: number;
  status?: StatusFilter;
  kind?: WorkKind | 'all';
}

export interface AnalysisStore {
  create(input: CreateAnalysisInput): Promise<AnalysisRow>;
  get(id: string): Promise<AnalysisRow | null>;
  list(options: ListOptions): Promise<AnalysisSummaryRow[]>;
  /** Análises que ainda vão mudar de estado sem intervenção (inclui a fila). */
  listActive(): Promise<Array<{ id: string; updatedAt: Date }>>;
  update(id: string, patch: AnalysisPatch): Promise<void>;
  /** Cria a linha do agente se ainda não existir (análises antigas). */
  updateAgent(id: string, agentKey: AgentKey, patch: AgentPatch): Promise<void>;
  delete(id: string): Promise<boolean>;
  /** Análise concluída equivalente, para reaproveitar sem novo custo de API. */
  findLatestCompleted(
    title: string,
    kind: WorkKind,
    depth: Depth,
    hint: string | null,
    focus: string | null
  ): Promise<AnalysisRow | null>;
}
