// ANIMA — API: criação de análises (POST) e histórico (GET)

import { NextRequest, NextResponse } from 'next/server';
import { toAnalysisSummaryDTO } from '@/lib/anima/dto';
import {
  activeRunCount,
  maxActiveRuns,
  maxQueuedRuns,
  queueLength,
  queuePosition,
  reapOrphans,
  startAnalysis,
} from '@/lib/anima/orchestrator';
import { getSystemStatus } from '@/lib/anima/status';
import { getStore } from '@/lib/anima/store-index';
import { analysisRateLimit, rateLimitResponse } from '@/lib/anima/rate-limit';
import { createAnalysisSchema, firstIssue, listQuerySchema, validateUserSources } from '@/lib/anima/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const parsed = createAnalysisSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { title, hint, focus, kind, depth, agents, sources, force } = parsed.data;

    const checked = validateUserSources(sources);
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

    const status = getSystemStatus();
    if (!status.configured) {
      return NextResponse.json({ error: status.message ?? 'O LLM não está configurado.' }, { status: 503 });
    }

    // Segunda barreira depois do token de acesso: impede que um script queime a cota em minutos.
    const limit = analysisRateLimit();
    if (!limit.ok) {
      const { message, retryAfterSeconds } = rateLimitResponse(limit, 'análises');
      return NextResponse.json(
        { error: message },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const store = await getStore();

    // Reaproveita uma análise equivalente já concluída (evita gasto de API), salvo pedido em contrário
    if (!force) {
      const existing = await store.findLatestCompleted(title, kind, depth, hint, focus);
      if (existing) {
        return NextResponse.json({ id: existing.id, reused: true, queued: false, queuePosition: null });
      }
    }

    await reapOrphans();
    if (activeRunCount() >= maxActiveRuns() && queueLength() >= maxQueuedRuns()) {
      return NextResponse.json(
        { error: `Há ${activeRunCount()} análises em andamento e a fila está cheia. Aguarde uma concluir.` },
        { status: 429 }
      );
    }

    const started = await startAnalysis({ title, hint, focus, kind, depth, agents, userSources: checked.sources });
    return NextResponse.json(
      {
        id: started.row.id,
        reused: false,
        queued: started.queued,
        queuePosition: started.queuePosition ?? queuePosition(started.row.id),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/analyses]', error);
    return NextResponse.json({ error: 'Falha ao iniciar a análise.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    }
    const { status, kind, limit } = parsed.data;

    await reapOrphans();
    const store = await getStore();
    const rows = await store.list({ limit, status, kind });
    return NextResponse.json({
      analyses: rows.map((row) => toAnalysisSummaryDTO(row, { queuePosition: queuePosition(row.id) })),
      queue: { active: activeRunCount(), max: maxActiveRuns(), waiting: queueLength() },
    });
  } catch (error) {
    console.error('[GET /api/analyses]', error);
    return NextResponse.json({ error: 'Falha ao carregar o histórico.' }, { status: 500 });
  }
}
