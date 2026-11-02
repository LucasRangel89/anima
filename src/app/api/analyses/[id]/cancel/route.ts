// ANIMA — API: cancelar uma análise (na fila ou em andamento), preservando o que já foi escrito.

import { NextRequest, NextResponse } from 'next/server';
import { cancelAnalysis } from '@/lib/anima/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cancelled = await cancelAnalysis(id);
    if (!cancelled) {
      return NextResponse.json(
        { error: 'Não há nada para cancelar: a análise não está na fila nem em andamento.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, message: 'Análise cancelada. Você pode retomá-la quando quiser.' });
  } catch (error) {
    console.error('[POST /api/analyses/:id/cancel]', error);
    return NextResponse.json({ error: 'Falha ao cancelar a análise.' }, { status: 500 });
  }
}
