// ANIMA — o site publicado no GitHub Pages é gerado a partir do código; estes testes garantem que
// ele continua verdadeiro: todas as lentes presentes, nenhum link que quebre em /anima/ e nenhuma
// promessa de que a página executa o aplicativo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderSite } from '../scripts/build-site';
import { AGENTS } from '../src/lib/anima/agent-meta';
import { DEPTHS } from '../src/lib/anima/types';

const html = renderSite();

test('todas as oito lentes aparecem, com nome e papel', () => {
  assert.equal(AGENTS.length, 8);
  for (const agent of AGENTS) {
    assert.ok(html.includes(agent.name), `falta ${agent.name}`);
    assert.ok(html.includes(agent.role), `falta o papel de ${agent.name}`);
    assert.ok(html.includes(agent.tagline.slice(0, 40)), `falta a descrição de ${agent.name}`);
  }
});

test('a tabela de profundidade tem uma linha por nível', () => {
  const rows = [...html.matchAll(/<tr>\s*<th scope="row">/g)];
  assert.equal(rows.length, DEPTHS.length);
  assert.ok(html.includes('Panorama') && html.includes('Exaustiva'));
});

test('nenhum link absoluto: o site precisa funcionar em /anima/', () => {
  const absolute = [...html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(absolute, [], `caminhos absolutos quebrariam no subdiretório: ${absolute.join(', ')}`);
  assert.ok(html.includes('href="estilo.css"'), 'o CSS é referenciado por caminho relativo');
  assert.ok(html.includes('src="logo.svg"'));
});

test('todo item de navegação aponta para uma seção existente', () => {
  const nav = [...html.matchAll(/<nav[\s\S]*?<\/nav>/g)][0][0];
  const targets = [...nav.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 5, 'a navegação precisa cobrir as seções principais');
  for (const id of targets) {
    assert.match(html, new RegExp(`id="${id}"`), `a âncora #${id} não existe no documento`);
  }
});

test('diz com todas as letras que a página não executa o aplicativo', () => {
  assert.match(html, /Esta página é a apresentação, não o aplicativo/);
  assert.match(html, /GitHub Pages serve arquivos estáticos/);
  assert.ok(html.includes('docs/PUBLICAR.md'), 'aponta para o caminho de publicar o app de verdade');
});

test('a página cobre método, fontes e limites (não é só um cartão de visitas)', () => {
  for (const section of ['Como funciona', 'Fontes', 'Limites e ética', 'Rodar o app']) {
    assert.ok(html.includes(section), `falta a seção ${section}`);
  }
  // As fontes abertas citadas precisam ser as mesmas do código.
  assert.ok(html.includes('Wikipédia') && html.includes('Open Library') && html.includes('OpenAlex'));
});

test('acessibilidade básica do documento', () => {
  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /<meta name="viewport"/);
  assert.ok((html.match(/<h1[\s>]/g) ?? []).length === 1, 'exatamente um h1');
  assert.ok(html.includes('<main id="conteudo">'));
  assert.match(html, /<a class="skip" href="#conteudo">/);
  // O botão de tema tem rótulo acessível.
  assert.match(html, /id="tema"[^>]*aria-label="Alternar tema claro e escuro"/);
});
