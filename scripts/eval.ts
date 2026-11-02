// ANIMA — `npm run eval`: avaliação de qualidade com um modelo de verdade.
//
// Fora do `npm test` de propósito: faz chamadas reais, gasta cota e depende de um provedor configurado.
// Com `--offline`, pula a conferência de referências (Open Library/Crossref).
// Com `--mock`, roda o encanamento inteiro sem custo — o relatório sai marcado como ensaio.

import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  /* sem .env: usa o ambiente atual */
}

// Sem banco durante a avaliação: o resultado é lido na hora e não precisa sobreviver.
process.env.ANIMA_STORE = 'memory';

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const allowMock = args.has('--mock');

async function main() {
  const { GOLDEN_WORKS, evaluateAnalysis, renderEvalReport, verifyReferences } = await import('../src/lib/anima/eval');
  const { startAnalysis } = await import('../src/lib/anima/orchestrator');
  const { getStore } = await import('../src/lib/anima/store-index');
  const { toAnalysisDTO } = await import('../src/lib/anima/dto');
  const { getSystemStatus } = await import('../src/lib/anima/status');

  const status = getSystemStatus();
  if (!status.configured) {
    console.error(`\nO modelo não está configurado: ${status.message ?? 'defina LLM_API_KEY no .env'}\n`);
    process.exit(1);
  }
  if (status.provider === 'mock' && !allowMock) {
    console.error(
      '\nO provedor está em modo demonstração — o relatório não mediria nada.\n' +
        'Configure LLM_PROVIDER/LLM_API_KEY no .env, ou rode `npm run eval -- --mock` só para testar o encanamento.\n'
    );
    process.exit(1);
  }

  const model = status.model ?? process.env.LLM_MODEL ?? 'modelo não informado';
  console.log(`\nAvaliação ANIMA — ${GOLDEN_WORKS.length} obras · modelo ${model}${offline ? ' · sem conferir referências' : ''}\n`);

  const store = await getStore();
  const evaluations = [];
  const verified = new Map<string, Awaited<ReturnType<typeof verifyReferences>>>();

  for (const [index, work] of GOLDEN_WORKS.entries()) {
    const label = `[${index + 1}/${GOLDEN_WORKS.length}] ${work.title}`;
    process.stdout.write(`${label} … `);

    const started = await startAnalysis({
      title: work.title,
      hint: work.hint,
      focus: work.focus,
      kind: work.kind,
      depth: work.depth,
    });

    // Espera o pipeline terminar. O teto é generoso: exaustiva em provedor gratuito pode levar minutos.
    const deadline = Date.now() + 15 * 60_000;
    let row = await store.get(started.row.id);
    while (row && !['completed', 'failed', 'interrupted'].includes(row.status) && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
      row = await store.get(started.row.id);
    }

    if (!row) {
      console.log('análise sumiu do store');
      continue;
    }

    const analysis = toAnalysisDTO(row);
    const evaluation = evaluateAnalysis(work, analysis);
    evaluations.push(evaluation);

    if (!offline) {
      verified.set(work.id, await verifyReferences(evaluation.references));
    }

    const confirmed = (verified.get(work.id) ?? []).filter((r) => r.verdict === 'confirmada').length;
    console.log(
      `${row.status} · ${evaluation.totals.withinRange}/${evaluation.totals.lenses} na faixa · ` +
        `${evaluation.totals.withLimits}/${evaluation.totals.lenses} com limites` +
        (offline ? '' : ` · ${confirmed}/${evaluation.references.length} referências confirmadas`)
    );
  }

  const report = renderEvalReport(evaluations, verified, {
    model,
    date: new Date().toLocaleString('pt-BR'),
    offline,
  });

  const out = resolve(ROOT, offline ? 'eval-report-offline.md' : 'eval-report.md');
  writeFileSync(out, report, 'utf8');
  writeFileSync(
    resolve(ROOT, 'eval-report.json'),
    JSON.stringify({ model, offline, date: new Date().toISOString(), evaluations, verified: Object.fromEntries(verified) }, null, 2),
    'utf8'
  );

  console.log(`\nRelatório: ${out}`);
  console.log('Referência confirmada = a obra existe com aquele autor e ano nas bases; não valida o que o texto afirma sobre ela.\n');
}

main().catch((error) => {
  console.error('\nA avaliação falhou:', error instanceof Error ? error.message : error);
  process.exit(1);
});
