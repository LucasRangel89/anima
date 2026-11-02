// ANIMA — oficina (modo manual): prompts, colagem e conferência, sem rede e sem navegador.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AGENT_LABELS } from '../src/lib/anima/agent-labels';
import { AGENTS } from '../src/lib/anima/agent-meta';
import {
  assembleAnalysis,
  buildDossierPrompt,
  buildLensPrompts,
  buildOficinaSynthesisPrompt,
  buildPackPrompt,
  normalizeHeading,
  officeFileName,
  officeMarkdown,
  officeReport,
  officeVault,
  parseLensSections,
  type OficinaInput,
} from '../src/lib/anima/oficina';
import { renderMarkdown } from '../src/oficina/main';
import { renderOficinaPage } from '../scripts/build-site';
import { AGENT_KEYS } from '../src/lib/anima/types';

const input: OficinaInput = {
  title: 'Dom Casmurro',
  hint: 'Machado de Assis, 1899',
  focus: 'a dúvida sobre Capitu',
  kind: 'book',
  depth: 'brief',
};

const dossier = 'Dossiê: publicado em 1899; narrador em primeira pessoa e não confiável.';

function lensText(words = 430): string {
  return `### Tese\n\n${'Evidência textual e tese defensável sobre a obra. '.repeat(Math.ceil(words / 7))}\n\n### Limites e verificações\n\nO que não alcanço: a recepção estrangeira. †`;
}

/* ───────────────────────── Rótulos não podem divergir da interface ───────────────────────── */

test('os rótulos da oficina batem com os da interface', () => {
  assert.equal(AGENTS.length, AGENT_KEYS.length);
  for (const agent of AGENTS) {
    const label = AGENT_LABELS[agent.key];
    assert.equal(label.name, agent.name);
    assert.equal(label.short, agent.short);
    assert.equal(label.role, agent.role);
    assert.equal(label.tagline, agent.tagline);
    assert.deepEqual(label.questions, agent.questions);
  }
});

/* ───────────────────────── Prompts ───────────────────────── */

test('o prompt do dossiê usa o pesquisador do app e avisa que é modo manual', () => {
  const prompt = buildDossierPrompt(input);
  assert.ok(prompt.includes('Agente Pesquisador'));
  assert.ok(prompt.includes('Dom Casmurro'));
  assert.ok(prompt.includes('Machado de Assis'));
  assert.ok(prompt.includes('modo manual'));
  assert.ok(prompt.includes('a dúvida sobre Capitu'), 'o recorte entra no prompt');
});

test('cada lente recebe o dossiê inteiro e o seu próprio papel', () => {
  const prompts = buildLensPrompts(input, dossier);
  assert.equal(prompts.length, 8);
  for (const lens of prompts) {
    assert.equal(lens.key, lens.key.toLowerCase());
    assert.ok(lens.prompt.includes(dossier), `a lente ${lens.name} não recebeu o dossiê`);
    assert.ok(lens.prompt.includes(AGENT_LABELS[lens.key].name));
    assert.ok(lens.prompt.includes('Dom Casmurro'));
  }
  const keys = prompts.map((lens) => lens.key);
  assert.deepEqual(keys, [...AGENT_KEYS]);
});

test('o pacote único pede as oito seções, a faixa de palavras e os limites', () => {
  const prompt = buildPackPrompt(input, dossier);
  for (const key of AGENT_KEYS) assert.ok(prompt.includes(`## ${AGENT_LABELS[key].name}`));
  assert.ok(prompt.includes('350 a 500 palavras'), 'a faixa vem da profundidade escolhida');
  assert.ok(prompt.includes('Limites e verificações'));
  assert.ok(prompt.includes(dossier));
});

test('a síntese leva o que voltou e nomeia o que faltou', () => {
  const parts = {
    dossier,
    lenses: { structural: lensText(), thematic: lensText() },
    synthesis: '',
  };
  const prompt = buildOficinaSynthesisPrompt(input, parts);
  assert.ok(prompt.includes('Agente Cultural'), 'as lentes ausentes são nomeadas');
  assert.ok(prompt.includes('Evidência textual'));
  assert.ok(prompt.includes('Dom Casmurro'));
});

/* ───────────────────────── Leitura do que foi colado ───────────────────────── */

test('separa as oito seções pelos títulos, tolerando numeração e acento', () => {
  const text = [
    'Segue a análise.',
    `## 1. ${AGENT_LABELS.structural.name}`,
    'conteúdo estrutural',
    `### ${AGENT_LABELS.narratology.name.toUpperCase()}`,
    'conteúdo do discurso',
    '## Estilo',
    'conteúdo de estilo',
    '## agente critico',
    'conteúdo crítico',
    '## Lente desconhecida',
    'ruído',
  ].join('\n');

  const parsed = parseLensSections(text);
  assert.equal(parsed.structural, 'conteúdo estrutural');
  assert.equal(parsed.narratology, 'conteúdo do discurso');
  assert.equal(parsed.stylistic, 'conteúdo de estilo');
  assert.equal(parsed.critical, 'conteúdo crítico');
  assert.equal(Object.keys(parsed).length, 4);
});

test('resposta vazia ou sem títulos não inventa seção', () => {
  assert.deepEqual(parseLensSections(''), {});
  assert.deepEqual(parseLensSections('Texto corrido sem títulos.'), {});
});

test('normalizeHeading remove acento, caixa e pontuação', () => {
  assert.equal(normalizeHeading('Agente Crítico — O Teórico'), 'agente critico o teorico');
});

/* ───────────────────────── Montagem e conferência ───────────────────────── */

test('monta a análise com o que voltou e marca o resto como pulado', () => {
  const dto = assembleAnalysis(
    input,
    { dossier, lenses: { structural: lensText(), stylistic: lensText() }, synthesis: 'Síntese.' },
    { now: new Date('2026-11-02T12:00:00Z') }
  );

  assert.equal(dto.status, 'completed');
  assert.equal(dto.results.length, 8);
  assert.equal(dto.results.filter((r) => r.status === 'done').length, 2);
  assert.deepEqual(dto.results.filter((r) => r.status === 'skipped').map((r) => r.agentKey), [
    'narratology',
    'characters',
    'thematic',
    'psychological',
    'cultural',
    'critical',
  ]);
  assert.equal(dto.synthesis, 'Síntese.');
  assert.equal(dto.createdAt, '2026-11-02T12:00:00.000Z');
});

test('a conferência aponta o que ficou fraco sem bloquear', () => {
  const dto = assembleAnalysis(input, {
    dossier,
    lenses: {
      structural: lensText(),
      thematic: 'Curto demais.',
    },
    synthesis: '',
  });
  const report = officeReport(dto);

  assert.equal(report.checks.length, 2);
  assert.equal(report.missing.length, 6);
  assert.ok(report.warnings.some((w) => w.includes('6 lente(s) não voltaram')));
  assert.ok(report.warnings.some((w) => w.includes('fora da faixa')));
  assert.ok(report.warnings.some((w) => w.includes('sem a seção "Limites e verificações"')));
  assert.ok(report.warnings.some((w) => w.includes('síntese')));
});

test('sem dossiê, a conferência avisa que as lentes podem ter inventado contexto', () => {
  const dto = assembleAnalysis(input, { dossier: '', lenses: { structural: lensText() }, synthesis: '' });
  assert.equal(dto.researchStatus, 'skipped');
  assert.ok(officeReport(dto).warnings.some((w) => w.includes('dossiê')));
});

test('exporta markdown com todas as lentes e cofre do Obsidian com bytes de zip', () => {
  const dto = assembleAnalysis(input, {
    dossier,
    lenses: { structural: lensText(), critical: lensText() },
    synthesis: 'Síntese integrada.',
  });
  const md = officeMarkdown(dto);
  assert.ok(md.includes('# Relatório ANIMA — Dom Casmurro'));
  assert.ok(md.includes('Agente Estrutural'));
  assert.ok(md.includes('Agente Crítico'));

  const vault = officeVault(dto);
  assert.ok(vault.filename.endsWith('.zip'));
  assert.equal(String.fromCharCode(vault.bytes[0], vault.bytes[1]), 'PK');
});

test('o nome do arquivo é seguro para qualquer sistema', () => {
  assert.equal(officeFileName('Dom Casmurro'), 'dom-casmurro-oficina.md');
  assert.equal(officeFileName('  Cidade de Deus (2002)  '), 'cidade-de-deus-2002-oficina.md');
  assert.equal(officeFileName('***'), 'anima-oficina.md');
});

/* ───────────────────────── Página publicada ───────────────────────── */

test('a página da oficina tem os ganchos que o script procura e nenhum caminho absoluto', () => {
  const html = renderOficinaPage();
  for (const id of [
    'form-obra',
    'obra-titulo',
    'obra-tipo',
    'obra-profundidade',
    'passos',
    'corpo-dossie',
    'corpo-lentes',
    'corpo-sintese',
    'corpo-resultado',
    'lista-historico',
    'aviso',
  ]) {
    assert.ok(html.includes(`id="${id}"`), `falta o gancho #${id}`);
  }
  assert.ok(html.includes('src="oficina.js"'));
  assert.ok(html.includes('href="manifest.webmanifest"'));

  const absolute = [...html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(absolute, [], `caminhos absolutos quebrariam em /anima/: ${absolute.join(', ')}`);
});

/* ───────────────────────── Renderizador de markdown da oficina ───────────────────────── */

test('o renderizador cobre títulos, listas, negrito e escapa HTML', () => {
  const html = renderMarkdown(
    ['## Título', '', 'Parágrafo com **forte** e `código`.', '', '- um', '- dois', '', '> citação', '', '<script>x</script>'].join('\n')
  );
  assert.ok(html.includes('<h3>Título</h3>'));
  assert.ok(html.includes('<strong>forte</strong>'));
  assert.ok(html.includes('<code>código</code>'));
  assert.ok(html.includes('<li>um</li>'));
  assert.ok(html.includes('<blockquote>citação</blockquote>'));
  assert.ok(html.includes('&lt;script&gt;'), 'HTML colado não deve executar');
});
