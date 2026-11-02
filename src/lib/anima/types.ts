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

/**
 * `skipped`: o agente não foi selecionado para esta análise ou não existia quando ela foi gerada.
 * `pending`  : selecionado, aguardando a vez.
 */
export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type AnalysisStatus =
  | 'queued'
  | 'researching'
  | 'analyzing'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'interrupted';

/** Status em que a análise ainda vai mudar sem intervenção do usuário. */
export const ACTIVE_STATUSES: readonly AnalysisStatus[] = ['queued', 'researching', 'analyzing', 'synthesizing'];

export function isActiveStatus(status: AnalysisStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/** Status em que a análise ocupa CPU/LLM (a fila não ocupa). */
export const RUNNING_STATUSES: readonly AnalysisStatus[] = ['researching', 'analyzing', 'synthesizing'];

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

/* ───────────────────────── Profundidade ───────────────────────── */

export const DEPTHS = ['brief', 'standard', 'deep', 'exhaustive'] as const;
export type Depth = (typeof DEPTHS)[number];

export interface DepthInfo {
  label: string;
  /** Uma linha, exibida no formulário */
  description: string;
  /** Faixa de palavras por especialista */
  words: [number, number];
  /** Custo relativo, para o usuário decidir (1 = mais barato) */
  cost: 1 | 2 | 3 | 4;
  /** Estimativa de duração de uma análise completa */
  minutes: [number, number];
}

export const DEPTH_LABELS: Record<Depth, DepthInfo> = {
  brief: {
    label: 'Panorama',
    description: 'Uma tese por lente, ~350–500 palavras',
    words: [350, 500],
    cost: 1,
    minutes: [2, 4],
  },
  standard: {
    label: 'Padrão',
    description: 'Equilíbrio entre cobertura e fôlego, ~600–900 palavras',
    words: [600, 900],
    cost: 2,
    minutes: [4, 8],
  },
  deep: {
    label: 'Aprofundada',
    description: 'Argumento desenvolvido e leituras concorrentes, ~1.000–1.500 palavras',
    words: [1000, 1500],
    cost: 3,
    minutes: [8, 15],
  },
  exhaustive: {
    label: 'Exaustiva',
    description: 'Monografia curta por lente, com estado da crítica, ~1.800–2.400 palavras',
    words: [1800, 2400],
    cost: 4,
    minutes: [15, 30],
  },
};

export function isDepth(value: unknown): value is Depth {
  return typeof value === 'string' && (DEPTHS as readonly string[]).includes(value);
}

export function isWorkKind(value: unknown): value is WorkKind {
  return typeof value === 'string' && (WORK_KINDS as readonly string[]).includes(value);
}

/** Normaliza valores legados do banco (ex.: `deep` antes de existirem brief/exhaustive). */
export function asDepth(value: unknown, fallback: Depth = 'standard'): Depth {
  return isDepth(value) ? value : fallback;
}

export function asWorkKind(value: unknown, fallback: WorkKind = 'auto'): WorkKind {
  return isWorkKind(value) ? value : fallback;
}

/* ───────────────────────── Fontes ───────────────────────── */

export const SOURCE_ORIGINS = ['wikipedia', 'openlibrary', 'openalex', 'tmdb', 'tavily', 'zai', 'user'] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const SOURCE_ORIGIN_LABELS: Record<SourceOrigin, string> = {
  wikipedia: 'Wikipédia',
  openlibrary: 'Open Library',
  openalex: 'OpenAlex',
  tmdb: 'TMDB',
  tavily: 'Web (Tavily)',
  zai: 'Web (Z.ai)',
  user: 'Fornecida por você',
};

/** Natureza do documento — ajuda o pesquisador a hierarquizar o que é fato e o que é opinião. */
export const SOURCE_KINDS = ['encyclopedia', 'bibliography', 'academic', 'credits', 'review', 'web', 'user'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  encyclopedia: 'Enciclopédia',
  bibliography: 'Ficha bibliográfica',
  academic: 'Crítica acadêmica',
  credits: 'Ficha técnica',
  review: 'Crítica / imprensa',
  web: 'Web',
  user: 'Enviada por você',
};

export type Reliability = 'alta' | 'média' | 'baixa';

export interface SourceDTO {
  id: string; // F1, F2…
  title: string;
  url: string;
  origin: SourceOrigin;
  kind?: SourceKind;
  /** Código de idioma (pt, en…) quando conhecido */
  lang?: string | null;
  year?: number | null;
  author?: string | null;
  publisher?: string | null;
  reliability?: Reliability;
  /** Observação curta exibida na lista de fontes (ex.: "412 citações") */
  note?: string | null;
}

export const RELIABILITY_LABELS: Record<Reliability, string> = {
  alta: 'confiabilidade alta',
  média: 'confiabilidade média',
  baixa: 'confiabilidade baixa',
};

/* ───────────────────────── DTOs ───────────────────────── */

export interface AgentResultDTO {
  agentKey: AgentKey;
  status: AgentStatus;
  content: string | null;
  error: string | null;
  durationMs: number | null;
}

/** Contabilidade de chamadas/tokens de uma análise (exibida no relatório). */
export interface UsageStageDTO {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface UsageDTO {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** `true` quando o provedor não informou `usage` e os números foram estimados. */
  estimated: boolean;
  byStage: Record<string, UsageStageDTO>;
  contextLimit: number;
  /** Avisos de contexto reduzido / modelo alternativo. */
  notices: string[];
}

/**
 * Pergunta de acompanhamento: uma pergunta do usuário respondida **com o material já gerado** (dossiê e
 * lentes), sem nova rodada de pesquisa. Fica guardada na análise para sobreviver a recarregar a página.
 */
export interface FollowUpDTO {
  id: string;
  question: string;
  answer: string;
  /** Modelo que respondeu (pode diferir do modelo da análise, se houve fallback). */
  model: string | null;
  createdAt: string;
  durationMs: number | null;
}

export interface AnalysisDTO {
  id: string;
  title: string;
  hint: string | null;
  /** Recorte pedido pelo usuário (capítulo, temporada, personagem, aspecto…) */
  focus: string | null;
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
  /** Chamadas e tokens gastos; null em análises antigas ou ainda sem chamadas. */
  usage: UsageDTO | null;
  createdAt: string;
  updatedAt: string;
  results: AgentResultDTO[];
  /** 0–100, calculado a partir das etapas concluídas */
  progress: number;
  /** Posição na fila (1 = próxima); null quando não está na fila */
  queuePosition: number | null;
  /** Perguntas de acompanhamento já respondidas (mais antigas primeiro). */
  followUps: FollowUpDTO[];
}

/** Comparação entre duas análises concluídas (registro próprio, com histórico). */
export interface ComparisonDTO {
  id: string;
  status: 'running' | 'completed' | 'failed';
  left: { id: string; title: string };
  right: { id: string; title: string };
  content: string | null;
  error: string | null;
  model: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AnalysisSummaryDTO {
  id: string;
  title: string;
  hint: string | null;
  focus: string | null;
  kind: WorkKind;
  depth: Depth;
  status: AnalysisStatus;
  createdAt: string;
  durationMs: number | null;
  doneAgents: number;
  totalAgents: number;
  /** 0–100 */
  progress: number;
  queuePosition: number | null;
}

export interface SystemStatusDTO {
  provider: 'openai' | 'zai' | 'mock';
  configured: boolean;
  model: string | null;
  /** Melhor fonte disponível (para resumo rápido) */
  search: 'tavily' | 'wikipedia' | 'zai' | 'none';
  /** Todas as fontes habilitadas no momento */
  sources: SourceOrigin[];
  message: string | null;
  queue: { active: number; max: number; waiting: number };
}
