// ANIMA — API: comparações entre duas análises.
//
// POST roda a comparação na hora (uma chamada ao modelo) e grava o resultado. GET lista o histórico.
// Não há fila: comparação é curta e não compete com o pipeline.

import { NextRequest, NextResponse } from 'next/server';
import { compareAnalyses, toComparisonDTO } from '@/lib/anima/comparison';
import { toAnalysisDTO } from '@/lib/anima/dto';
import { createLLM, isFatalLLMError, isRateLimitError } from '@/lib/anima/llm';
import { getStore } from '@/lib/anima/store-index';
import { firstIssue, comparisonSchema, listQuerySchema } from '@/lib/anima/validation';
import { getSystemStatus } from '@/lib/anima/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

    const store = await getStore();
    const rows = await store.listComparisons(parsed.data.limit);
    return NextResponse.json({ comparisons: rows.map(toComparisonDTO) });
  } catch (error) {
    console.error('[GET /api/comparisons]', error);
    return NextResponse.json({ error: 'Falha ao carregar as comparações.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = comparisonSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    const { leftId, rightId } = parsed.data;

    const status = getSystemStatus();
    if (!status.configured) {
      return NextResponse.json({ error: status.message ?? 'O LLM não está configurado.' }, { status: 503 });
    }

    const store = await getStore();
    const [leftRow, rightRow] = await Promise.all([store.get(leftId), store.get(rightId)]);
    if (!leftRow || !rightRow) {
      return NextResponse.json({ error: 'Uma das análises não existe mais. Atualize a lista.' }, { status: 404 });
    }
    if (leftRow.status !== 'completed' || rightRow.status !== 'completed') {
      return NextResponse.json(
        { error: 'As duas análises precisam estar concluídas para serem comparadas.' },
        { status: 409 }
      );
    }

    const row = await store.createComparison({
      leftId,
      rightId,
      leftTitle: leftRow.title,
      rightTitle: rightRow.title,
    });

    try {
      const result = await compareAnalyses({
        left: toAnalysisDTO(leftRow),
        right: toAnalysisDTO(rightRow),
        llm: createLLM(),
      });
      await store.updateComparison(row.id, {
        status: 'completed',
        content: result.content,
        model: result.model,
        durationMs: Math.round(result.durationMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.updateComparison(row.id, { status: 'failed', error: message });
      throw error;
    }

    const saved = await store.getComparison(row.id);
    return NextResponse.json({ comparison: saved ? toComparisonDTO(saved) : null }, { status: 201 });
  } catch (error) {
    if (isRateLimitError(error)) {
      return NextResponse.json(
        { error: 'O provedor está limitando as chamadas agora. Tente de novo em alguns minutos.' },
        { status: 429 }
      );
    }
    if (isFatalLLMError(error)) {
      return NextResponse.json({ error: 'A comparação falhou por configuração do provedor.' }, { status: 502 });
    }
    console.error('[POST /api/comparisons]', error);
    return NextResponse.json({ error: 'Não foi possível comparar agora. Tente de novo.' }, { status: 500 });
  }
}
