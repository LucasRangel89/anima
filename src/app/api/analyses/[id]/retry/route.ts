// ANIMA — API: reexecução do pesquisador e/ou de especialistas com falha

import { NextRequest, NextResponse } from 'next/server';
import { retryAnalysis } from '@/lib/anima/orchestrator';
import { AGENT_KEYS, type AgentKey } from '@/lib/anima/types';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);

    let agentKeys: AgentKey[] | undefined;
    if (Array.isArray(body?.agentKeys) && body.agentKeys.length > 0) {
      const valid = body.agentKeys.filter((k: unknown) =>
        AGENT_KEYS.includes(k as AgentKey)
      ) as AgentKey[];
      if (valid.length === 0) {
        return NextResponse.json({ error: 'agentKeys inválidos.' }, { status: 400 });
      }
      agentKeys = valid;
    }

    const result = await retryAnalysis(id, agentKeys);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error) {
    console.error('[POST /api/analyses/:id/retry]', error);
    return NextResponse.json({ error: 'Falha ao reexecutar agentes.' }, { status: 500 });
  }
}
