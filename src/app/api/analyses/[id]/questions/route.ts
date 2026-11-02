// ANIMA — API: perguntas de acompanhamento (POST pergunta, DELETE remove).
//
// Uma pergunta é respondida com o material já gerado (dossiê + lentes): sem nova pesquisa, sem fila de
// lentes. O registro fica na análise, para o histórico sobreviver a recarregar a página.

import { NextRequest, NextResponse } from 'next/server';
import { parseFollowUps, toAnalysisDTO } from '@/lib/anima/dto';
import { getStore } from '@/lib/anima/store-index';
import { createLLM, isFatalLLMError, isRateLimitError } from '@/lib/anima/llm';
import { answerFollowUp, toFollowUpRecord } from '@/lib/anima/follow-up';
import { MAX_FOLLOW_UPS } from '@/lib/anima/follow-up';
import { firstIssue, followUpSchema } from '@/lib/anima/validation';
import { getSystemStatus } from '@/lib/anima/status';
import { extraCallRateLimit, rateLimitResponse } from '@/lib/anima/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Duas perguntas simultâneas na mesma análise não podem perder uma resposta: a leitura do JSON, a chamada e
 * a escrita acontecem uma de cada vez, por análise.
 */
const locks = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  void run.finally(() => {
    if (locks.get(key) === run) locks.delete(key);
  }).catch(() => undefined);
  return run;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const parsed = followUpSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });
    const { question } = parsed.data;

    const status = getSystemStatus();
    if (!status.configured) {
      return NextResponse.json({ error: status.message ?? 'O LLM não está configurado.' }, { status: 503 });
    }

    const limit = extraCallRateLimit();
    if (!limit.ok) {
      const { message, retryAfterSeconds } = rateLimitResponse(limit, 'perguntas e comparações');
      return NextResponse.json(
        { error: message },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
      );
    }

    const store = await getStore();

    return await serialize(id, async () => {
      const row = await store.get(id);
      if (!row) return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
      if (row.status !== 'completed') {
        return NextResponse.json(
          { error: 'A análise ainda não terminou. As perguntas ficam disponíveis quando o relatório está completo.' },
          { status: 409 }
        );
      }

      const existing = parseFollowUps(row.followUps);
      if (existing.length >= MAX_FOLLOW_UPS) {
        return NextResponse.json(
          { error: `Esta análise tem ${MAX_FOLLOW_UPS} perguntas. Remova alguma para continuar.` },
          { status: 429 }
        );
      }

      const llm = createLLM();
      const result = await answerFollowUp({ analysis: toAnalysisDTO(row), question, llm });
      const record = toFollowUpRecord(question, result);

      await store.update(id, { followUps: JSON.stringify([...existing, record]) });
      return NextResponse.json({ followUp: record, contextTrimmed: result.contextTrimmed }, { status: 201 });
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      return NextResponse.json(
        { error: 'O provedor está limitando as chamadas agora. Espera um pouco e tente de novo.' },
        { status: 429 }
      );
    }
    if (isFatalLLMError(error)) {
      return NextResponse.json({ error: 'A pergunta falhou por configuração do provedor.' }, { status: 502 });
    }
    console.error('[POST /api/analyses/:id/questions]', error);
    return NextResponse.json({ error: 'Não foi possível responder agora. Tente de novo.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const questionId = req.nextUrl.searchParams.get('questionId');
    if (!questionId) return NextResponse.json({ error: 'Informe qual pergunta remover.' }, { status: 400 });

    const store = await getStore();
    return await serialize(id, async () => {
      const row = await store.get(id);
      if (!row) return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
      const existing = parseFollowUps(row.followUps);
      const remaining = existing.filter((item) => item.id !== questionId);
      if (remaining.length === existing.length) {
        return NextResponse.json({ error: 'Pergunta não encontrada.' }, { status: 404 });
      }
      await store.update(id, { followUps: remaining.length ? JSON.stringify(remaining) : null });
      return NextResponse.json({ ok: true });
    });
  } catch (error) {
    console.error('[DELETE /api/analyses/:id/questions]', error);
    return NextResponse.json({ error: 'Não foi possível remover a pergunta.' }, { status: 500 });
  }
}
