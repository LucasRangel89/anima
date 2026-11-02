// ANIMA — persistência com Prisma + SQLite (produção).

import { db } from '@/lib/db';
import type { AnalysisStore, AnalysisSummaryRow } from './store';
import type { WorkKind } from './types';

const ACTIVE_STATUSES = ['queued', 'researching', 'analyzing', 'synthesizing'];

/** Filtro estreito: compatível com `AnalysisWhereInput` sem depender do client gerado em tempo de teste. */
type AnalysisWhere = { status?: string | { in: string[] }; kind?: string };
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export const prismaStore: AnalysisStore = {
  async create(input) {
    return db.analysis.create({
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
  },

  async get(id) {
    return db.analysis.findUnique({ where: { id }, include: { results: true } });
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
    await db.agentResult.upsert({
      where: { analysisId_agentKey: { analysisId: id, agentKey } },
      create: { analysisId: id, agentKey, ...patch },
      update: patch,
    });
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
    return candidates.find((r) => normalize(r.title) === normalize(title)) ?? null;
  },
};
