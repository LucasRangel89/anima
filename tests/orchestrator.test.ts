import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'mock';
process.env.MOCK_DELAY_MS = '5';
process.env.ANIMA_STORE = 'memory';
process.env.ANIMA_MAX_ACTIVE = '3';

import { createMemoryStore } from '../src/lib/anima/store-memory';
import { setStore } from '../src/lib/anima/store-index';
import {
  cancelAnalysis,
  deleteAnalysis,
  queueLength,
  queuePosition,
  reapOrphans,
  retryAnalysis,
  startAnalysis,
  waitForIdle,
  waitForRun,
} from '../src/lib/anima/orchestrator';
import { toAnalysisDTO } from '../src/lib/anima/dto';
import { AGENT_KEYS } from '../src/lib/anima/types';
import type { AnalysisStore } from '../src/lib/anima/store';

let store: AnalysisStore;
beforeEach(() => {
  store = createMemoryStore();
  setStore(store);
  process.env.MOCK_FAIL_LABELS = '';
  process.env.ANIMA_MAX_ACTIVE = '3';
});
afterEach(async () => {
  await waitForIdle();
  setStore(undefined);
});

const input = {
  title: 'Dom Casmurro',
  hint: null,
  focus: null,
  kind: 'book',
  depth: 'standard',
} as const;

test('pipeline completo: dossiê, 8 especialistas e síntese', async () => {
  const { row, queued } = await startAnalysis(input);
  assert.equal(queued, false);
  await waitForRun(row.id);
  const dto = toAnalysisDTO((await store.get(row.id))!);

  assert.equal(dto.status, 'completed');
  assert.equal(dto.researchStatus, 'done');
  assert.ok(dto.research);
  assert.equal(dto.sources.length, 1);
  assert.equal(dto.results.length, AGENT_KEYS.length);
  assert.ok(dto.results.every((r) => r.status === 'done' && r.content));
  assert.equal(dto.synthesisStatus, 'done');
  assert.ok(dto.synthesis);
  assert.ok(dto.durationMs !== null && dto.durationMs >= 0);
  assert.equal(dto.model, 'mock');
  assert.equal(dto.progress, 100);
});

test('só as lentes escolhidas rodam; as demais ficam skipped', async () => {
  const { row } = await startAnalysis({ ...input, agents: ['structural', 'thematic'] });
  await waitForRun(row.id);
  const dto = toAnalysisDTO((await store.get(row.id))!);

  assert.equal(dto.status, 'completed');
  assert.equal(dto.results.filter((r) => r.status === 'done').length, 2);
  assert.equal(dto.results.filter((r) => r.status === 'skipped').length, AGENT_KEYS.length - 2);
  assert.equal(dto.synthesisStatus, 'done'); // com 2 lentes, o mínimo de síntese cai para 2
});

test('o recorte é persistido e chega ao prompt', async () => {
  const focus = 'apenas o capítulo final';
  const { row } = await startAnalysis({ ...input, focus, agents: ['structural'] });
  await waitForRun(row.id);
  const dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.focus, focus);
  assert.equal(dto.status, 'completed');
});

test('falha de um especialista não aborta; retry reexecuta só o que falhou e refaz a síntese', async () => {
  process.env.MOCK_FAIL_LABELS = 'especialista:thematic';
  const { row } = await startAnalysis(input);
  await waitForRun(row.id);

  let dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'completed');
  assert.equal(dto.results.find((r) => r.agentKey === 'thematic')!.status, 'failed');
  assert.equal(dto.results.filter((r) => r.status === 'done').length, AGENT_KEYS.length - 1);
  assert.equal(dto.synthesisStatus, 'done'); // 7 de 8 bastam

  process.env.MOCK_FAIL_LABELS = '';
  const res = await retryAnalysis(row.id);
  assert.equal(res.ok, true);
  await waitForRun(row.id);

  dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'completed');
  assert.ok(dto.results.every((r) => r.status === 'done'));
});

test('falha do pesquisador marca a análise como failed e permite retomar', async () => {
  process.env.MOCK_FAIL_LABELS = 'pesquisador';
  const { row } = await startAnalysis(input);
  await waitForRun(row.id);

  let dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'failed');
  assert.equal(dto.researchStatus, 'failed');
  assert.match(dto.error ?? '', /pesquisa falhou/i);
  assert.ok(dto.results.every((r) => r.status === 'pending'));

  process.env.MOCK_FAIL_LABELS = '';
  assert.equal((await retryAnalysis(row.id)).ok, true);
  await waitForRun(row.id);
  dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'completed');
});

test('se nenhum especialista concluir, a análise falha com o motivo', async () => {
  process.env.MOCK_FAIL_LABELS = AGENT_KEYS.map((k) => `especialista:${k}`).join(',');
  const { row } = await startAnalysis(input);
  await waitForRun(row.id);
  const dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'failed');
  assert.match(dto.error ?? '', /Nenhum especialista/);
});

test('retry é recusado enquanto a análise está em execução', async () => {
  process.env.MOCK_DELAY_MS = '40';
  const { row } = await startAnalysis(input);
  const res = await retryAnalysis(row.id);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'busy');
  await waitForRun(row.id);
  process.env.MOCK_DELAY_MS = '5';
});

test('excedente entra na fila, informa a posição e roda quando abre vaga', async () => {
  process.env.ANIMA_MAX_ACTIVE = '1';
  process.env.MOCK_DELAY_MS = '20';

  const first = await startAnalysis({ ...input, title: 'Primeira' });
  const second = await startAnalysis({ ...input, title: 'Segunda' });
  const third = await startAnalysis({ ...input, title: 'Terceira' });

  assert.equal(first.queued, false);
  assert.equal(second.queued, true);
  assert.equal(second.queuePosition, 1);
  assert.equal(third.queuePosition, 2);
  assert.equal(queueLength(), 2);
  assert.equal(queuePosition(second.row.id), 1);
  assert.equal(toAnalysisDTO((await store.get(second.row.id))!).status, 'queued');
  assert.equal(toAnalysisDTO((await store.get(second.row.id))!).progress, 0);

  await waitForRun(first.row.id);
  // a fila anda sozinha: ao final, todas concluídas
  await waitForIdle();
  for (const id of [first.row.id, second.row.id, third.row.id]) {
    assert.equal(toAnalysisDTO((await store.get(id))!).status, 'completed', `análise ${id}`);
  }
  assert.equal(queueLength(), 0);
  process.env.MOCK_DELAY_MS = '5';
  process.env.ANIMA_MAX_ACTIVE = '3';
});

test('cancelar uma análise em andamento interrompe e preserva o que já foi escrito', async () => {
  process.env.MOCK_DELAY_MS = '120';
  const { row } = await startAnalysis({ ...input, agents: ['structural', 'thematic'] });
  // espera o dossiê terminar e os especialistas começarem
  for (let i = 0; i < 100; i++) {
    const current = await store.get(row.id);
    if (current?.results.some((r) => r.status === 'running')) break;
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.equal(await cancelAnalysis(row.id), true);
  await waitForRun(row.id);

  const dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'interrupted');
  assert.match(dto.error ?? '', /cancelada/i);
  assert.equal(dto.progress < 100, true);
  assert.ok(dto.results.every((r) => ['failed', 'done', 'skipped'].includes(r.status)));

  // nada mais escreve depois do cancelamento
  const snapshot = JSON.stringify((await store.get(row.id))!.results);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(JSON.stringify((await store.get(row.id))!.results), snapshot);

  process.env.MOCK_DELAY_MS = '5';
  assert.equal((await retryAnalysis(row.id)).ok, true);
  await waitForRun(row.id);
  assert.equal(toAnalysisDTO((await store.get(row.id))!).status, 'completed');
});

test('cancelar uma análise que está na fila a remove sem executar', async () => {
  process.env.ANIMA_MAX_ACTIVE = '1';
  process.env.MOCK_DELAY_MS = '30';
  const first = await startAnalysis({ ...input, title: 'Primeira' });
  const second = await startAnalysis({ ...input, title: 'Segunda' });
  assert.equal(second.queued, true);

  assert.equal(await cancelAnalysis(second.row.id), true);
  assert.equal(queuePosition(second.row.id), null);
  const dto = toAnalysisDTO((await store.get(second.row.id))!);
  assert.equal(dto.status, 'interrupted');
  assert.match(dto.error ?? '', /na fila/i);

  await waitForRun(first.row.id);
  await waitForIdle();
  assert.equal(toAnalysisDTO((await store.get(second.row.id))!).status, 'interrupted');
  process.env.MOCK_DELAY_MS = '5';
  process.env.ANIMA_MAX_ACTIVE = '3';
});

test('reapOrphans marca como interrupted análises ativas sem execução e o retry as retoma', async () => {
  const row = await store.create({ ...input, agentKeys: AGENT_KEYS, userSources: null, model: 'mock' });
  await store.update(row.id, { status: 'analyzing', researchStatus: 'done', research: '## Dossiê' });
  await store.updateAgent(row.id, 'structural', { status: 'running' });

  // dentro do período de carência não deve interromper
  assert.equal(await reapOrphans(), 0);

  // envelhece a linha
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  try {
    assert.equal(await reapOrphans(), 1);
  } finally {
    Date.now = realNow;
  }

  let dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'interrupted');
  assert.equal(dto.results.find((r) => r.agentKey === 'structural')!.status, 'failed');

  assert.equal((await retryAnalysis(row.id)).ok, true);
  await waitForRun(row.id);
  dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'completed');
});

test('excluir durante a execução não derruba o processo', async () => {
  process.env.MOCK_DELAY_MS = '30';
  const { row } = await startAnalysis(input);
  assert.equal(await deleteAnalysis(row.id), true);
  await waitForRun(row.id); // não deve lançar
  assert.equal(await store.get(row.id), null);
  process.env.MOCK_DELAY_MS = '5';
});

test('análises antigas (sem os agentes novos) aparecem como skipped e podem ser executadas sob demanda', async () => {
  const legacyKeys = ['structural', 'characters', 'thematic', 'stylistic', 'psychological', 'cultural'] as const;
  const row = await store.create({ ...input, agentKeys: legacyKeys, userSources: null, model: null });
  for (const k of legacyKeys) await store.updateAgent(row.id, k, { status: 'done', content: 'ok' });
  await store.update(row.id, { status: 'completed', researchStatus: 'done', research: 'dossiê' });

  let dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.results.find((r) => r.agentKey === 'narratology')!.status, 'skipped');
  assert.equal(dto.results.find((r) => r.agentKey === 'critical')!.status, 'skipped');

  const res = await retryAnalysis(row.id, { agentKeys: ['narratology', 'critical'] });
  assert.equal(res.ok, true);
  await waitForRun(row.id);
  dto = toAnalysisDTO((await store.get(row.id))!);
  assert.ok(dto.results.every((r) => r.status === 'done'));
  assert.equal(dto.synthesisStatus, 'done');
});

test('findLatestCompleted reaproveita análise equivalente ignorando caixa e acentos', async () => {
  const { row } = await startAnalysis({ ...input, title: 'Cem Anos de Solidão' });
  await waitForRun(row.id);
  const hit = await store.findLatestCompleted('cem anos de solidao', 'book', 'standard', null, null);
  assert.equal(hit?.id, row.id);
  assert.equal(await store.findLatestCompleted('cem anos de solidao', 'film', 'standard', null, null), null);
  // recorte diferente não reaproveita
  assert.equal(await store.findLatestCompleted('cem anos de solidao', 'book', 'standard', null, 'Capítulo 1'), null);
});
