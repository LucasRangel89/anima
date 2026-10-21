// ANIMA — API: criação de análises (POST) e histórico (GET)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runAnalysisPipeline } from '@/lib/anima/orchestrator';
import { toAnalysisSummaryDTO } from '@/lib/anima/dto';
import { AGENT_KEYS } from '@/lib/anima/types';

const MAX_RUNNING = 3;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';

    if (title.length < 2 || title.length > 160) {
      return NextResponse.json(
        { error: 'Informe um título com entre 2 e 160 caracteres.' },
        { status: 400 }
      );
    }

    // Limite de análises simultâneas (proteção de custo/recursos)
    const running = await db.analysis.count({
      where: { status: { in: ['researching', 'analyzing'] } },
    });
    if (running >= MAX_RUNNING) {
      return NextResponse.json(
        { error: `Já existem ${running} análises em andamento. Aguarde uma concluir.` },
        { status: 429 }
      );
    }

    const analysis = await db.analysis.create({
      data: {
        title,
        status: 'researching',
        researchStatus: 'running',
        results: {
          create: AGENT_KEYS.map((key) => ({ agentKey: key, status: 'pending' })),
        },
      },
      include: { results: true },
    });

    // Dispara o pipeline em background — o frontend acompanha via polling
    void runAnalysisPipeline(analysis.id);

    return NextResponse.json(
      { id: analysis.id, summary: toAnalysisSummaryDTO(analysis) },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/analyses]', error);
    return NextResponse.json({ error: 'Falha ao iniciar a análise.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const rows = await db.analysis.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { results: true },
    });
    return NextResponse.json({ analyses: rows.map(toAnalysisSummaryDTO) });
  } catch (error) {
    console.error('[GET /api/analyses]', error);
    return NextResponse.json({ error: 'Falha ao carregar o histórico.' }, { status: 500 });
  }
}
