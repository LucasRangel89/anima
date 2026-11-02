// ANIMA — API: detalhe de uma análise (GET) e exclusão do histórico (DELETE)

import { NextRequest, NextResponse } from 'next/server';
import { toAnalysisDTO } from '@/lib/anima/dto';
import { deleteAnalysis, queuePosition, reapOrphans } from '@/lib/anima/orchestrator';
import { getStore } from '@/lib/anima/store-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    await reapOrphans();
    const row = await (await getStore()).get(id);
    if (!row) return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
    return NextResponse.json({ analysis: toAnalysisDTO(row, { queuePosition: queuePosition(row.id) }) });
  } catch (error) {
    console.error('[GET /api/analyses/:id]', error);
    return NextResponse.json({ error: 'Falha ao carregar a análise.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const deleted = await deleteAnalysis(id);
    if (!deleted) return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/analyses/:id]', error);
    return NextResponse.json({ error: 'Falha ao excluir a análise.' }, { status: 500 });
  }
}
