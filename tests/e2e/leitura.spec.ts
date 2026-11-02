// ANIMA — e2e: o caminho principal, do formulário ao cofre do Obsidian.

import { expect, test } from '@playwright/test';

test('analisa uma obra, responde uma pergunta e baixa o cofre', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('ANIMA');

  // O exemplo preenche o formulário; nada é enviado antes do clique em "Analisar obra".
  await page.getByRole('button', { name: 'Dom Casmurro', exact: true }).click();
  await expect(page.getByLabel('Título da obra')).toHaveValue('Dom Casmurro');

  await page.getByRole('button', { name: /Analisar obra/ }).click();
  await page.waitForURL(/\/analise\//);

  // O relatório abre com a síntese e termina na nota de honestidade.
  await expect(page.getByRole('heading', { name: 'Dom Casmurro', level: 1 })).toBeVisible();
  await expect(page.getByText(/Conteúdo gerado por IA/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Modo demonstração|demonstração/).first()).toBeVisible();

  // Pergunta de acompanhamento: aparece o campo, a resposta entra na lista.
  const campo = page.getByLabel('Escreva sua pergunta sobre a obra');
  await expect(campo).toBeVisible();
  await campo.fill('Qual é a objeção mais forte a esta leitura?');
  await page.getByRole('button', { name: 'Perguntar' }).click();

  await expect(page.getByText('Qual é a objeção mais forte a esta leitura?')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/provedor mock/).last()).toBeVisible({ timeout: 60_000 });

  // Exportação para o Obsidian: o navegador recebe um .zip de verdade.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Para o Obsidian/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^anima-.*-obsidian\.zip$/);
});

test('tema alterna e o método abre pelo cabeçalho', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  const before = await html.getAttribute('class');

  await page.getByRole('button', { name: 'Alternar entre tema claro e escuro' }).click();
  await expect
    .poll(async () => html.getAttribute('class'), { timeout: 10_000 })
    .not.toBe(before);

  await page.getByRole('link', { name: 'Método' }).click();
  await expect(page).toHaveURL(/\/metodo$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
