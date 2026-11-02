// ANIMA — testes das checagens de qualidade (Fase 2).
//
// O que se prova aqui: a régua mede o que diz medir e a conferência de referências é honesta — "não achei"
// e "não consegui consultar" são resultados DIFERENTES, e nenhum dos dois vira "confirmada".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOLDEN_WORKS,
  checkSection,
  countDaggers,
  countHeadings,
  countWords,
  evaluateAnalysis,
  hasLimitsSection,
  parseReferences,
  renderEvalReport,
  verifyReferences,
  type JsonFetcher,
} from '../src/lib/anima/eval';
import { AGENT_KEYS, type AnalysisDTO } from '../src/lib/anima/types';

const dto = (content: string, overrides: Partial<AnalysisDTO> = {}): AnalysisDTO => ({
  id: 'a1',
  title: 'Dom Casmurro',
  hint: 'Machado de Assis, 1899',
  focus: null,
  kind: 'book',
  depth: 'standard',
  status: 'completed',
  research: '# Dossiê\n\nCapitu, Bentinho e o ciúme. A crítica de Roberto Schwarz, *Ao vencedor as batatas*, 1977, é central.†',
  researchStatus: 'done',
  sources: [],
  synthesis: '## Síntese\n\nA dúvida é o método.',
  synthesisStatus: 'done',
  error: null,
  durationMs: 12_000,
  model: 'modelo-x',
  usage: null,
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:01.000Z',
  results: AGENT_KEYS.map((agentKey) => ({
    agentKey,
    status: 'done' as const,
    content,
    error: null,
    durationMs: 100,
  })),
  progress: 100,
  queuePosition: null,
  followUps: [],
  ...overrides,
});

/* ───────────────────────── contagem ───────────────────────── */

test('countWords ignora marcação, links e código', () => {
  assert.equal(countWords('uma duas três'), 3);
  assert.equal(countWords('## Título\n\n**forte** e *itálico*'), 4);
  assert.equal(countWords('[link](https://exemplo.com) e mais'), 3);
  assert.equal(countWords('```\nconst x = 1;\n```'), 0);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('— —'), 0);
});

test('hasLimitsSection aceita níveis diferentes e exige o título', () => {
  assert.equal(hasLimitsSection('### Limites e verificações\n- ok'), true);
  assert.equal(hasLimitsSection('## Limites e verificações\n- ok'), true);
  assert.equal(hasLimitsSection('### Limites\n- ok'), false);
  assert.equal(hasLimitsSection('texto com "Limites e verificações" no meio'), false);
});

test('countDaggers e countHeadings contam o que prometem', () => {
  assert.equal(countDaggers('fato† e outro† sem marca'), 2);
  assert.equal(countHeadings('### Um\n\ntexto\n\n### Dois\n'), 2);
});

test('checkSection aponta curta, longa, sem limites e sem †', () => {
  const curta = checkSection('thematic', '### Análise\n\nCurto demais.', 'standard');
  assert.equal(curta.withinRange, false);
  assert.ok(curta.issues.some((i) => i.includes('curta')));
  assert.ok(curta.issues.some((i) => i.includes('Limites')));

  const boa = `### Tese\n\n${'palavra '.repeat(700)}\n\n### Limites e verificações\n\n- confiança média†`;
  const ok = checkSection('thematic', boa, 'standard');
  assert.equal(ok.withinRange, true);
  assert.equal(ok.hasLimits, true);
  assert.ok(ok.daggers >= 1);
  assert.deepEqual(ok.issues, []);
});

/* ───────────────────────── referências ───────────────────────── */

test('parseReferences entende os dois formatos pedidos pelos prompts', () => {
  const text = `
    Como argumenta Roberto Schwarz, *Ao vencedor as batatas*, 1977, o romance é social.
    Bakhtin (1981) pensa o cronotopo. Gérard Genette, *Discurso da narrativa*, 1972, trata da voz.
    Em 1899 a obra foi publicada.
  `;
  const refs = parseReferences(text);
  const authors = refs.map((r) => r.author);

  assert.ok(authors.includes('Roberto Schwarz'));
  assert.ok(authors.includes('Bakhtin'));
  assert.ok(authors.some((a) => a.includes('Genette')));
  assert.ok(!refs.some((r) => r.author.includes('1899')), 'ano solto não é referência');

  const schwarz = refs.find((r) => r.author === 'Roberto Schwarz')!;
  assert.equal(schwarz.title, 'Ao vencedor as batatas');
  assert.equal(schwarz.year, 1977);
  assert.equal(schwarz.format, 'autor-obra-ano');

  const bakhtin = refs.find((r) => r.author === 'Bakhtin')!;
  assert.equal(bakhtin.title, null);
  assert.equal(bakhtin.format, 'autor-ano');
});

test('parseReferences não repete a mesma referência', () => {
  const text = 'Roberto Schwarz, *Ao vencedor as batatas*, 1977. E outra vez: Roberto Schwarz, *Ao vencedor as batatas*, 1977.';
  const refs = parseReferences(text);
  assert.equal(refs.length, 1);
});

const fakeFetch = (handler: (url: string) => unknown, status = 200): JsonFetcher => async (url) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => handler(url),
});

test('referência confirmada quando a base devolve o ano', async () => {
  const fetcher = fakeFetch(() => ({ docs: [{ title: 'Ao vencedor as batatas', first_publish_year: 1977 }] }));
  const [result] = await verifyReferences(parseReferences('Roberto Schwarz, *Ao vencedor as batatas*, 1977'), fetcher);
  assert.equal(result.verdict, 'confirmada');
  assert.match(result.evidence, /Open Library/);
});

test('ano diferente vira duvidosa, não confirmada', async () => {
  const fetcher = fakeFetch(() => ({ docs: [{ title: 'Ao vencedor as batatas', first_publish_year: 2001 }] }));
  const [result] = await verifyReferences(parseReferences('Roberto Schwarz, *Ao vencedor as batatas*, 1977'), fetcher);
  assert.equal(result.verdict, 'duvidosa');
});

test('base fora do ar vira não verificada — nunca confirmada', async () => {
  const fetcher: JsonFetcher = async () => {
    throw new Error('rede indisponível');
  };
  const [result] = await verifyReferences(parseReferences('Bakhtin (1981)'), fetcher);
  assert.equal(result.verdict, 'nao_verificada');
  assert.match(result.evidence, /rede indisponível/);
});

test('Crossref entra quando a Open Library não acha', async () => {
  const fetcher = fakeFetch((url) =>
    url.includes('openlibrary')
      ? { docs: [] }
      : { message: { items: [{ title: ['Ao vencedor as batatas'], issued: { 'date-parts': [[1977]] } }] } }
  );
  const [result] = await verifyReferences(parseReferences('Roberto Schwarz, *Ao vencedor as batatas*, 1977'), fetcher);
  assert.equal(result.verdict, 'confirmada');
  assert.match(result.evidence, /Crossref/);
});

test('verifyReferences respeita o teto de consultas', async () => {
  let calls = 0;
  const fetcher: JsonFetcher = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ docs: [] }) };
  };
  const refs = Array.from({ length: 30 }, (_, i) => ({
    raw: `Autor ${i} (${2000 + i})`,
    author: `Autor ${i}`,
    title: null,
    year: 2000 + i,
    format: 'autor-ano' as const,
  }));
  const results = await verifyReferences(refs, fetcher, 4);
  assert.equal(results.length, 4);
  assert.equal(calls, 8, 'quatro referências × duas bases');
});

/* ───────────────────────── conjunto e relatório ───────────────────────── */

test('o conjunto cobre cinco obras e cinco meios, sem repetir id', () => {
  assert.equal(GOLDEN_WORKS.length, 5);
  assert.equal(new Set(GOLDEN_WORKS.map((w) => w.id)).size, 5);
  assert.deepEqual(
    [...new Set(GOLDEN_WORKS.map((w) => w.kind))].sort(),
    ['book', 'book', 'film', 'game', 'series'].filter((v, i, a) => a.indexOf(v) === i).sort()
  );
  assert.ok(GOLDEN_WORKS.some((w) => w.id === 'dom-casmurro'), 'precisa da obra brasileira canônica');
  for (const work of GOLDEN_WORKS) {
    assert.ok(work.why.length > 20, `${work.id} precisa justificar a presença`);
    assert.ok(work.hint.length > 0);
  }
});

test('evaluateAnalysis resume forma e coleta referências do relatório inteiro', () => {
  const content = `### Tese\n\n${'palavra '.repeat(700)}\n\n### Limites e verificações\n\n- confiança média†\n- checar a data†`;
  const evaluation = evaluateAnalysis(GOLDEN_WORKS[0], dto(content));

  assert.equal(evaluation.totals.lenses, AGENT_KEYS.length);
  assert.equal(evaluation.totals.withLimits, AGENT_KEYS.length);
  assert.ok(evaluation.totals.daggers > 0);
  assert.ok(evaluation.references.some((r) => r.author === 'Roberto Schwarz'), 'a referência do dossiê entra');
  assert.equal(evaluation.status, 'completed');
});

test('evaluateAnalysis rebaixa a nota quando falta dossiê ou síntese', () => {
  const content = '### Tese\n\ncurto\n\n### Limites e verificações\n- x';
  const evaluation = evaluateAnalysis(GOLDEN_WORKS[0], dto(content, { research: null, synthesis: null }));
  assert.ok(evaluation.issues.includes('sem dossiê de pesquisa'));
  assert.ok(evaluation.issues.includes('sem síntese do curador'));
});

test('o relatório tem tabela, situação das referências e a ressalva do que "confirmada" significa', () => {
  const evaluation = evaluateAnalysis(GOLDEN_WORKS[0], dto('### Tese\n\ncurto'));
  const verified = new Map([
    [
      GOLDEN_WORKS[0].id,
      [
        {
          raw: 'Roberto Schwarz, *Ao vencedor as batatas*, 1977',
          author: 'Roberto Schwarz',
          title: 'Ao vencedor as batatas',
          year: 1977,
          format: 'autor-obra-ano' as const,
          verdict: 'duvidosa' as const,
          evidence: 'Open Library: 0 resultado(s), ano não confere',
        },
      ],
    ],
  ]);

  const report = renderEvalReport([evaluation], verified, { model: 'modelo-x', date: '02/11/2026' });
  assert.match(report, /# Avaliação do ANIMA/);
  assert.match(report, /\| Obra \| Lentes \|/);
  assert.match(report, /Dom Casmurro/);
  assert.match(report, /duvidosa/);
  assert.match(report, /não valida o que o texto afirma|Não significa que a citação diz/);
  assert.match(report, /modelo-x/);
});

test('relatório offline declara que as referências não foram conferidas', () => {
  const evaluation = evaluateAnalysis(GOLDEN_WORKS[0], dto('### Tese\n\ncurto'));
  const report = renderEvalReport([evaluation], new Map(), { model: 'm', date: 'hoje', offline: true });
  assert.match(report, /não\*\* conferidas|não conferidas/i);
});
