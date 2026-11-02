// ANIMA — testes da avaliação de qualidade (Fase 2).
//
// O que estes testes protegem: as checagens precisam medir o que dizem medir, e a verificação de
// referências precisa ser honesta — sem transformar "não achei" ou "sem rede" em "confirmada".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GOLDEN_WORKS,
  checkCoverage,
  checkSection,
  countDaggers,
  countWords,
  evaluateWork,
  extractReferences,
  hasLimitsSection,
  renderEvalReport,
  verifyReference,
  verifyReferences,
} from '../src/lib/anima/eval';
import { AGENT_KEYS, type AnalysisDTO } from '../src/lib/anima/types';

const section = (extra = '') => `### Leituras possíveis

O romance organiza a suspeita como forma${extra} [F1]. A leitura de Roberto Schwarz, *Ao vencedor as batatas*, 1977, ancora o debate†.

### Limites e verificações

- Confiança: média, porque o dossiê cobre a fortuna crítica principal.
- A data de publicação da primeira edição merece checagem†.
- A lente de recepção não foi explorada.`;

/* ───────────────────────── contagem e forma ───────────────────────── */

test('countWords ignora marcação, links e blocos de código', () => {
  assert.equal(countWords('uma duas três'), 3);
  assert.equal(countWords('## título\n\n**negrito** e *itálico*'), 4);
  assert.equal(countWords('[texto do link](https://exemplo.com)'), 3);
  assert.equal(countWords('```\ncode here\n```\nfora'), 1);
  assert.equal(countWords(''), 0);
});

test('hasLimitsSection aceita níveis e recusa a ausência', () => {
  assert.equal(hasLimitsSection('### Limites e verificações\n- a'), true);
  assert.equal(hasLimitsSection('texto\n\n## Limites e Verificações\n- a'), true);
  assert.equal(hasLimitsSection('### Conclusão\nnada'), false);
  assert.equal(hasLimitsSection('Limites e verificações sem heading'), false);
});

test('countDaggers conta o marcador de conhecimento prévio', () => {
  assert.equal(countDaggers('fato† e outro†'), 2);
  assert.equal(countDaggers('sem marcador'), 0);
});

test('checkSection mede a faixa de palavras da profundidade pedida', () => {
  const brief = checkSection('thematic', section(), 'brief');
  // O texto de exemplo é curto para "Panorama" (350–500) — o teste registra isso, não esconde.
  assert.equal(brief.expected.min, 350);
  assert.equal(brief.withinRange, false);
  assert.ok(brief.issues.some((i) => i.startsWith('curta:')));
  assert.equal(brief.hasLimitsSection, true);
  assert.ok(brief.daggerCount >= 2);

  // Um texto dentro da faixa passa.
  const long = `### Análise\n\n${'palavra '.repeat(420)}\n\n### Limites e verificações\n- ok`;
  const inRange = checkSection('thematic', long, 'brief');
  assert.equal(inRange.withinRange, true);
  assert.deepEqual(inRange.issues, []);
});

test('checkSection não aceita texto muito acima do teto (prolixidão também é defeito)', () => {
  const long = `### Análise\n\n${'palavra '.repeat(900)}\n\n### Limites e verificações\n- ok`;
  const check = checkSection('thematic', long, 'brief'); // teto 500 + 25% = 625
  assert.equal(check.withinRange, false);
  assert.ok(check.issues.some((i) => i.startsWith('longa:')));
});

test('checkSection sinaliza ausência da seção de limites', () => {
  const check = checkSection('thematic', `### Análise\n\n${'palavra '.repeat(400)}`, 'brief');
  assert.equal(check.hasLimitsSection, false);
  assert.ok(check.issues.includes('sem a seção "Limites e verificações"'));
});

/* ───────────────────────── obras de referência ───────────────────────── */

test('o conjunto cobre os cinco meios pedidos, sem repetição', () => {
  assert.equal(GOLDEN_WORKS.length, 5);
  const kinds = GOLDEN_WORKS.map((w) => w.kind).sort();
  assert.deepEqual(kinds, ['book', 'book', 'film', 'game', 'series']);
  assert.equal(new Set(GOLDEN_WORKS.map((w) => w.id)).size, 5);
  assert.ok(GOLDEN_WORKS.some((w) => w.id === 'dom-casmurro'), 'precisa de um livro brasileiro');
  for (const work of GOLDEN_WORKS) {
    assert.ok(work.why.length > 20, `${work.id} precisa justificar a presença no conjunto`);
    assert.ok(work.expectedTerms.length > 0);
  }
});

/* ───────────────────────── referências ───────────────────────── */

test('extrai referências no formato que o prompt pede', () => {
  const text = `
    Como argumenta Roberto Schwarz, *Ao vencedor as batatas*, 1977, a forma do romance é social.
    Também Bakhtin (1981) pensa o cronotopo, e Genette, *Discurso da narrativa*, 1972, a voz.
    Nada aqui: 1899 sozinho.
  `;
  const refs = extractReferences(text);
  const authors = refs.map((r) => r.author);

  assert.ok(authors.some((a) => a.includes('Schwarz')), 'deve pegar "Autor, *Obra*, ano"');
  assert.ok(authors.some((a) => a.includes('Bakhtin')), 'deve pegar "Autor (ano)"');
  assert.ok(authors.some((a) => a.includes('Genette')), 'deve pegar um nome seguido de vírgula e obra');

  const schwarz = refs.find((r) => r.author.includes('Schwarz'))!;
  assert.equal(schwarz.year, 1977);
  assert.equal(schwarz.title, 'Ao vencedor as batatas');
});

test('não duplica a mesma referência escrita duas vezes', () => {
  const text = 'Roberto Schwarz, *Ao vencedor as batatas*, 1977. Depois, Schwarz, *Ao vencedor as batatas*, 1977.';
  const refs = extractReferences(text).filter((r) => r.title === 'Ao vencedor as batatas');
  assert.equal(refs.length, 1);
});

test('referência confirmada quando Open Library traz título e ano compatíveis', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ docs: [{ title: 'Ao vencedor as batatas', first_publish_year: 1977, author_name: ['Roberto Schwarz'] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  const result = await verifyReference({ author: 'Roberto Schwarz', title: 'Ao vencedor as batatas', year: 1977, raw: 'x' }, fakeFetch);
  assert.equal(result.status, 'confirmada');
  assert.match(result.evidence, /Open Library/);
});

test('ano incompatível vira "duvidosa", não "confirmada"', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ docs: [{ title: 'Ao vencedor as batatas', first_publish_year: 1990, author_name: ['Roberto Schwarz'] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  const result = await verifyReference({ author: 'Roberto Schwarz', title: 'Ao vencedor as batatas', year: 1977, raw: 'x' }, fakeFetch);
  assert.equal(result.status, 'duvidosa');
});

test('título diferente não confirma uma referência inventada', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ docs: [{ title: 'Outro livro completamente diferente', first_publish_year: 1977, author_name: ['Roberto Schwarz'] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

  const result = await verifyReference(
    { author: 'Roberto Schwarz', title: 'A obra que não existe', year: 1977, raw: 'x' },
    fakeFetch
  );
  assert.equal(result.status, 'duvidosa');
});

test('mesmo título e ano, mas outro autor: duvidosa', async () => {
  // O falso positivo clássico: a base devolve um registro do ano certo por outra pessoa.
  const fakeFetch = (async () =>
    new Response(
      JSON.stringify({ docs: [{ title: 'Ao vencedor as batatas', first_publish_year: 1977, author_name: ['João Silva'] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as unknown as typeof fetch;

  const result = await verifyReference({ author: 'Roberto Schwarz', title: 'Ao vencedor as batatas', year: 1977, raw: 'x' }, fakeFetch);
  assert.equal(result.status, 'duvidosa');
});

test('referência sem título ("Autor (ano)") exige autor compatível', async () => {
  const otherAuthor = (async () =>
    new Response(JSON.stringify({ docs: [{ title: 'Outro artigo', first_publish_year: 1981, author_name: ['Um Outro'] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  assert.equal(
    (await verifyReference({ author: 'Bakhtin', title: null, year: 1981, raw: 'x' }, otherAuthor)).status,
    'duvidosa'
  );

  const sameAuthor = (async () =>
    new Response(JSON.stringify({ docs: [{ title: 'The Dialogic Imagination', first_publish_year: 1981, author_name: ['M. M. Bakhtin'] }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  assert.equal(
    (await verifyReference({ author: 'Bakhtin', title: null, year: 1981, raw: 'x' }, sameAuthor)).status,
    'confirmada'
  );
});

test('sem rede, o status é "nao_verificada" — nunca "confirmada" por omissão', async () => {
  const failingFetch = (async () => {
    throw new Error('rede indisponível');
  }) as unknown as typeof fetch;

  const result = await verifyReference({ author: 'Genette', title: 'Discurso da narrativa', year: 1972, raw: 'x' }, failingFetch);
  assert.equal(result.status, 'nao_verificada');
  assert.match(result.evidence, /inacess/i);
});

test('resposta HTTP de erro também conta como não verificada', async () => {
  const failingFetch = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
  const result = await verifyReference({ author: 'X', title: null, year: 2000, raw: 'x' }, failingFetch);
  assert.equal(result.status, 'nao_verificada');
});

test('verifyReferences lida com um texto sem referências', async () => {
  const refs = await verifyReferences('Texto sem nenhuma citação formal.', (async () => new Response('')) as unknown as typeof fetch);
  assert.deepEqual(refs, []);
});

/* ───────────────────────── avaliação completa ───────────────────────── */

function dtoWith(content: string): AnalysisDTO {
  return {
    id: 'x',
    title: 'Dom Casmurro',
    hint: null,
    focus: null,
    kind: 'book',
    depth: 'brief',
    status: 'completed',
    research: '# Dossiê\n\nCapitu e Bento.',
    researchStatus: 'done',
    sources: [],
    synthesis: '## Síntese\n\nConvergências.',
    synthesisStatus: 'done',
    error: null,
    durationMs: 1000,
    model: 'mock',
    usage: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: AGENT_KEYS.map((key) => ({
      agentKey: key,
      status: 'done' as const,
      content,
      error: null,
      durationMs: 10,
    })),
    progress: 100,
    queuePosition: null,
  };
}

test('evaluateWork resume forma, cobertura e referências', () => {
  const work = GOLDEN_WORKS.find((w) => w.id === 'dom-casmurro')!;
  const evaluation = evaluateWork(work, dtoWith(section()));

  assert.equal(evaluation.sections.length, AGENT_KEYS.length);
  assert.equal(evaluation.score.withLimits, AGENT_KEYS.length);
  assert.ok(evaluation.score.daggers > 0);
  assert.ok(!evaluation.coverage.some((c) => c.includes('Capitu')), 'Capitu aparece no dossiê');
  assert.ok(!evaluation.coverage.some((c) => c.includes('Bento')), 'Bento aparece no dossiê');
  assert.ok(evaluation.references.length >= 1, 'a seção de exemplo tem uma referência');
  assert.equal(evaluation.score.refsUnverified, evaluation.references.length, 'sem rede, tudo fica não verificado');
});

test('evaluateWork aponta termos ausentes (cobertura fraca)', () => {
  const work = GOLDEN_WORKS.find((w) => w.id === 'dom-casmurro')!;
  const evaluation = evaluateWork(work, { ...dtoWith(section()), research: 'Nada relevante.' });
  assert.ok(evaluation.coverage.some((c) => c.includes('Capitu')));
});

test('o relatório markdown traz resumo, tabela de referências e a data', () => {
  const work = GOLDEN_WORKS[0];
  const md = renderEvalReport([evaluateWork(work, dtoWith(section()))], { model: 'modelo-x', date: '02/11/2026' });

  assert.match(md, /# Avaliação ANIMA/);
  assert.match(md, /\| Obra \| Situação \|/);
  assert.match(md, /Dom Casmurro/);
  assert.match(md, /02\/11\/2026/);
  assert.match(md, /modelo-x/);
  assert.match(md, /\| Referência \| Situação \| Evidência \|/);
});

test('checkCoverage é insensível a caixa', () => {
  const work = { ...GOLDEN_WORKS[0], expectedTerms: ['CAPITU'] };
  assert.deepEqual(checkCoverage(dtoWith('capitu aparece aqui'), work), []);
});
