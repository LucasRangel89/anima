// ANIMA — persistência com Prisma + SQLite (produção).

import { db } from '@/lib/db';
import type { AnalysisRow, AnalysisStore, AnalysisSummaryRow } from './store';
import { AGENT_KEYS, type WorkKind } from './types';

const ACTIVE_STATUSES = ['queued', 'researching', 'analyzing', 'synthesizing'];

/**
 * Ordena as lentes na ordem canônica do produto.
 * O SQLite devolve as linhas na ordem em que foram inseridas, mas isso é detalhe de implementação:
 * a interface e os testes dependem da ordem, então ela é garantida aqui.
 */
function withOrderedResults<T extends { results: Array<{ agentKey: string }> }>(row: T): T {
  const position = (key: string) => {
    const index = (AGENT_KEYS as readonly string[]).indexOf(key);
    return index === -1 ? AGENT_KEYS.length : index;
  };
  return { ...row, results: [...row.results].sort((a, b) => position(a.agentKey) - position(b.agentKey)) };
}

/** Violação de chave estrangeira: a análise foi apagada enquanto uma lente escrevia. */
function isMissingParent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2003'
  );
}

/** Filtro estreito: compatível com `AnalysisWhereInput` sem depender do client gerado em tempo de teste. */
type AnalysisWhere = { status?: string | { in: string[] }; kind?: string };
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export const prismaStore: AnalysisStore = {
  async create(input) {
    const row = await db.analysis.create({
      data: {
        title: input.title,
        hint: input.hint,
        focus: input.focus,
        kind: input.kind,
        depth: input.depth,
        model: input.model,
        userSources: input.userSources,
        status: 'researching',
        researchStatus: 'running',
        results: { create: input.agentKeys.map((agentKey) => ({ agentKey, status: 'pending' })) },
      },
      include: { results: true },
    });
    return withOrderedResults(row) as AnalysisRow;
  },

  async get(id) {
    const row = await db.analysis.findUnique({ where: { id }, include: { results: true } });
    return row ? (withOrderedResults(row) as AnalysisRow) : null;
  },

  async list({ limit, status, kind }) {
    const where: AnalysisWhere = {};
    if (status === 'active') where.status = { in: ACTIVE_STATUSES };
    else if (status && status !== 'all') where.status = status;
    if (kind && kind !== 'all') where.kind = kind;

    const rows = await db.analysis.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        hint: true,
        focus: true,
        kind: true,
        depth: true,
        status: true,
        researchStatus: true,
        synthesisStatus: true,
        createdAt: true,
        durationMs: true,
        results: { select: { status: true } },
      },
    });
    return rows.map(
      ({ results, ...r }): AnalysisSummaryRow => ({
        ...r,
        kind: r.kind as WorkKind,
        doneAgents: results.filter((x) => x.status === 'done').length,
        totalAgents: results.length,
      })
    );
  },

  async listActive() {
    return db.analysis.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      select: { id: true, updatedAt: true },
    });
  },

  async update(id, patch) {
    await db.analysis.updateMany({ where: { id }, data: patch });
  },

  async updateAgent(id, agentKey, patch) {
    try {
      await db.agentResult.upsert({
        where: { analysisId_agentKey: { analysisId: id, agentKey } },
        create: { analysisId: id, agentKey, ...patch },
        update: patch,
      });
    } catch (error) {
      // Se o usuário excluiu a análise no meio da execução, a linha da lente não pode ser criada.
      // O orquestrador já tolera isso (`safe`), mas engolir aqui evita ruído de erro no log.
      if (!isMissingParent(error)) throw error;
    }
  },

  async delete(id) {
    const { count } = await db.analysis.deleteMany({ where: { id } });
    return count > 0;
  },

  async findLatestCompleted(title, kind, depth, hint, focus) {
    const candidates = await db.analysis.findMany({
      where: { status: 'completed', kind, depth, hint: hint ?? null, focus: focus ?? null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { results: true },
    });
    const match = candidates.find((r) => normalize(r.title) === normalize(title));
    return match ? (withOrderedResults(match) as AnalysisRow) : null;
  },
};
