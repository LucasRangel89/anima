// ANIMA — comparação entre duas obras.
//
// Três camadas: o texto que vai ao modelo (contexto das duas obras, com orçamento), a chamada (uma, com
// fallback) e a rota completa contra o store de memória — inclusive quando uma das análises some.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANIMA_STORE = 'memory';
process.env.LLM_PROVIDER = 'mock';

import { NextRequest } from 'next/server';

import {
  buildComparisonContext,
  buildComparisonMessages,
  compareAnalyses,
  comparisonSide,
  toComparisonDTO,
} from '../src/lib/anima/comparison';
import { createMemoryStore } from '../src/lib/anima/store-memory';
import { setStore } from '../src/lib/anima/store-index';
import { estimateTokens } from '../src/lib/anima/budget';
import { LLMError, type LLM } from '../src/lib/anima/llm';
import { AGENT_KEYS, type AnalysisDTO } from '../src/lib/anima/types';
import { GET as getComparisons, POST as postComparison } from '../src/app/api/comparisons/route';
import { DELETE as deleteComparison, GET as getComparison } from '../src/app/api/comparisons/[id]/route';

function dto(title: string, overrides: Partial<AnalysisDTO> = {}): AnalysisDTO {
  return {
    id: `id-${title.toLowerCase()}`,
    title,
    hint: null,
    focus: null,
    kind: 'book',
    depth: 'brief',
    status: 'completed',
    research: `Dossiê de ${title}: enredo, personagens, contexto.`,
    researchStatus: 'done',
    sources: [],
    synthesis: `Síntese de ${title}: a tese de leitura.`,
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
      content: `Lente ${key} de ${title}.`,
      error: null,
      durationMs: 1,
    })),
    progress: 100,
    queuePosition: null,
    followUps: [],
    ...overrides,
  };
}

function fakeLLM(text: string, overrides: Partial<LLM> = {}): LLM {
  return {
    provider: 'mock',
    model: 'modelo-falso',
    async complete() {
      return { text, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
    },
    ...overrides,
  };
}

/* ───────────────────────── contexto ───────────────────────── */

test('cada lado leva dossiê e síntese, identificado por lado', () => {
  const side = comparisonSide(dto('Dom Casmurro'), 'A');
  assert.match(side, /<obra lado="A"/);
  assert.match(side, /# Dom Casmurro/);
  assert.match(side, /Dossiê de Dom Casmurro/);
  assert.match(side, /Síntese de Dom Casmurro/);
  assert.ok(!side.includes('Lente structural'), 'as oito lentes não entram na comparação');
});

test('contexto gigante é reduzido e continua com as duas obras', () => {
  const huge = dto('Cem Anos de Solidão', { research: 'palavra '.repeat(30_000) });
  const { context, trimmed } = buildComparisonContext(dto('Dom Casmurro'), huge, 1_500);

  assert.equal(trimmed, true);
  assert.ok(estimateTokens(context) <= 1_500 * 1.2, `contexto com ${estimateTokens(context)} tokens`);
  assert.match(context, /Dom Casmurro/);
  assert.match(context, /Cem Anos de Solidão/);
});

test('as mensagens pedem as quatro seções e proíbem invenção', () => {
  const { system, user } = buildComparisonMessages(dto('A'), dto('B'), '<obra lado="A">x</obra>');
  for (const heading of ['O que aproxima', 'O que separa', 'O que uma ilumina na outra', 'Veredito']) {
    assert.ok(system.includes(heading), `falta a seção ${heading}`);
  }
  assert.match(system, /†/);
  assert.match(system, /Não invente/);
  assert.match(user, /Compare as duas obras/);
});

/* ───────────────────────── chamada ───────────────────────── */

test('comparação devolve conteúdo, modelo e uso', async () => {
  const result = await compareAnalyses({
    left: dto('Dom Casmurro'),
    right: dto('Cem Anos de Solidão'),
    llm: fakeLLM('## O que aproxima\n\nAmbas.\n\n## Veredito\n\nEmpate.'),
  });
  assert.match(result.content, /O que aproxima/);
  assert.equal(result.model, 'modelo-falso');
  assert.equal(result.usage?.totalTokens, 15);
  assert.equal(result.trimmed, false);
});

test('resposta vazia falha alto', async () => {
  await assert.rejects(
    () => compareAnalyses({ left: dto('A'), right: dto('B'), llm: fakeLLM('   ') }),
    /vazia/
  );
});

test('429 persistente cai para o modelo alternativo', async () => {
  const primary: LLM = {
    provider: 'mock',
    model: 'principal',
    async complete() {
      throw new LLMError('429', 429, 1);
    },
    withModel: (model) => ({ ...fakeLLM('## Veredito\n\nDo alternativo.'), model }),
  };

  const result = await compareAnalyses({
    left: dto('A'),
    right: dto('B'),
    llm: primary,
    env: { NODE_ENV: 'test', LLM_FALLBACK_MODEL: 'alternativo' },
  });
  assert.equal(result.model, 'alternativo');
  assert.match(result.content, /alternativo/);
});

/* ───────────────────────── rota ───────────────────────── */

async function seed(store: ReturnType<typeof createMemoryStore>, title: string, status: 'completed' | 'analyzing' = 'completed') {
  const row = await store.create({
    title,
    hint: null,
    focus: null,
    kind: 'book',
    depth: 'brief',
    agentKeys: AGENT_KEYS,
    userSources: null,
    model: 'mock',
  });
  await store.update(row.id, {
    status,
    research: `Dossiê de ${title}.`,
    researchStatus: 'done',
    synthesis: `Síntese de ${title}.`,
    synthesisStatus: 'done',
  });
  return row.id;
}

const post = (body: unknown) =>
  postComparison(
    new NextRequest('http://localhost/api/comparisons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

test('rota: comparação válida vira registro salvo e aparece na listagem', async () => {
  const store = createMemoryStore();
  setStore(store);
  const left = await seed(store, 'Dom Casmurro');
  const right = await seed(store, 'Cem Anos de Solidão');

  const response = await post({ leftId: left, rightId: right });
  assert.equal(response.status, 201);
  const body = (await response.json()) as { comparison: { id: string; status: string; content: string; left: { title: string } } };
  assert.equal(body.comparison.status, 'completed');
  assert.ok(body.comparison.content.length > 0);
  assert.equal(body.comparison.left.title, 'Dom Casmurro');

  const listResponse = await getComparisons(new NextRequest('http://localhost/api/comparisons?limit=10'));
  const list = (await listResponse.json()) as { comparisons: Array<{ id: string }> };
  assert.equal(list.comparisons.length, 1);
  assert.equal(list.comparisons[0].id, body.comparison.id);
});

test('rota: validação recusa ids iguais, vazios e análise inexistente', async () => {
  const store = createMemoryStore();
  setStore(store);
  const left = await seed(store, 'Dom Casmurro');
  const right = await seed(store, 'Cem Anos de Solidão');

  assert.equal((await post({ leftId: left, rightId: left })).status, 400);
  assert.equal((await post({ leftId: '', rightId: right })).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ leftId: left, rightId: 'nao-existe' })).status, 404);
});

test('rota: análise ainda em andamento → 409, sem registro criado', async () => {
  const store = createMemoryStore();
  setStore(store);
  const left = await seed(store, 'Dom Casmurro');
  const running = await seed(store, 'Cem Anos de Solidão', 'analyzing');

  const response = await post({ leftId: left, rightId: running });
  assert.equal(response.status, 409);
  assert.equal((await store.listComparisons(10)).length, 0);
});

test('rota: GET por id e DELETE', async () => {
  const store = createMemoryStore();
  setStore(store);
  const left = await seed(store, 'A');
  const right = await seed(store, 'B');
  const created = (await (await post({ leftId: left, rightId: right })).json()) as { comparison: { id: string } };

  const one = await getComparison(new NextRequest('http://localhost/'), { params: Promise.resolve({ id: created.comparison.id }) });
  assert.equal(one.status, 200);

  const removed = await deleteComparison(new NextRequest('http://localhost/'), {
    params: Promise.resolve({ id: created.comparison.id }),
  });
  assert.equal(removed.status, 200);
  assert.equal((await store.listComparisons(10)).length, 0);

  const again = await deleteComparison(new NextRequest('http://localhost/'), {
    params: Promise.resolve({ id: created.comparison.id }),
  });
  assert.equal(again.status, 404);
});

test('a comparação sobrevive ao sumiço de uma das análises (títulos gravados)', async () => {
  const store = createMemoryStore();
  setStore(store);
  const left = await seed(store, 'Dom Casmurro');
  const right = await seed(store, 'Cem Anos de Solidão');
  const created = (await (await post({ leftId: left, rightId: right })).json()) as { comparison: { id: string } };

  await store.delete(left);
  const saved = await store.getComparison(created.comparison.id);
  assert.ok(saved);
  assert.equal(saved!.leftTitle, 'Dom Casmurro');
  assert.equal(toComparisonDTO(saved!).left.title, 'Dom Casmurro');
});
