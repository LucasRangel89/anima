// ANIMA — e2e: comparar duas obras já analisadas.
//
// As duas análises são criadas pela API (mais rápido e menos frágil que clicar duas vezes no formulário);
// o que se testa na interface é a escolha, a comparação, o download e a remoção.

import { expect, test, type APIRequestContext } from '@playwright/test';

async function analisar(request: APIRequestContext, title: string): Promise<string> {
  const created = await request.post('/api/analyses', {
    data: { title, kind: 'book', depth: 'brief', force: true },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()) as { id: string };

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${id}`);
        if (!res.ok()) return 'erro';
        const body = (await res.json()) as { analysis: { status: string } };
        return body.analysis.status;
      },
      { timeout: 90_000 }
    )
    .toBe('completed');

  return id;
}

test('compara duas análises concluídas e guarda o resultado', async ({ page, request }) => {
  await analisar(request, 'Dom Casmurro');
  await analisar(request, 'Cem Anos de Solidão');

  await page.goto('/comparar');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Comparar duas obras');

  await page.getByLabel('Primeira obra').selectOption({ index: 1 });
  await page.getByLabel('Segunda obra').selectOption({ index: 2 });
  await page.getByRole('button', { name: 'Comparar', exact: true }).click();

  await expect(page.getByText(/Dom Casmurro × Cem Anos de Solidão|Cem Anos de Solidão × Dom Casmurro/)).toBeVisible({
    timeout: 90_000,
  });

  // O histórico sobrevive a recarregar a página.
  await page.reload();
  await expect(page.getByText(/×/).first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Baixar .md' }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^anima-comparacao-.*\.md$/);

  // Remover limpa o histórico.
  await page.getByRole('button', { name: /Remover comparação/ }).first().click();
  await expect(page.getByText('Nenhuma ainda. A primeira aparece aqui.')).toBeVisible();
});
