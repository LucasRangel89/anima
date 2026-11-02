// ANIMA — API: retomar análise (pesquisa, especialistas com falha/escolhidos e/ou síntese)

import { NextRequest, NextResponse } from 'next/server';
import { retryAnalysis } from '@/lib/anima/orchestrator';
import { firstIssue, retrySchema } from '@/lib/anima/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS = { not_found: 404, busy: 409, nothing: 400 } as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = retrySchema.safeParse((await req.json().catch(() => null)) ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const result = await retryAnalysis(id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: STATUS[result.code] });
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error) {
    console.error('[POST /api/analyses/:id/retry]', error);
    return NextResponse.json({ error: 'Falha ao reexecutar.' }, { status: 500 });
  }
}
