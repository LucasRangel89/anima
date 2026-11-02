// ANIMA — perguntas de acompanhamento.
//
// Duas frentes: o prompt (o que entra no contexto, e o que sai quando não cabe) e o comportamento de rede
// (resposta, 429 com nova tentativa, fallback de modelo, resposta vazia). O LLM é falso: nenhuma chamada real.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FOLLOW_UPS,
  answerFollowUp,
  buildFollowUpContext,
  buildFollowUpMessages,
  toFollowUpRecord,
} from '../src/lib/anima/follow-up';
import { suggestedQuestions } from '../src/lib/anima/follow-up-suggestions';
import { estimateTokens } from '../src/lib/anima/budget';
import { LLMError, type LLM, type LLMRequest } from '../src/lib/anima/llm';
import { AGENT_KEYS, type AnalysisDTO } from '../src/lib/anima/types';

function dto(overrides: Partial<AnalysisDTO> = {}): AnalysisDTO {
  return {
    id: 'a1',
    title: 'Dom Casmurro',
    hint: 'Machado de Assis, 1899',
    focus: null,
    kind: 'book',
    depth: 'brief',
    status: 'completed',
    research: '# Dossiê\n\nCapitu e Bento. O narrador é Bentinho.',
    researchStatus: 'done',
    sources: [],
    synthesis: 'A dúvida é o método.',
    synthesisStatus: 'done',
    error: null,
    durationMs: 1000,
    model: 'modelo-x',
    usage: null,
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:01.000Z',
    results: AGENT_KEYS.map((key) => ({
      agentKey: key,
      status: 'done' as const,
      content: `Texto da lente ${key} sobre Capitu.`,
      error: null,
      durationMs: 10,
    })),
    progress: 100,
    queuePosition: null,
    followUps: [],
    ...overrides,
  };
}

function fakeLLM(answer: string, overrides: Partial<LLM> = {}): LLM & { seen: LLMRequest[] } {
  const seen: LLMRequest[] = [];
  return {
    provider: 'mock',
    model: 'modelo-falso',
    seen,
    async complete(req) {
      seen.push(req);
      return { text: answer, usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } };
    },
    ...overrides,
  } as LLM & { seen: LLMRequest[] };
}

/* ───────────────────────── contexto ───────────────────────── */

test('o contexto leva dossiê e apenas as lentes concluídas', () => {
  const analysis = dto({
    results: AGENT_KEYS.map((key, index) => ({
      agentKey: key,
      status: index === 0 ? ('done' as const) : ('failed' as const),
      content: index === 0 ? 'Apenas a primeira lente.' : null,
      error: index === 0 ? null : 'falhou',
      durationMs: 1,
    })),
  });
  const { context, trimmed } = buildFollowUpContext(analysis, 10_000);
  assert.match(context, /Capitu e Bento/);
  assert.match(context, /Apenas a primeira lente/);
  assert.ok(!context.includes('Texto da lente'), 'lentes falhas não entram');
  assert.equal(trimmed, false);
});

test('contexto gigante é reduzido dentro do orçamento e avisa que foi reduzido', () => {
  const huge = dto({ research: '# Dossiê\n\n' + 'palavra '.repeat(20_000) });
  const budget = 1_500;
  const { context, trimmed } = buildFollowUpContext(huge, budget);

  assert.equal(trimmed, true);
  assert.ok(estimateTokens(context) <= budget * 1.15, `contexto com ${estimateTokens(context)} tokens estourou ${budget}`);
  assert.match(context, /<dossie>/);
  assert.match(context, /<analises>/);
});

test('a mensagem traz obra, dossiê, pergunta e a marca do recorte', () => {
  const { system, user } = buildFollowUpMessages(
    dto({ focus: 'a questão da traição' }),
    'Capitu traiu?',
    '<dossie>material</dossie>'
  );
  assert.match(system, /português do Brasil/);
  assert.match(system, /†/);
  assert.match(user, /Dom Casmurro/);
  assert.match(user, /Machado de Assis, 1899/);
  assert.match(user, /Recorte desta análise: a questão da traição/);
  assert.match(user, /<pergunta>\nCapitu traiu\?\n<\/pergunta>/);
  assert.ok(!user.includes('\n\n\n'), 'sem triplas quebras de linha');
});

/* ───────────────────────── sugestões ───────────────────────── */

test('sugestões vêm do que a análise tem e não passam de quatro', () => {
  const full = suggestedQuestions(dto());
  assert.ok(full.length > 0 && full.length <= 4);
  assert.ok(full.some((q) => q.includes('objeção mais forte')), 'com a lente Crítica, sugere a objeção');

  const minimal = suggestedQuestions(
    dto({
      results: AGENT_KEYS.map((key) => ({
        agentKey: key,
        status: 'skipped' as const,
        content: null,
        error: null,
        durationMs: null,
      })),
    })
  );
  assert.ok(!minimal.some((q) => q.includes('objeção mais forte')), 'sem a lente, não sugere o que ela responderia');
  assert.ok(minimal.length > 0, 'sempre há ao menos uma pergunta útil');
});

test('o recorte pedido vira a primeira sugestão', () => {
  const withFocus = suggestedQuestions(dto({ focus: 'o ciúme' }));
  assert.match(withFocus[0], /o ciúme/);
});

/* ───────────────────────── chamadas ───────────────────────── */

test('resposta normal volta com modelo, duração e uso', async () => {
  const llm = fakeLLM('Capitu é lida como culpada porque o narrador a condena (Estrutura).†');
  const result = await answerFollowUp({ analysis: dto(), question: 'Capitu traiu?', llm });

  assert.match(result.answer, /Capitu/);
  assert.equal(result.model, 'modelo-falso');
  assert.ok(result.durationMs >= 0);
  assert.equal(result.contextTrimmed, false);
  assert.equal(result.usage?.totalTokens, 150);
  assert.equal(llm.seen.length, 1);
  assert.equal(llm.seen[0].label, 'pergunta');
  assert.equal(llm.seen[0].maxTokens, 900);
});

test('429 passageiro é refeito e a pergunta é respondida', async () => {
  let calls = 0;
  const llm = fakeLLM('Resposta depois da espera.');
  const flaky: LLM = {
    provider: 'mock',
    model: 'modelo-falso',
    async complete(req) {
      calls += 1;
      if (calls === 1) throw new LLMError('429 Too Many Requests', 429, 10);
      return llm.complete(req);
    },
  };

  const result = await answerFollowUp({ analysis: dto(), question: 'E o ciúme?', llm: flaky });
  assert.equal(calls, 2);
  assert.match(result.answer, /depois da espera/);
});

test('429 persistente usa LLM_FALLBACK_MODEL uma única vez', async () => {
  const fallback = fakeLLM('Resposta do modelo alternativo.');
  const primary: LLM = {
    provider: 'mock',
    model: 'modelo-principal',
    async complete() {
      throw new LLMError('429 Too Many Requests', 429, 1);
    },
    withModel: (model: string) => ({ ...fallback, model }),
  };

  const result = await answerFollowUp({
    analysis: dto(),
    question: 'E a crítica?',
    llm: primary,
    env: { NODE_ENV: 'test', LLM_FALLBACK_MODEL: 'modelo-alternativo' },
  });

  assert.match(result.answer, /modelo alternativo/);
  assert.equal(result.model, 'modelo-alternativo');
});

test('erro fatal (401) não é repetido', async () => {
  let calls = 0;
  const llm: LLM = {
    provider: 'mock',
    model: 'modelo-falso',
    async complete() {
      calls += 1;
      throw new LLMError('401 Unauthorized', 401);
    },
  };

  await assert.rejects(() => answerFollowUp({ analysis: dto(), question: 'x?', llm }), /401/);
  assert.equal(calls, 1, 'credencial errada não melhora com nova tentativa');
});

test('resposta vazia vira erro claro, nunca uma pergunta "respondida" com nada', async () => {
  const llm = fakeLLM('   ');
  await assert.rejects(() => answerFollowUp({ analysis: dto(), question: 'x?', llm }), /vazia/);
});

test('o registro persistido tem id único, pergunta, resposta e modelo', () => {
  const a = toFollowUpRecord('Capitu traiu?', {
    answer: 'Depende do narrador.',
    model: 'm',
    durationMs: 1234.4,
    contextTrimmed: false,
  });
  const b = toFollowUpRecord('Capitu traiu?', {
    answer: 'Depende do narrador.',
    model: 'm',
    durationMs: 10,
    contextTrimmed: false,
  });

  assert.ok(a.id.startsWith('q_'));
  assert.notEqual(a.id, b.id);
  assert.equal(a.durationMs, 1234);
  assert.equal(a.question, 'Capitu traiu?');
  assert.equal(a.model, 'm');
  assert.ok(!Number.isNaN(Date.parse(a.createdAt)));
  assert.equal(MAX_FOLLOW_UPS, 30);
});
