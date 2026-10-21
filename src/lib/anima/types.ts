// ANIMA — tipos compartilhados entre backend e frontend

export const AGENT_KEYS = [
  'structural',
  'characters',
  'thematic',
  'stylistic',
  'psychological',
  'cultural',
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed';

export type AnalysisStatus = 'researching' | 'analyzing' | 'completed' | 'failed';

export interface AgentResultDTO {
  agentKey: AgentKey;
  status: AgentStatus;
  content: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface AnalysisDTO {
  id: string;
  title: string;
  status: AnalysisStatus;
  research: string | null;
  researchStatus: AgentStatus;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  results: AgentResultDTO[];
}

export interface AnalysisSummaryDTO {
  id: string;
  title: string;
  status: AnalysisStatus;
  createdAt: string;
  durationMs: number | null;
  doneAgents: number;
  totalAgents: number;
}
