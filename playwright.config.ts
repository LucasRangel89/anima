// ANIMA — configuração do e2e (Playwright).
//
// Roda contra um servidor de desenvolvimento em porta própria, **provedor mock** e store em memória: o que se
// testa aqui é a interface de verdade (clicar, esperar, baixar), não a qualidade do modelo. O CI tem navegador;
// este sandbox não, então o e2e é o único teste que só se prova no GitHub Actions.

import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  // Um store em memória por processo: paralelismo entre arquivos criaria disputa de estado.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    // Traces são pesados (dezenas de MB); guardamos apenas na primeira repetição de uma falha.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    // Log do servidor vai para o mesmo arquivo do teste: erro de compilação/hidratação fica visível.
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      LLM_PROVIDER: 'mock',
      ANIMA_STORE: 'memory',
      ANIMA_RATE_LIMIT: 'off',
      NEXT_TELEMETRY_DISABLED: '1',
      MOCK_DELAY_MS: '20',
    },
  },
});
