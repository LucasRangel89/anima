// ANIMA — API: uma comparação (GET) e remoção (DELETE).

import { NextRequest, NextResponse } from 'next/server';
import { toComparisonDTO } from '@/lib/anima/comparison';
import { getStore } from '@/lib/anima/store-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const row = await (await getStore()).getComparison(id);
    if (!row) return NextResponse.json({ error: 'Comparação não encontrada.' }, { status: 404 });
    return NextResponse.json({ comparison: toComparisonDTO(row) });
  } catch (error) {
    console.error('[GET /api/comparisons/:id]', error);
    return NextResponse.json({ error: 'Falha ao carregar a comparação.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const deleted = await (await getStore()).deleteComparison(id);
    if (!deleted) return NextResponse.json({ error: 'Comparação não encontrada.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/comparisons/:id]', error);
    return NextResponse.json({ error: 'Falha ao remover a comparação.' }, { status: 500 });
  }
}
