// ANIMA — e2e da oficina estática (modo manual), sem servidor de aplicação.
//
// O que se prova aqui: a página gerada para o GitHub Pages abre, monta os prompts, aceita texto colado,
// separa as oito seções, confere a forma, exporta e guarda o histórico no navegador.

import { test, expect } from '@playwright/test';

import { AGENT_LABELS } from '../../src/lib/anima/agent-labels';

test.use({ baseURL: 'http://127.0.0.1:3210' });

const LENSES = Object.values(AGENT_LABELS).map((label) => label.name);

function lensSection(name: string): string {
  const body = 'A obra sustenta esta leitura com evidência textual e uma tese defensável. '.repeat(38);
  return `## ${name}\n\n### Tese\n\n${body}\n\n### Limites e verificações\n\nO que esta lente não alcança: a recepção fora do Brasil. †`;
}

const PACK = LENSES.map(lensSection).join('\n\n');
const DOSSIER = 'Dossiê de teste: publicação, contexto e recepção documentados. (conhecimento do modelo)';
const SYNTHESIS =
  '## Leitura integrada\n\nAs oito lentes convergem para uma tese comum sobre forma e contexto.\n\n' +
  '## Tensões\n\nA lente psicológica e a cultural divergem sobre a origem do conflito.\n\n' +
  '## O que falta\n\nFalta a recepção crítica estrangeira.';

async function montarPrompts(page: import('@playwright/test').Page, modo: 'single' | 'perLens' = 'single') {
  await page.goto('/oficina.html');
  await page.getByLabel('Obra', { exact: true }).fill('Dom Casmurro');
  await page.getByLabel('Dica de identificação (opcional)').fill('Machado de Assis, 1899');
  await page.getByLabel('Meio').selectOption('book');
  await page.getByLabel('Profundidade').selectOption('brief');
  if (modo === 'perLens') await page.getByLabel(/Uma conversa por lente/).check();
  await page.getByRole('button', { name: 'Montar os prompts' }).click();
}

test('monta prompts, recebe as oito lentes, confere a forma e exporta', async ({ page }) => {
  await montarPrompts(page);

  // Etapa 1: o prompt do dossiê é gerado a partir dos mesmos textos do app.
  const dossierPrompt = page.locator('#prompt-dossie');
  await expect(dossierPrompt).toContainText('Dom Casmurro');
  await expect(dossierPrompt).toContainText('Agente Pesquisador');

  await page.locator('#paste-dossie').fill(DOSSIER);

  // Etapa 2: o prompt do pacote precisa trazer as oito lentes e o formato de saída.
  const packPrompt = page.locator('#prompt-pacote');
  await expect(packPrompt).toContainText('Agente Estrutural');
  await expect(packPrompt).toContainText('Limites e verificações');

  await page.locator('#paste-lentes').fill(PACK);
  await expect(page.locator('#lentes-conta')).toContainText('8 de 8 lentes reconhecidas');

  // Etapa 3: a síntese recebe o que voltou.
  await page.locator('#paste-sintese').fill(SYNTHESIS);
  await expect(page.locator('#prompt-sintese')).toContainText('Agente Estrutural');

  // Etapa 4: a leitura integrada reúne tudo e aponta a forma.
  await page.getByRole('button', { name: 'Montar a leitura integrada' }).click();
  const report = page.locator('.report-body');
  await expect(report).toContainText('Relatório ANIMA — Dom Casmurro');
  await expect(report).toContainText('Agente Crítico');
  await expect(page.locator('.warnings')).toContainText('Nada a apontar na forma');

  // Download do relatório em markdown.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar .md' }).click();
  expect((await download).suggestedFilename()).toMatch(/dom-casmurro-oficina\.md$/);

  // Histórico sobrevive ao recarregamento (localStorage).
  await page.getByRole('button', { name: 'Salvar no histórico' }).click();
  await page.reload();
  const history = page.locator('#lista-historico');
  await expect(history).toContainText('Dom Casmurro');
  await expect(history).toContainText('8 lente(s)');
});

test('modo por lente avisa o que faltou colar', async ({ page }) => {
  await montarPrompts(page, 'perLens');
  await page.locator('#paste-dossie').fill(DOSSIER);

  // Só a primeira lente é preenchida.
  await page.locator('#paste-structural').fill(lensSection('ignorado').split('\n').slice(3).join('\n'));
  await expect(page.locator('.lens-step-state.done')).toHaveCount(1);

  await page.getByRole('button', { name: 'Montar a leitura integrada' }).click();
  await expect(page.locator('.warnings')).toContainText('7 lente(s) não voltaram');
  await expect(page.locator('.warnings')).toContainText('A síntese integrada ficou de fora');
});

test('o site continua funcionando offline e é instalável', async ({ page }) => {
  await page.goto('/oficina.html');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('form#form-obra')).toBeVisible();

  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const data = (await manifest.json()) as { start_url: string; display: string };
  expect(data.start_url).toBe('./oficina.html');
  expect(data.display).toBe('standalone');
});
