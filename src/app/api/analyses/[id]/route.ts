// ANIMA — API: detalhe de uma análise (GET) e exclusão do histórico (DELETE)

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toAnalysisDTO } from '@/lib/anima/dto';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await db.analysis.findUnique({
      where: { id },
      include: { results: true },
    });
    if (!row) {
      return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ analysis: toAnalysisDTO(row) });
  } catch (error) {
    console.error('[GET /api/analyses/:id]', error);
    return NextResponse.json({ error: 'Falha ao carregar a análise.' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await db.analysis.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
    }
    await db.analysis.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[DELETE /api/analyses/:id]', error);
    return NextResponse.json({ error: 'Falha ao excluir a análise.' }, { status: 500 });
  }
}
