// ANIMA — verificação do cliente LLM OpenAI-compatível contra um servidor HTTP local.
//
// Este é o caminho real de integração com Gemini (endpoint compatível), Groq, OpenRouter e Ollama:
// mesma URL, mesmos cabeçalhos, mesmo corpo. Rodando contra 127.0.0.1 não gastamos nada e ainda
// checamos exatamente o que sai no fio (modelo, mensagens, max_tokens, temperatura, auth).

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  createLLM,
  isFatalLLMError,
  isRateLimitError,
  LLMError,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  resolveProvider,
  getSystemStatus,
} from '../src/lib/anima/llm';

interface Captured {
  url: string;
  auth: string | undefined;
  contentType: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let port = 0;
let captured: Captured[] = [];
let responder: (req: Captured) => { status: number; headers?: Record<string, string>; body: unknown } = () => ({
  status: 200,
  body: { choices: [{ message: { content: '  resposta do modelo  ' }, finish_reason: 'stop' }] },
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  captured = [];
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const raw = await readBody(req);
    const entry: Captured = {
      url: req.url ?? '',
      auth: req.headers.authorization,
      contentType: req.headers['content-type'] as string | undefined,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
    };
    captured.push(entry);
    const out = responder(entry);
    res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;

  // O cliente usa fetch global; apontamos o base URL para o servidor local e mantemos o fetch real.
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * O `process.env` do projeto é declarado com tipos exatos (NODE_ENV obrigatório), então as
 * fixtures de teste precisam de um cast explícito. Isolado aqui para não poluir as asserções.
 */
const envOf = (values: Record<string, string>): NodeJS.ProcessEnv => values as unknown as NodeJS.ProcessEnv;

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  envOf({
    LLM_PROVIDER: 'openai',
    LLM_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LLM_API_KEY: 'chave-de-teste',
    LLM_MODEL: 'modelo-de-teste',
    ...extra,
  });

test('envia exatamente o que o provedor OpenAI-compatível espera', async () => {
  const llm = createLLM(env());
  const { text, usage } = await llm.complete({
    system: 'PROMPT DE SISTEMA',
    user: 'MENSAGEM DO USUÁRIO',
    maxTokens: 1234,
    temperature: 0.7,
    label: 'teste',
  });

  assert.equal(text, 'resposta do modelo'); // trim aplicado
  assert.equal(usage, undefined, 'sem bloco usage na resposta, o cliente não inventa números');
  assert.equal(captured.length, 1);
  const call = captured[0];
  assert.equal(call.url, '/v1/chat/completions');
  assert.equal(call.auth, 'Bearer chave-de-teste');
  assert.equal(call.contentType, 'application/json');
  assert.equal(call.body.model, 'modelo-de-teste');
  assert.equal(call.body.max_tokens, 1234);
  assert.equal(call.body.temperature, 0.7);
  assert.deepEqual(call.body.messages, [
    { role: 'system', content: 'PROMPT DE SISTEMA' },
    { role: 'user', content: 'MENSAGEM DO USUÁRIO' },
  ]);
});

test('omite max_tokens quando não informado e usa temperatura padrão', async () => {
  const llm = createLLM(env({ LLM_MODEL: '' })); // modelo vazio cai no padrão gpt-4o-mini
  await llm.complete({ system: 's', user: 'u', label: 'teste' });
  assert.equal(captured[0].body.max_tokens, undefined);
  assert.equal(captured[0].body.temperature, 0.4);
  assert.equal(captured[0].body.model, 'gpt-4o-mini');
});

test('429 vira LLMError recuperável com Retry-After convertido em ms', async () => {
  responder = () => ({
    status: 429,
    headers: { 'retry-after': '7' },
    body: { error: { message: 'rate limit' } },
  });
  const llm = createLLM(env());
  await assert.rejects(
    () => llm.complete({ system: 's', user: 'u', label: 't' }),
    (error: unknown) => {
      assert.ok(error instanceof LLMError);
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterMs, 7000);
      assert.equal(isRateLimitError(error), true);
      assert.equal(isFatalLLMError(error), false); // 429 deve ser repetido
      return true;
    }
  );
});

test('401 e 404 são fatais (não adianta repetir) e a mensagem traz o motivo', async () => {
  responder = () => ({ status: 401, body: { error: { message: 'invalid api key' } } });
  const llm = createLLM(env());
  await assert.rejects(
    () => llm.complete({ system: 's', user: 'u', label: 't' }),
    (error: unknown) => {
      assert.ok(error instanceof LLMError);
      assert.equal(error.status, 401);
      assert.equal(isFatalLLMError(error), true);
      assert.match(error.message, /401/);
      assert.match(error.message, /invalid api key/);
      return true;
    }
  );
});

test('resposta vazia é erro (não deixa a análise com seção em branco)', async () => {
  responder = () => ({ status: 200, body: { choices: [{ message: { content: '   ' } }] } });
  const llm = createLLM(env());
  await assert.rejects(
    () => llm.complete({ system: 's', user: 'u', label: 't' }),
    (error: unknown) => {
      assert.ok(error instanceof LLMError);
      assert.match(error.message, /vazia/i);
      return true;
    }
  );
});

test('resposta sem choices também é erro tratado', async () => {
  responder = () => ({ status: 200, body: {} });
  const llm = createLLM(env());
  await assert.rejects(() => llm.complete({ system: 's', user: 'u', label: 't' }), /vazia/i);
});

test('falha de rede vira LLMError com contexto (não um TypeError cru)', async () => {
  const llm = createLLM(env({ LLM_BASE_URL: 'http://127.0.0.1:1/v1' }));
  await assert.rejects(
    () => llm.complete({ system: 's', user: 'u', label: 't' }),
    (error: unknown) => {
      assert.ok(error instanceof LLMError);
      assert.match(error.message, /Falha de rede ao chamar o LLM/);
      return true;
    }
  );
});

test('sem chave, o cliente falha antes de sair para a rede', async () => {
  const llm = createLLM(env({ LLM_API_KEY: '' }));
  await assert.rejects(
    () => llm.complete({ system: 's', user: 'u', label: 't' }),
    (error: unknown) => {
      assert.ok(error instanceof LLMError);
      assert.equal(error.status, 401);
      return true;
    }
  );
  assert.equal(captured.length, 0);
});

test('o signal de cancelamento aborta a requisição em curso', async () => {
  responder = () => ({ status: 200, body: { choices: [{ message: { content: 'ok' } }] } });
  const llm = createLLM(env());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() =>
    llm.complete({ system: 's', user: 'u', label: 't', signal: controller.signal })
  );
});

test('a URL base aceita barra final e caminho com prefixo (ex.: /openai)', async () => {
  const llm = createLLM(env({ LLM_BASE_URL: `http://127.0.0.1:${port}/openai/` }));
  await llm.complete({ system: 's', user: 'u', label: 't' });
  assert.equal(captured[0].url, '/openai/chat/completions');
});

test('resolveProvider e getSystemStatus refletem a configuração', () => {
  assert.equal(resolveProvider(envOf({ LLM_PROVIDER: 'mock' })), 'mock');
  assert.equal(resolveProvider(envOf({ LLM_API_KEY: 'x' })), 'openai');
  assert.equal(resolveProvider(envOf({})), 'zai');

  const semChave = getSystemStatus(envOf({ LLM_PROVIDER: 'openai' }));
  assert.equal(semChave.configured, false);
  assert.match(semChave.message ?? '', /LLM_API_KEY/);

  const comChave = getSystemStatus(envOf({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'x', TAVILY_API_KEY: 't' }));
  assert.equal(comChave.configured, true);
  assert.equal(comChave.search, 'tavily');
});

test('usage do provedor é repassado sem arredondar nem inventar', async () => {
  responder = () => ({
    status: 200,
    body: {
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 },
    },
  });
  const { usage } = await createLLM(env()).complete({ system: 's', user: 'u', label: 't' });
  assert.deepEqual(usage, { promptTokens: 1234, completionTokens: 56, totalTokens: 1290 });
});

test('withModel troca só o modelo e mantém endpoint/chave', async () => {
  const llm = createLLM(env({ LLM_MODEL: 'principal' }));
  const alt = llm.withModel?.('alternativo');
  assert.ok(alt, 'o cliente OpenAI-compatível precisa suportar fallback');
  assert.equal(alt.model, 'alternativo');
  assert.equal(alt.provider, 'openai');

  await alt.complete({ system: 's', user: 'u', label: 't' });
  assert.equal(captured[0].body.model, 'alternativo');
  assert.equal(captured[0].url, '/v1/chat/completions');
  assert.equal(captured[0].auth, 'Bearer chave-de-teste');
  assert.equal(createLLM({ LLM_PROVIDER: 'mock' } as unknown as NodeJS.ProcessEnv).withModel, undefined);
});

test('parseRetryAfter entende segundos e data HTTP, e ignora lixo', () => {
  assert.equal(parseRetryAfter('30'), 30_000);
  assert.equal(parseRetryAfter('0'), undefined);
  assert.equal(parseRetryAfter(null), undefined);
  assert.equal(parseRetryAfter('abc'), undefined);

  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(parseRetryAfter('Mon, 02 Nov 2026 12:00:20 GMT', now), 20_000);
  assert.equal(parseRetryAfter('Mon, 02 Nov 2026 11:00:00 GMT', now), undefined, 'data no passado não vira espera');
  assert.ok(MAX_RETRY_AFTER_MS > 0);
});

test('429 com espera longa é identificável como "não vale esperar" (gatilho do fallback)', async () => {
  responder = () => ({
    status: 429,
    headers: { 'retry-after': '900' },
    body: { error: { message: 'rate limit' } },
  });
  const llm = createLLM(env());
  await assert.rejects(
    () => llm.complete({ system: 's', user: 'u', label: 't' }),
    (error: unknown) => {
      assert.ok(error instanceof LLMError);
      assert.equal(error.retryAfterMs, 900_000);
      assert.ok((error.retryAfterMs ?? 0) > MAX_RETRY_AFTER_MS);
      return true;
    }
  );
});

test('o provedor mock devolve usage estimado e marca como estimado', async () => {
  const mock = createLLM({ LLM_PROVIDER: 'mock', MOCK_DELAY_MS: '0' } as unknown as NodeJS.ProcessEnv);
  const { text, usage } = await mock.complete({ system: 's', user: 'Obra analisada: "X"', label: 'sintese' });
  assert.ok(text.length > 0);
  assert.equal(usage?.estimated, true);
  assert.ok((usage?.totalTokens ?? 0) > 0);
});
