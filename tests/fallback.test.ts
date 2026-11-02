// ANIMA — fallback de modelo em 429 persistente (Fase 1).
//
// Cenário real que isto cobre: o provedor gratuito devolve 429 com Retry-After de 15 minutos.
// Esperar significa a análise travada; tentar de novo no mesmo modelo, erro garantido. O ANIMA deve
// trocar para LLM_FALLBACK_MODEL, concluir a análise e dizer no relatório que trocou de modelo.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';

import { createMemoryStore } from '../src/lib/anima/store-memory';
import { setStore } from '../src/lib/anima/store-index';
import { startAnalysis, waitForRun } from '../src/lib/anima/orchestrator';
import { toAnalysisDTO } from '../src/lib/anima/dto';

let server: Server;
const seenModels: string[] = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as { model?: string }) : {};
      const model = body.model ?? '(vazio)';
      seenModels.push(model);

      if (model === 'modelo-no-limite') {
        // Espera longa: o orquestrador não deve insistir neste modelo.
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '900' });
        res.end(JSON.stringify({ error: { message: 'quota exceeded' } }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '### Análise\n\nTexto do modelo alternativo. [F1]' } }],
          usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

after(() => {
  server.close();
});

function configure() {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.env.LLM_PROVIDER = 'openai';
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = 'chave-de-teste';
  process.env.LLM_MODEL = 'modelo-no-limite';
  process.env.LLM_FALLBACK_MODEL = 'modelo-alternativo';
  process.env.ANIMA_STORE = 'memory';
  process.env.ANIMA_MAX_ACTIVE = '3';
}

test('429 persistente troca para LLM_FALLBACK_MODEL e conclui a análise', async () => {
  configure();
  seenModels.length = 0;
  const store = createMemoryStore();
  setStore(store);
  try {
    const { row } = await startAnalysis({
      title: 'Dom Casmurro',
      hint: null,
      focus: null,
      kind: 'book',
      depth: 'brief',
      agents: ['thematic'],
    });
    await waitForRun(row.id);

    const dto = toAnalysisDTO((await store.get(row.id))!);
    assert.equal(dto.status, 'completed', 'a análise deve terminar com o modelo alternativo');
    assert.equal(dto.synthesisStatus, 'done');
    assert.equal(dto.results.find((r) => r.agentKey === 'thematic')?.status, 'done');

    // Cada etapa tentou o principal primeiro e só então o alternativo.
    assert.ok(seenModels.includes('modelo-no-limite'), 'deve tentar o modelo principal antes');
    assert.ok(seenModels.includes('modelo-alternativo'), 'deve usar o modelo de fallback');

    assert.ok(dto.usage);
    assert.match(dto.usage.notices.join('\n'), /LLM_FALLBACK_MODEL|modelo alternativo/i);
    assert.ok(dto.usage.calls >= 3, 'as chamadas bem-sucedidas são contabilizadas');

    // O modelo registrado na análise passa a ser o que efetivamente escreveu.
    assert.equal(dto.model, 'modelo-alternativo');
  } finally {
    setStore(undefined);
    delete process.env.LLM_FALLBACK_MODEL;
  }
});

test('sem fallback configurado, o 429 vira erro claro (não fica tentando para sempre)', async () => {
  configure();
  delete process.env.LLM_FALLBACK_MODEL;
  const store = createMemoryStore();
  setStore(store);
  const started = Date.now();
  try {
    const { row } = await startAnalysis({
      title: 'Dom Casmurro',
      hint: null,
      focus: null,
      kind: 'book',
      depth: 'brief',
      agents: ['thematic'],
    });
    await waitForRun(row.id);

    const dto = toAnalysisDTO((await store.get(row.id))!);
    assert.equal(dto.status, 'failed');
    assert.match(dto.error ?? '', /Limite de requisições/);
    assert.match(dto.error ?? '', /aguardar/);
    // Com Retry-After de 900s, insistir levaria minutos: a falha precisa ser imediata.
    assert.ok(Date.now() - started < 15_000, `levou ${Date.now() - started}ms — não deveria esperar o Retry-After`);
  } finally {
    setStore(undefined);
  }
});
