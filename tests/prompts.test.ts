import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_CONFIG, getSpecialistPrompt, getSynthesisPrompt } from '../src/lib/anima/prompts';
import { AGENT_KEYS } from '../src/lib/anima/types';
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

test('a profundidade altera a faixa de palavras', () => {
  const std = getSpecialistPrompt('thematic', { depth: 'standard', kind: 'film' });
  const deep = getSpecialistPrompt('thematic', { depth: 'deep', kind: 'film' });
  assert.ok(std.includes(`${DEPTH_CONFIG.standard.minWords} e ${DEPTH_CONFIG.standard.maxWords}`));
  assert.ok(deep.includes(`${DEPTH_CONFIG.deep.minWords} e ${DEPTH_CONFIG.deep.maxWords}`));
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
