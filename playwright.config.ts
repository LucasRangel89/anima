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
    // Servidor de **produção**: em modo dev o primeiro carregamento compila o bundle do cliente no runner
    // (lento e variável), e os cliques do teste podiam chegar antes da hidratação. Build + start remove essa
    // variável e testa o que o usuário realmente roda.
    command: `npx next build && npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      LLM_PROVIDER: 'mock',
      ANIMA_STORE: 'memory',
      ANIMA_RATE_LIMIT: 'off',
      DATABASE_URL: 'file:./e2e.db',
      NEXT_TELEMETRY_DISABLED: '1',
      MOCK_DELAY_MS: '20',
    },
  },
});
