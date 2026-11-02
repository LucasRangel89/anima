// ANIMA — API: criação de análises (POST) e histórico (GET)

import { NextRequest, NextResponse } from 'next/server';
import { toAnalysisSummaryDTO } from '@/lib/anima/dto';
import { getSystemStatus } from '@/lib/anima/llm';
import { activeRunCount, maxActiveRuns, reapOrphans, startAnalysis } from '@/lib/anima/orchestrator';
import { getStore } from '@/lib/anima/store-index';
import { createAnalysisSchema, firstIssue } from '@/lib/anima/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const parsed = createAnalysisSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { title, hint, kind, depth, force } = parsed.data;

    const status = getSystemStatus();
    if (!status.configured) {
      return NextResponse.json({ error: status.message ?? 'O LLM não está configurado.' }, { status: 503 });
    }

    const store = await getStore();

    // Reaproveita uma análise equivalente já concluída (evita gasto de API), salvo pedido em contrário
    if (!force) {
      const existing = await store.findLatestCompleted(title, kind, depth, hint);
      if (existing) {
        return NextResponse.json({ id: existing.id, reused: true });
      }
    }

    await reapOrphans();
    if (activeRunCount() >= maxActiveRuns()) {
      return NextResponse.json(
        { error: `Já existem ${activeRunCount()} análises em andamento. Aguarde uma concluir.` },
        { status: 429 }
      );
    }

    const analysis = await startAnalysis({ title, hint, kind, depth });
    return NextResponse.json({ id: analysis.id, reused: false }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/analyses]', error);
    return NextResponse.json({ error: 'Falha ao iniciar a análise.' }, { status: 500 });
  }
}

export async function GET() {
  try {
    await reapOrphans();
    const store = await getStore();
    const rows = await store.list(30);
    return NextResponse.json({ analyses: rows.map(toAnalysisSummaryDTO) });
  } catch (error) {
    console.error('[GET /api/analyses]', error);
    return NextResponse.json({ error: 'Falha ao carregar o histórico.' }, { status: 500 });
  }
}
