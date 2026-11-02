// ANIMA — rota de perguntas de acompanhamento, exercitada de verdade.
//
// Sem servidor HTTP: chamamos os handlers como o Next faria. O store é o de memória (isolado por teste) e o
// LLM é o mock — o que se prova aqui é validação, estado, persistência e limpeza, não a qualidade da prosa.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANIMA_STORE = 'memory';
process.env.LLM_PROVIDER = 'mock';

import { NextRequest } from 'next/server';

import { createMemoryStore } from '../src/lib/anima/store-memory';
import { setStore } from '../src/lib/anima/store-index';
import type { AnalysisStore } from '../src/lib/anima/store';
import { DELETE, POST } from '../src/app/api/analyses/[id]/questions/route';
import { AGENT_KEYS } from '../src/lib/anima/types';

async function seed(store: AnalysisStore, status: 'completed' | 'analyzing' = 'completed') {
  const row = await store.create({
    title: 'Dom Casmurro',
    hint: 'Machado de Assis',
    focus: null,
    kind: 'book',
    depth: 'brief',
    agentKeys: AGENT_KEYS,
    userSources: null,
    model: 'mock',
  });
  await store.update(row.id, {
    status,
    research: 'Capitu e Bento.',
    researchStatus: 'done',
    synthesis: 'A dúvida é o método.',
    synthesisStatus: 'done',
  });
  for (const key of AGENT_KEYS) {
    await store.updateAgent(row.id, key, { status: 'done', content: `Análise de ${key}.`, durationMs: 5 });
  }
  return row.id;
}

const post = (id: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/analyses/${id}/questions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

const del = (id: string, questionId?: string) =>
  DELETE(
    new NextRequest(
      `http://localhost/api/analyses/${id}/questions${questionId ? `?questionId=${encodeURIComponent(questionId)}` : ''}`,
      { method: 'DELETE' }
    ),
    { params: Promise.resolve({ id }) }
  );

test('pergunta válida: 201, resposta salva e devolvida', async () => {
  const store = createMemoryStore();
  setStore(store);
  const id = await seed(store);

  const response = await post(id, { question: 'Capitu traiu?' });
  const body = (await response.json()) as { followUp: { id: string; question: string; answer: string } };

  assert.equal(response.status, 201);
  assert.equal(body.followUp.question, 'Capitu traiu?');
  assert.ok(body.followUp.answer.length > 0);

  const stored = await store.get(id);
  const saved = JSON.parse(stored!.followUps ?? '[]') as Array<{ id: string }>;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, body.followUp.id);
});

test('pergunta recusada por validação, com mensagem legível', async () => {
  const store = createMemoryStore();
  setStore(store);
  const id = await seed(store);

  for (const body of [{}, { question: '  ' }, { question: 'x'.repeat(501) }, { question: 42 }]) {
    const response = await post(id, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    const data = (await response.json()) as { error: string };
    assert.ok(data.error.length > 5);
  }
  assert.equal((await store.get(id))!.followUps, null, 'nada foi gravado');
});

test('análise inexistente → 404; análise em andamento → 409', async () => {
  const store = createMemoryStore();
  setStore(store);

  assert.equal((await post('nao-existe', { question: 'E o ciúme?' })).status, 404);

  const running = await seed(store, 'analyzing');
  const response = await post(running, { question: 'E o ciúme?' });
  assert.equal(response.status, 409);
  const data = (await response.json()) as { error: string };
  assert.match(data.error, /ainda não terminou/);
});

test('o teto de perguntas é respeitado', async () => {
  const store = createMemoryStore();
  setStore(store);
  const id = await seed(store);

  const full = Array.from({ length: 30 }, (_, index) => ({
    id: `q_${index}`,
    question: `pergunta ${index}`,
    answer: 'resposta',
    model: 'mock',
    createdAt: new Date().toISOString(),
    durationMs: 1,
  }));
  await store.update(id, { followUps: JSON.stringify(full) });

  const response = await post(id, { question: 'mais uma?' });
  assert.equal(response.status, 429);
});

test('remover pergunta existente limpa o registro; inexistente → 404', async () => {
  const store = createMemoryStore();
  setStore(store);
  const id = await seed(store);

  const created = (await (await post(id, { question: 'Capitu traiu?' })).json()) as { followUp: { id: string } };

  assert.equal((await del(id, 'q_inexistente')).status, 404);
  assert.equal((await del(id)).status, 400);

  const response = await del(id, created.followUp.id);
  assert.equal(response.status, 200);
  assert.equal((await store.get(id))!.followUps, null, 'sem perguntas, o campo volta a null');
});

test('JSON corrompido no banco não derruba a rota', async () => {
  const store = createMemoryStore();
  setStore(store);
  const id = await seed(store);
  await store.update(id, { followUps: '{isso não é json' });

  const response = await post(id, { question: 'Ainda responde?' });
  assert.equal(response.status, 201);
  const stored = JSON.parse((await store.get(id))!.followUps ?? '[]') as unknown[];
  assert.equal(stored.length, 1, 'o lixo anterior é descartado, não acumulado');
});
