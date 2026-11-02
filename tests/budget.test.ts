// ANIMA — orçamento de contexto: estimativa, condensação determinística e divisão justa.
//
// A garantia que estes testes protegem: nenhum prompt enviado ao modelo deve ultrapassar o contexto
// configurado, e toda redução precisa ser registrada e determinística (mesma entrada → mesmo texto).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONTEXT_TOKENS,
  MIN_CONTEXT_TOKENS,
  condense,
  contextLimit,
  describeShrink,
  emptyUsage,
  estimateTokens,
  fitTogether,
  recordCall,
  shrink,
} from '../src/lib/anima/budget';

const dossier = [
  '# Dossiê — Dom Casmurro',
  '',
  '## Ficha da obra',
  '- **Autor:** Machado de Assis',
  '- **Ano:** 1899',
  '- **Editora:** Livraria Garnier',
  '',
  '## Sinopse',
  'Bento Santiago narra em primeira pessoa a história do seu casamento com Capitu. A suspeita de traição estrutura todo o relato, que é apresentado como uma "obra da verdade". O narrador se defende de uma acusação que ninguém fez.',
  '',
  '## Estado da crítica',
  'A fortuna crítica se divide entre a condenação de Capitu e a suspeita do narrador. Roberto Schwarz lê o romance como forma social; Helen Caldwell propõe o "Capitu de Machado".',
  '',
  '## Lacunas',
  'Não há dados sobre a recepção imediata na imprensa da época.',
].join('\n');

const env = (extra: Record<string, string> = {}) => extra as unknown as NodeJS.ProcessEnv;

test('a estimativa de tokens é conservadora (nunca subestima o texto)', () => {
  const text = 'a'.repeat(3_000);
  // 1 token a cada 3 caracteres é o pior caso razoável do português; 1000 tokens para 3000 chars.
  assert.equal(estimateTokens(text), 1_000 + 8);
  assert.ok(estimateTokens(text) >= text.length / 4);
  assert.equal(estimateTokens(''), 0);
  // Texto real: entre 3 e 4 caracteres por token na prática, então a estimativa fica acima do real.
  const real = estimateTokens(dossier);
  assert.ok(real > 0 && real < dossier.length);
});

test('contextLimit respeita LLM_CONTEXT_TOKENS, ignora lixo e cai no padrão conservador', () => {
  assert.equal(contextLimit(env({ LLM_CONTEXT_TOKENS: '16000' })), 16_000);
  assert.equal(contextLimit(env({})), DEFAULT_CONTEXT_TOKENS);
  assert.equal(contextLimit(env({ LLM_CONTEXT_TOKENS: 'abc' })), DEFAULT_CONTEXT_TOKENS);
  assert.equal(contextLimit(env({ LLM_CONTEXT_TOKENS: '10' })), DEFAULT_CONTEXT_TOKENS, 'valor absurdo é ignorado');
  assert.equal(contextLimit(env({ LLM_CONTEXT_TOKENS: '0' })), DEFAULT_CONTEXT_TOKENS);
  assert.ok(MIN_CONTEXT_TOKENS <= DEFAULT_CONTEXT_TOKENS);
  assert.equal(contextLimit(env({ LLM_CONTEXT_TOKENS: String(MIN_CONTEXT_TOKENS) })), MIN_CONTEXT_TOKENS);
});

test('texto que cabe passa intacto e sem aviso', () => {
  const result = shrink(dossier, 4_000);
  assert.equal(result.text, dossier);
  assert.equal(result.method, 'nenhum');
  assert.equal(result.before, result.after);
  assert.equal(describeShrink('Dossiê', result), null);
});

test('texto grande é condensado preservando títulos, listas e a primeira frase', () => {
  const huge = `${dossier}\n\n${'Parágrafo longo com detalhes secundários que podem ser dispensados. '.repeat(400)}`;
  const result = shrink(huge, 2_000);

  assert.notEqual(result.method, 'nenhum');
  assert.ok(result.after <= 2_000, `resultado deveria caber no limite: ${result.after}`);
  assert.ok(result.after < result.before);

  // A espinha factual sobrevive.
  assert.match(result.text, /Dom Casmurro/);
  assert.match(result.text, /Machado de Assis/);
  assert.match(result.text, /1899/);
  assert.match(result.text, /Estado da crítica|fortuna crítica/);
  assert.match(result.text, /Lacunas/);
});

test('parágrafo gigante é condensado, não cortado (preserva o começo do argumento)', () => {
  const huge = `CABEÇALHO ÚNICO\n\n${'x'.repeat(50_000)}\n\nRODAPÉ ÚNICO`;
  const result = shrink(huge, 500);

  assert.equal(result.method, 'condensado');
  assert.ok(result.after <= 500);
  assert.match(result.text, /CABEÇALHO ÚNICO/);
  assert.match(result.text, /RODAPÉ ÚNICO/);
});

test('quando nem condensado cabe, o corte é explícito e preserva o fim do texto', () => {
  // Títulos e listas passam inteiros pela condensação: só um texto assim ainda estoura depois dela.
  const huge = `CABEÇALHO ÚNICO\n\n${Array.from({ length: 300 }, (_, i) => `## Seção ${i} ${'palavra '.repeat(12)}`).join('\n')}\n\nRODAPÉ ÚNICO`;
  const result = shrink(huge, 500);

  assert.equal(result.method, 'cortado');
  assert.ok(result.after <= 500, `cortado deveria caber: ${result.after}`);
  assert.match(result.text, /trecho omitido por limite de contexto/);
  assert.match(result.text, /CABEÇALHO ÚNICO/);
  assert.match(result.text, /RODAPÉ ÚNICO/, 'o fim guarda as lacunas e os limites');
});

test('a redução é determinística: mesma entrada, mesmo resultado', () => {
  const huge = dossier.repeat(30);
  const first = shrink(huge, 1_200);
  const second = shrink(huge, 1_200);
  assert.equal(first.text, second.text);
  assert.equal(first.method, second.method);
});

test('condense não inventa conteúdo: todo trecho existe no original', () => {
  const condensed = condense(dossier);
  for (const line of condensed.split('\n').filter((l) => l.trim() && !l.startsWith('#'))) {
    assert.ok(dossier.includes(line.trim()), `linha inexistente no original: ${line.slice(0, 60)}`);
  }
  assert.ok(condensed.length <= dossier.length);
});

test('fitTogether divide o orçamento entre dossiê e análises', () => {
  const parts = [
    { key: 'dossie', text: dossier },
    ...['structural', 'narratology', 'characters', 'thematic', 'stylistic', 'psychological', 'cultural', 'critical'].map(
      (key) => ({ key, text: `### Análise ${key}\n\n${'argumento '.repeat(1_500)}` })
    ),
  ];

  const fitted = fitTogether(parts, 6_000);
  assert.equal(fitted.ok, false);

  const total = fitted.parts.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  assert.ok(total <= 6_000 + fitted.parts.length * 10, `total ${total} deveria caber em 6000`);

  // Nenhuma lente desaparece por completo: o modelo precisa saber que ela existe.
  for (const part of fitted.parts) {
    assert.ok(part.text.length > 0, `${part.key} ficou vazio`);
  }
});

test('fitTogether não mexe em nada quando tudo cabe', () => {
  const parts = [
    { key: 'a', text: 'curto' },
    { key: 'b', text: 'também curto' },
  ];
  const fitted = fitTogether(parts, 10_000);
  assert.equal(fitted.ok, true);
  assert.deepEqual(
    fitted.parts.map((p) => p.text),
    ['curto', 'também curto']
  );
});

test('recordCall acumula por etapa e marca estimativa', () => {
  const usage = emptyUsage(32_768);
  recordCall(usage, 'pesquisador', { prompt: 1000, completion: 500 });
  recordCall(usage, 'especialista:thematic', { prompt: 2000, completion: 800, estimated: true });
  recordCall(usage, 'especialista:thematic', { prompt: 100, completion: 50 });

  assert.equal(usage.calls, 3);
  assert.equal(usage.promptTokens, 3_100);
  assert.equal(usage.completionTokens, 1_350);
  assert.equal(usage.totalTokens, 4_450);
  assert.equal(usage.estimated, true);
  assert.equal(usage.byStage['especialista:thematic'].calls, 2);
  assert.equal(usage.byStage.pesquisador.promptTokens, 1_000);
  assert.equal(usage.contextLimit, 32_768);
});

test('describeShrink escreve o aviso em português com os dois lados da mudança', () => {
  const result = shrink(dossier.repeat(40), 900);
  const notice = describeShrink('Dossiê de fontes', result);
  assert.ok(notice);
  assert.match(notice, /Dossiê de fontes (condensado|cortado)/);
  assert.match(notice, /tokens/);
});
