import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  createAnalysisSchema,
  listQuerySchema,
  retrySchema,
  validateUserSources,
} from '../src/lib/anima/validation';
import { AGENT_KEYS, DEPTHS, SOURCE_KINDS, WORK_KINDS } from '../src/lib/anima/types';

test('cleanText remove aspas duplas e controles', () => {
  assert.equal(cleanText('  "A"\n\tobra  '), "'A' obra");
});

test('createAnalysisSchema aplica padrões e normaliza', () => {
  const ok = createAnalysisSchema.parse({ title: '  Dom   Casmurro ', hint: '' });
  assert.deepEqual(ok, {
    title: 'Dom Casmurro',
    hint: null,
    focus: null,
    kind: 'auto',
    depth: 'standard',
    agents: [...AGENT_KEYS],
    sources: [],
    force: false,
  });
  assert.equal(createAnalysisSchema.safeParse({ title: 'a' }).success, false);
  assert.equal(createAnalysisSchema.safeParse({ title: 'x'.repeat(161) }).success, false);
  assert.equal(createAnalysisSchema.safeParse({ title: 'Ok', kind: 'inexistente' }).success, false);
  assert.equal(createAnalysisSchema.safeParse({ title: 'Ok', depth: 'gigante' }).success, false);
});

test('createAnalysisSchema aceita recorte, lentes e fontes', () => {
  const parsed = createAnalysisSchema.parse({
    title: 'Breaking Bad',
    kind: 'series',
    depth: 'exhaustive',
    focus: '  temporada 4, arco do Gus  ',
    agents: ['characters', 'thematic', 'characters'],
    sources: [{ type: 'url', value: 'https://pt.wikipedia.org/wiki/Breaking_Bad' }],
  });
  assert.equal(parsed.focus, 'temporada 4, arco do Gus');
  assert.deepEqual(parsed.agents, ['characters', 'thematic']); // sem duplicatas
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.depth, 'exhaustive');
});

test('createAnalysisSchema rejeita recorte absurdo e lista vazia de lentes vira todas', () => {
  assert.equal(createAnalysisSchema.safeParse({ title: 'Ok', focus: 'x'.repeat(400) }).success, false);
  const parsed = createAnalysisSchema.parse({ title: 'Ok', agents: [] });
  assert.deepEqual(parsed.agents, [...AGENT_KEYS]);
});

test('validateUserSources bloqueia alvos internos e aceita links públicos e trechos', () => {
  const bad = validateUserSources([{ type: 'url', value: 'http://169.254.169.254/latest/meta-data' }]);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /inválido ou não permitido/i);

  const short = validateUserSources([{ type: 'text', value: 'curto demais' }]);
  assert.equal(short.ok, false);

  const good = validateUserSources([
    { type: 'url', value: 'https://pt.wikipedia.org/wiki/Dom_Casmurro' },
    { type: 'text', value: 'Capitu olha de soslaio e o narrador insiste na sua tese de traição.'.padEnd(60, '.') },
  ]);
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.sources.length, 2);
    assert.equal(good.sources[0].type, 'url');
  }
});

test('listQuerySchema valida filtros do histórico', () => {
  assert.deepEqual(listQuerySchema.parse({}), { status: 'all', kind: 'all', limit: 30 });
  assert.equal(listQuerySchema.parse({ limit: '5' }).limit, 5);
  assert.equal(listQuerySchema.safeParse({ status: 'qualquer' }).success, false);
  assert.equal(listQuerySchema.safeParse({ limit: '999' }).success, false);
  for (const kind of WORK_KINDS) assert.equal(listQuerySchema.parse({ kind }).kind, kind);
});

test('retrySchema aceita lentes e etapas', () => {
  const parsed = retrySchema.parse({ agentKeys: ['thematic'], research: true });
  assert.deepEqual(parsed.agentKeys, ['thematic']);
  assert.equal(retrySchema.safeParse({ agentKeys: ['inexistente'] }).success, false);
});

test('as constantes de tipo, profundidade e fontes estão coerentes', () => {
  assert.equal(new Set(WORK_KINDS).size, WORK_KINDS.length);
  assert.equal(new Set(SOURCE_KINDS).size, SOURCE_KINDS.length);
  assert.deepEqual([...DEPTHS], ['brief', 'standard', 'deep', 'exhaustive']);
});
