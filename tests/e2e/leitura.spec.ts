// ANIMA — e2e: o caminho principal, do formulário ao cofre do Obsidian.

import { expect, test } from '@playwright/test';

/** Erros de JavaScript e do console entram na saída do teste — sem isso, uma tela "morta" não diz por quê. */
function watch(page: import('@playwright/test').Page) {
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[console.error] ${message.text()}`);
  });
}

test('analisa uma obra, responde uma pergunta e baixa o cofre', async ({ page }) => {
  watch(page);
  await page.goto('/');

  // Em produção a hidratação é rápida; ainda assim, só seguimos quando o runtime do Next existe na página.
  await page.waitForFunction(() => Boolean((window as unknown as { next?: { version?: string } }).next?.version), undefined, {
    timeout: 120_000,
  });
  await expect(page).toHaveTitle(/ANIMA/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // O exemplo preenche o formulário (estado do React). Em modo dev a hidratação pode demorar: o clique é
  // repetido até o campo refletir o estado, em vez de se perder no intervalo entre HTML e JavaScript.
  await expect(async () => {
    await page.getByRole('button', { name: 'Dom Casmurro', exact: true }).click();
    await expect(page.getByLabel('Obra', { exact: true })).toHaveValue('Dom Casmurro', { timeout: 2_000 });
  }).toPass({ timeout: 120_000 });

  // Diagnóstico: se o servidor recusar, a mensagem dele precisa aparecer na falha do teste.
  const status = await (await page.request.get('/api/status')).text();
  console.log(`[api/status] ${status.slice(0, 300)}`);

  const botao = page.getByRole('button', { name: /Analisar obra/ });
  await expect(botao).toBeEnabled({ timeout: 60_000 });

  // Se algo cobrir o botão, o clique do Playwright espera para sempre: medimos antes e dizemos o que é.
  const diagnostico = await botao.evaluate((elemento) => {
    const caixa = elemento.getBoundingClientRect();
    const topo = document.elementFromPoint(caixa.left + caixa.width / 2, caixa.top + caixa.height / 2);
    return {
      topo: topo ? `${topo.tagName.toLowerCase()}.${String(topo.className).slice(0, 80)}` : 'null',
      y: Math.round(caixa.top),
      alturaJanela: window.innerHeight,
      lentesAtivas: document.querySelectorAll('[aria-pressed="true"]').length,
    };
  });
  console.log(`[botão Analisar] ${JSON.stringify(diagnostico)}`);

  const [resposta] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/analyses') && r.request().method() === 'POST', {
      timeout: 120_000,
    }),
    botao.click(),
  ]);
  const corpo = await resposta.text();
  console.log(`[POST /api/analyses] ${resposta.status()} ${corpo.slice(0, 400)}`);
  expect(resposta.ok(), `POST /api/analyses → ${resposta.status()}: ${corpo.slice(0, 400)}`).toBeTruthy();

  await page.waitForURL(/\/analise\//, { timeout: 120_000 });

  // O relatório abre com o título; a conclusão é sinalizada pela caixa de perguntas, que só existe no fim.
  await expect(page.getByRole('heading', { name: 'Dom Casmurro', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Perguntas de acompanhamento' })).toBeVisible({ timeout: 120_000 });

  // Pergunta de acompanhamento: aparece o campo, a resposta entra na lista.
  const campo = page.getByLabel('Escreva sua pergunta sobre a obra');
  await expect(campo).toBeVisible();
  await campo.fill('Qual é a objeção mais forte a esta leitura?');
  await page.getByRole('button', { name: 'Perguntar' }).click();

  await expect(page.getByText('Qual é a objeção mais forte a esta leitura?')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/gerado pelo provedor/).last()).toBeVisible({ timeout: 90_000 });

  // Exportação para o Obsidian: o navegador recebe um .zip de verdade.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Para o Obsidian/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^anima-.*-obsidian\.zip$/);
});

test('tema alterna e o método abre pelo cabeçalho', async ({ page }) => {
  watch(page);
  await page.goto('/');
  const html = page.locator('html');
  const before = await html.getAttribute('class');

  // Mesmo motivo do teste anterior: se o clique chegar antes da hidratação, ele se perde.
  await expect(async () => {
    await page.getByRole('button', { name: 'Alternar entre tema claro e escuro' }).click();
    await expect.poll(async () => html.getAttribute('class'), { timeout: 2_000 }).not.toBe(before);
  }).toPass({ timeout: 120_000 });

  // "Método" aparece no cabeçalho e no rodapé: o teste fala com a navegação principal, não com o texto solto.
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Método' }).click();
  await expect(page).toHaveURL(/\/metodo$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
