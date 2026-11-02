// ANIMA — tipos compartilhados entre backend e frontend (sem dependências de servidor)

/** Especialistas, na ordem canônica de exibição. Chaves antigas foram mantidas para compatibilidade com o banco. */
export const AGENT_KEYS = [
  'structural',
  'narratology',
  'characters',
  'thematic',
  'stylistic',
  'psychological',
  'cultural',
  'critical',
] as const;

export type AgentKey = (typeof AGENT_KEYS)[number];

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === 'string' && (AGENT_KEYS as readonly string[]).includes(value);
}

/** `skipped`: o agente não existia quando a análise foi gerada (análises antigas). */
export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type AnalysisStatus =
  | 'researching'
  | 'analyzing'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'interrupted';

export const ACTIVE_STATUSES: readonly AnalysisStatus[] = ['researching', 'analyzing', 'synthesizing'];

export function isActiveStatus(status: AnalysisStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export const WORK_KINDS = ['auto', 'book', 'film', 'series', 'game', 'theatre', 'comics', 'other'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  auto: 'Detectar automaticamente',
  book: 'Livro / conto / poema',
  film: 'Filme',
  series: 'Série',
  game: 'Jogo',
  theatre: 'Peça de teatro',
  comics: 'Quadrinhos / mangá',
  other: 'Outro',
};

export const DEPTHS = ['standard', 'deep'] as const;
export type Depth = (typeof DEPTHS)[number];

export const DEPTH_LABELS: Record<Depth, { label: string; description: string }> = {
  standard: { label: 'Padrão', description: '≈ 600–900 palavras por especialista' },
  deep: { label: 'Aprofundada', description: '≈ 1.000–1.500 palavras por especialista' },
};

export interface SourceDTO {
  id: string; // F1, F2…
  title: string;
  url: string;
  origin: 'wikipedia' | 'tavily' | 'zai';
}

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
  hint: string | null;
  kind: WorkKind;
  depth: Depth;
  status: AnalysisStatus;
  research: string | null;
  researchStatus: AgentStatus;
  sources: SourceDTO[];
  synthesis: string | null;
  synthesisStatus: AgentStatus;
  error: string | null;
  durationMs: number | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  results: AgentResultDTO[];
}

export interface AnalysisSummaryDTO {
  id: string;
  title: string;
  hint: string | null;
  kind: WorkKind;
  depth: Depth;
  status: AnalysisStatus;
  createdAt: string;
  durationMs: number | null;
  doneAgents: number;
  totalAgents: number;
}

export interface SystemStatusDTO {
  provider: 'openai' | 'zai' | 'mock';
  configured: boolean;
  model: string | null;
  search: 'tavily' | 'wikipedia' | 'zai' | 'none';
  message: string | null;
}
