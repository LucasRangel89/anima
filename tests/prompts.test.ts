import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPTH_CONFIG,
  buildResearcherUserMessage,
  buildSpecialistUserMessage,
  buildSynthesisUserMessage,
  getSpecialistPrompt,
  getSynthesisPrompt,
} from '../src/lib/anima/prompts';
import { AGENT_KEYS, DEPTHS, DEPTH_LABELS } from '../src/lib/anima/types';
import { AGENTS } from '../src/lib/anima/agent-meta';

test('todo especialista tem prompt completo, com formato e segurança', () => {
  for (const key of AGENT_KEYS) {
    const p = getSpecialistPrompt(key, { depth: 'standard', kind: 'book' });
    for (const section of ['# Papel', '# Escopo', '# Repertório teórico', '# Roteiro de análise', '# Armadilhas', '# Rigor intelectual', '# Formato de saída', '# Segurança']) {
      assert.ok(p.includes(section), `${key} sem seção ${section}`);
    }
    assert.ok(p.includes('Limites e verificações'), `${key} sem seção final obrigatória`);
    assert.ok(p.length > 3500, `${key} com prompt curto demais (${p.length})`);
  }
});

test('a profundidade altera a faixa de palavras e a calibragem', () => {
  for (const depth of DEPTHS) {
    const p = getSpecialistPrompt('thematic', { depth, kind: 'film' });
    assert.ok(p.includes(`${DEPTH_CONFIG[depth].minWords} e ${DEPTH_CONFIG[depth].maxWords}`), depth);
    assert.ok(p.includes(DEPTH_CONFIG[depth].calibration), `${depth} sem calibragem`);
  }
  const order = DEPTHS.map((d) => DEPTH_CONFIG[d].maxTokens);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'profundidades devem crescer em tokens');
  // a faixa anunciada na UI precisa ser a mesma do prompt
  for (const depth of DEPTHS) {
    assert.deepEqual(DEPTH_LABELS[depth].words, [DEPTH_CONFIG[depth].minWords, DEPTH_CONFIG[depth].maxWords]);
  }
});

test('o recorte do usuário entra nas mensagens de pesquisa, análise e síntese', () => {
  const focus = 'temporada 4';
  for (const msg of [
    buildResearcherUserMessage('Breaking Bad', null, 'series', '<fonte/>', focus),
    buildSpecialistUserMessage('Breaking Bad', null, 'series', 'dossiê', focus),
    buildSynthesisUserMessage('Breaking Bad', null, 'series', 'dossiê', [], [], focus),
  ]) {
    assert.ok(msg.includes(`Recorte pedido pelo usuário: ${focus}`), msg.slice(0, 80));
  }
  // sem recorte, nada é inventado
  assert.equal(buildSpecialistUserMessage('X', null, 'book', 'd').includes('Recorte'), false);
});

test('o meio da obra adapta o prompt', () => {
  assert.ok(getSpecialistPrompt('stylistic', { depth: 'standard', kind: 'film' }).includes('audiovisual'));
  assert.ok(getSpecialistPrompt('stylistic', { depth: 'standard', kind: 'game' }).includes('ludonarrativa'));
});

test('metadados dos agentes cobrem todas as chaves, sem duplicatas', () => {
  assert.deepEqual(AGENTS.map((a) => a.key), [...AGENT_KEYS]);
  for (const a of AGENTS) assert.ok(a.frameworks.length >= 4, `${a.key} com poucos referenciais`);
});

test('a síntese lista as seis seções', () => {
  const p = getSynthesisPrompt('standard', 'auto');
  for (const s of ['Tese de leitura', 'Convergências', 'Tensões e divergências', 'Controle de consistência', 'Para ir além']) {
    assert.ok(p.includes(s), s);
  }
});
