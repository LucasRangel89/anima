// ANIMA — `npm run eval`
//
// Roda as cinco obras de referência contra um modelo REAL e escreve um relatório de qualidade.
// Fica fora do `npm test` de propósito: é lento, custa chamadas e o mock não serve para medir prosa.
//
// Uso:
//   npm run eval                      # todas as obras
//   npm run eval -- --only=dom-casmurro
//   npm run eval -- --mock            # ensaio: valida o encanamento sem gastar nada (resultado não vale)
//
// Saída: eval/relatorio.md e eval/relatorio.json

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GOLDEN_WORKS, evaluateWork, renderEvalReport, verifyReferences } from '../src/lib/anima/eval';
import type { AnalysisDTO } from '../src/lib/anima/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'eval');

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const allowMock = args.includes('--mock');
const offline = args.includes('--offline'); // pula a verificação de referências

async function main() {
  // Em avaliação o banco não interessa: as análises são lidas na hora e não precisam sobreviver.
  process.env.ANIMA_STORE ??= 'memory';
  // `--mock` não é só "deixa passar": é o provedor fictício de fato, para testar o encanamento.
  if (allowMock) process.env.LLM_PROVIDER = 'mock';

  const { startAnalysis, waitForRun } = await import('../src/lib/anima/orchestrator');
  const { getStore } = await import('../src/lib/anima/store-index');
  const { toAnalysisDTO } = await import('../src/lib/anima/dto');
  const { createLLM } = await import('../src/lib/anima/llm');

  const llm = createLLM();
  if (llm.provider === 'mock' && !allowMock) {
    console.error(
      [
        '',
        'O provedor está em modo demonstração (mock): as respostas são fictícias e não medem nada.',
        'Configure LLM_PROVIDER/LLM_API_KEY no .env, ou rode `npm run eval -- --mock` só para testar o encanamento.',
        '',
      ].join('\n')
    );
    process.exit(2);
  }

  if (llm.provider === 'mock') {
    console.warn('\n[ensaio] Usando mock: o relatório NÃO vale como avaliação de qualidade.\n');
  }

  const store = await getStore();
  const works = only ? GOLDEN_WORKS.filter((w) => w.id === only) : GOLDEN_WORKS;
  if (works.length === 0) {
    console.error(`Obra desconhecida: ${only}. Disponíveis: ${GOLDEN_WORKS.map((w) => w.id).join(', ')}`);
    process.exit(2);
  }

  const evaluations = [];

  for (const [index, work] of works.entries()) {
    const label = `[${index + 1}/${works.length}] ${work.title}`;
    process.stdout.write(`${label} … `);
    const started = Date.now();

    const { row } = await startAnalysis({
      title: work.title,
      hint: work.hint,
      focus: null,
      kind: work.kind,
      depth: work.depth,
    });
    await waitForRun(row.id);

    const stored = await store.get(row.id);
    if (!stored) {
      console.log('falhou (análise não encontrada)');
      continue;
    }
    const dto = toAnalysisDTO(stored) as AnalysisDTO;
    const evaluation = evaluateWork(work, dto);

    if (!offline) {
      const text = [
        dto.research ?? '',
        ...dto.results.map((r) => r.content ?? ''),
        dto.synthesis ?? '',
      ].join('\n');
      evaluation.references = await verifyReferences(text);
      evaluation.score.refsConfirmed = evaluation.references.filter((r) => r.status === 'confirmada').length;
      evaluation.score.refsDoubtful = evaluation.references.filter((r) => r.status === 'duvidosa').length;
      evaluation.score.refsUnverified = evaluation.references.filter((r) => r.status === 'nao_verificada').length;
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `${evaluation.status} em ${seconds}s · seções na faixa ${evaluation.score.sectionsInRange}/${evaluation.score.sectionsTotal}` +
        (evaluation.score.withLimits < evaluation.score.sectionsTotal ? ` · sem "Limites" em ${evaluation.score.sectionsTotal - evaluation.score.withLimits}` : '')
    );
    evaluations.push(evaluation);
  }

  const report = renderEvalReport(evaluations, {
    model: llm.provider === 'mock' ? `mock (ensaio — não vale como avaliação de qualidade)` : llm.model,
    date: new Date().toLocaleString('pt-BR'),
  });

  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'relatorio.md'), report, 'utf8');
  await writeFile(join(OUT, 'relatorio.json'), JSON.stringify(evaluations, null, 2), 'utf8');

  console.log(`\nRelatório: ${join('eval', 'relatorio.md')}`);
  const doubtful = evaluations.reduce((sum, e) => sum + e.score.refsDoubtful, 0);
  const unverified = evaluations.reduce((sum, e) => sum + e.score.refsUnverified, 0);
  if (doubtful || unverified) {
    console.log(
      `Referências: ${doubtful} duvidosa(s), ${unverified} não verificada(s) — veja a tabela antes de citar.`
    );
  }
}

main().catch((error) => {
  console.error('\nA avaliação falhou:', error);
  process.exit(1);
});
