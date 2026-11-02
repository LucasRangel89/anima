// ANIMA — persistência em memória (testes e modo demonstração; dados somem ao reiniciar).

import type { AgentKey, AnalysisStatus, WorkKind } from './types';
import type {
  AgentPatch,
  AnalysisPatch,
  AnalysisRow,
  AnalysisStore,
  AnalysisSummaryRow,
  CreateAnalysisInput,
  ListOptions,
  StatusFilter,
} from './store';

let counter = 0;
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const ACTIVE: readonly string[] = ['queued', 'researching', 'analyzing', 'synthesizing'];

function matchesStatus(status: string, filter: StatusFilter | undefined): boolean {
  switch (filter) {
    case 'active':
      return ACTIVE.includes(status);
    case 'completed':
    case 'failed':
    case 'interrupted':
      return status === filter;
    default:
      return true;
  }
}

export function createMemoryStore(): AnalysisStore {
  const rows = new Map<string, AnalysisRow>();
  const clone = (row: AnalysisRow): AnalysisRow => structuredClone(row);

  return {
    async create(input: CreateAnalysisInput) {
      const now = new Date();
      const row: AnalysisRow = {
        id: `mem_${Date.now().toString(36)}_${(++counter).toString(36)}`,
        title: input.title,
        hint: input.hint,
        focus: input.focus,
        kind: input.kind,
        depth: input.depth,
        status: 'researching',
        research: null,
        researchStatus: 'running',
        sources: null,
        userSources: input.userSources,
        synthesis: null,
        synthesisStatus: 'pending',
        error: null,
        durationMs: null,
        model: input.model,
        usage: null,
        createdAt: now,
        updatedAt: now,
        results: input.agentKeys.map((agentKey) => ({
          agentKey,
          status: 'pending',
          content: null,
          error: null,
          durationMs: null,
        })),
      };
      rows.set(row.id, row);
      return clone(row);
    },

    async get(id) {
      const row = rows.get(id);
      return row ? clone(row) : null;
    },

    async list({ limit, status, kind }: ListOptions): Promise<AnalysisSummaryRow[]> {
      return [...rows.values()]
        .filter((r) => matchesStatus(r.status, status) && (!kind || kind === 'all' || r.kind === kind))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          title: r.title,
          hint: r.hint,
          focus: r.focus,
          kind: r.kind,
          depth: r.depth,
          status: r.status,
          researchStatus: r.researchStatus,
          synthesisStatus: r.synthesisStatus,
          createdAt: r.createdAt,
          durationMs: r.durationMs,
          doneAgents: r.results.filter((x) => x.status === 'done').length,
          totalAgents: r.results.length,
        }));
    },

    async listActive() {
      return [...rows.values()]
        .filter((r) => ACTIVE.includes(r.status))
        .map((r) => ({ id: r.id, updatedAt: r.updatedAt }));
    },

    async update(id, patch: AnalysisPatch) {
      const row = rows.get(id);
      if (!row) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
      }
      row.updatedAt = new Date();
    },

    async updateAgent(id, agentKey: AgentKey, patch: AgentPatch) {
      const row = rows.get(id);
      if (!row) return;
      let agent = row.results.find((r) => r.agentKey === agentKey);
      if (!agent) {
        agent = { agentKey, status: 'pending', content: null, error: null, durationMs: null };
        row.results.push(agent);
      }
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) (agent as unknown as Record<string, unknown>)[k] = v;
      }
      row.updatedAt = new Date();
    },

    async delete(id) {
      return rows.delete(id);
    },

    async findLatestCompleted(title, kind: WorkKind, depth, hint, focus) {
      const match = [...rows.values()]
        .filter(
          (r) =>
            r.status === ('completed' satisfies AnalysisStatus) &&
            r.kind === kind &&
            r.depth === depth &&
            (r.hint ?? '') === (hint ?? '') &&
            (r.focus ?? '') === (focus ?? '') &&
            normalize(r.title) === normalize(title)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return match ? clone(match) : null;
    },
  };
}
