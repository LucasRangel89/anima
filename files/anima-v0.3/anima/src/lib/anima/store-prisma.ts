// ANIMA — persistência com Prisma + SQLite (produção).

import { db } from '@/lib/db';
import type { AnalysisStore, AnalysisSummaryRow } from './store';

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export const prismaStore: AnalysisStore = {
  async create(input) {
    return db.analysis.create({
      data: {
        title: input.title,
        hint: input.hint,
        kind: input.kind,
        depth: input.depth,
        model: input.model,
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

  async list(limit) {
    const rows = await db.analysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        hint: true,
        kind: true,
        depth: true,
        status: true,
        createdAt: true,
        durationMs: true,
        results: { select: { status: true } },
      },
    });
    return rows.map(
      ({ results, ...r }): AnalysisSummaryRow => ({
        ...r,
        doneAgents: results.filter((x) => x.status === 'done').length,
      })
    );
  },

  async listActive() {
    return db.analysis.findMany({
      where: { status: { in: ['researching', 'analyzing', 'synthesizing'] } },
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

  async findLatestCompleted(title, kind, depth, hint) {
    const candidates = await db.analysis.findMany({
      where: { status: 'completed', kind, depth, hint: hint ?? null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { results: true },
    });
    return candidates.find((r) => normalize(r.title) === normalize(title)) ?? null;
  },
};
