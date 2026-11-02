import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'mock';
process.env.MOCK_DELAY_MS = '5';
process.env.ANIMA_STORE = 'memory';

import { createMemoryStore } from '../src/lib/anima/store-memory';
import { setStore } from '../src/lib/anima/store-index';
import {
  deleteAnalysis,
  reapOrphans,
  retryAnalysis,
  startAnalysis,
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
});
afterEach(() => setStore(undefined));

const input = { title: 'Dom Casmurro', hint: null, kind: 'book', depth: 'standard' } as const;

test('pipeline completo: dossiê, 8 especialistas e síntese', async () => {
  const row = await startAnalysis(input);
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
});

test('falha de um especialista não aborta; retry reexecuta só o que falhou e refaz a síntese', async () => {
  process.env.MOCK_FAIL_LABELS = 'especialista:thematic';
  const row = await startAnalysis(input);
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
  const row = await startAnalysis(input);
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
  const row = await startAnalysis(input);
  await waitForRun(row.id);
  const dto = toAnalysisDTO((await store.get(row.id))!);
  assert.equal(dto.status, 'failed');
  assert.match(dto.error ?? '', /Nenhum especialista/);
});

test('retry é recusado enquanto a análise está em execução', async () => {
  process.env.MOCK_DELAY_MS = '40';
  const row = await startAnalysis(input);
  const res = await retryAnalysis(row.id);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.code, 'busy');
  await waitForRun(row.id);
  process.env.MOCK_DELAY_MS = '5';
});

test('reapOrphans marca como interrupted análises ativas sem execução e o retry as retoma', async () => {
  const row = await store.create({ ...input, agentKeys: AGENT_KEYS, model: 'mock' });
  await store.update(row.id, { status: 'analyzing', researchStatus: 'done', research: '## Dossiê' });
  await store.updateAgent(row.id, 'structural', { status: 'running' });
  // simula linha antiga: força updatedAt no passado
  (await store.get(row.id))!;
  const internal = await store.get(row.id);
  assert.ok(internal);

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
  const row = await startAnalysis(input);
  assert.equal(await deleteAnalysis(row.id), true);
  await waitForRun(row.id); // não deve lançar
  assert.equal(await store.get(row.id), null);
  process.env.MOCK_DELAY_MS = '5';
});

test('análises antigas (sem os agentes novos) aparecem como skipped e podem ser executadas sob demanda', async () => {
  const legacyKeys = ['structural', 'characters', 'thematic', 'stylistic', 'psychological', 'cultural'] as const;
  const row = await store.create({ ...input, agentKeys: legacyKeys, model: null });
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
  const row = await startAnalysis({ ...input, title: 'Cem Anos de Solidão' });
  await waitForRun(row.id);
  const hit = await store.findLatestCompleted('cem anos de solidao', 'book', 'standard', null);
  assert.equal(hit?.id, row.id);
  assert.equal(await store.findLatestCompleted('cem anos de solidao', 'film', 'standard', null), null);
});
