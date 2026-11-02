import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeProgress, toAnalysisDTO, toAnalysisSummaryDTO } from '../src/lib/anima/dto';
import type { AnalysisRow, AnalysisSummaryRow } from '../src/lib/anima/store';

const base: AnalysisRow = {
  id: 'a1',
  title: 'Dom Casmurro',
  hint: 'Machado de Assis, 1899',
  focus: null,
  kind: 'book',
  depth: 'deep',
  status: 'researching',
  research: null,
  researchStatus: 'running',
  sources: null,
  userSources: null,
  synthesis: null,
  synthesisStatus: 'pending',
  error: null,
  durationMs: null,
  model: 'gpt-4o-mini',
  usage: null,
  followUps: null,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-01T10:01:00Z'),
  results: [{ agentKey: 'thematic', status: 'pending', content: null, error: null, durationMs: null }],
};

test('computeProgress reflete as fases e nunca antecipa 100', () => {
  assert.equal(computeProgress({ status: 'queued', researchStatus: 'pending', synthesisStatus: 'pending', results: [] }), 0);
  assert.equal(computeProgress({ status: 'completed', researchStatus: 'done', synthesisStatus: 'done', results: [] }), 100);
  assert.equal(computeProgress({ status: 'researching', researchStatus: 'running', synthesisStatus: 'pending', results: [] }), 8);
  assert.equal(
    computeProgress({
      status: 'analyzing',
      researchStatus: 'done',
      synthesisStatus: 'pending',
      results: [{ status: 'done' }, { status: 'done' }, { status: 'pending' }, { status: 'failed' }],
    }),
    20 + 49 // 3 de 4 finalizados em 65
  );
  assert.equal(
    computeProgress({
      status: 'synthesizing',
      researchStatus: 'done',
      synthesisStatus: 'running',
      results: [{ status: 'done' }],
    }),
    20 + 65 + 8
  );
  assert.ok(
    computeProgress({ status: 'failed', researchStatus: 'done', synthesisStatus: 'failed', results: [{ status: 'failed' }] }) < 100
  );
});

test('toAnalysisDTO completa lentes ausentes como skipped e calcula progresso', () => {
  const dto = toAnalysisDTO({ ...base, status: 'analyzing' }, { queuePosition: null });
  assert.equal(dto.results.length, 8);
  assert.equal(dto.results.find((r) => r.agentKey === 'thematic')!.status, 'pending');
  assert.equal(dto.results.find((r) => r.agentKey === 'critical')!.status, 'skipped');
  assert.equal(dto.depth, 'deep');
  assert.equal(dto.focus, null);
  assert.ok(dto.progress > 0 && dto.progress < 100);
});

test('toAnalysisDTO tolera fontes e estados legados', () => {
  const dto = toAnalysisDTO({
    ...base,
    status: 'completed',
    researchStatus: 'done',
    synthesisStatus: 'done',
    sources: JSON.stringify([{ id: 'F1', title: 'Wikipédia', url: 'https://x.y', origin: 'wikipedia' }]),
    results: [{ agentKey: 'thematic', status: 'inventado', content: 'x', error: null, durationMs: 1 }],
    depth: 'profundidade-antiga',
    kind: 'meio-antigo',
  });
  assert.equal(dto.sources.length, 1);
  assert.equal(dto.sources[0].origin, 'wikipedia');
  assert.equal(dto.kind, 'auto');
  assert.equal(dto.depth, 'standard');
  assert.equal(dto.results.find((r) => r.agentKey === 'thematic')!.status, 'inventado');
  assert.equal(dto.progress, 100);
});

test('toAnalysisDTO descarta fontes em JSON inválido em vez de quebrar', () => {
  assert.deepEqual(toAnalysisDTO({ ...base, sources: '{nope' }).sources, []);
  assert.deepEqual(toAnalysisDTO({ ...base, sources: '{"a":1}' }).sources, []);
});

test('toAnalysisSummaryDTO traz progresso e posição na fila, com totais do banco', () => {
  const row: AnalysisSummaryRow = {
    id: 'a2',
    title: 'Interestelar',
    hint: null,
    focus: 'o buraco negro',
    kind: 'film',
    depth: 'brief',
    status: 'queued',
    researchStatus: 'pending',
    synthesisStatus: 'pending',
    createdAt: new Date('2026-02-02T12:00:00Z'),
    durationMs: null,
    doneAgents: 0,
    totalAgents: 3,
  };
  const dto = toAnalysisSummaryDTO(row, { queuePosition: 2 });
  assert.equal(dto.queuePosition, 2);
  assert.equal(dto.progress, 0);
  assert.equal(dto.totalAgents, 3);
  assert.equal(dto.focus, 'o buraco negro');
  assert.equal(dto.depth, 'brief');
});
