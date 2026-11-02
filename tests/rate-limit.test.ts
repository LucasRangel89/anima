// ANIMA — limitador de requisições.
//
// O relógio é injetável: nada aqui espera uma hora. O que importa é a borda — a janela fecha, o `Retry-After`
// aponta para a requisição mais antiga, e desligar o limite não deixa estado escondido.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRateLimiter,
  rateLimitResponse,
  resetRateLimits,
  analysisRateLimit,
  extraCallRateLimit,
} from '../src/lib/anima/rate-limit';

test('deixa passar até o teto e recusa a seguinte, com espera coerente', () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

  assert.deepEqual(
    [limiter.check(), limiter.check(), limiter.check()].map((r) => r.ok),
    [true, true, true]
  );
  const blocked = limiter.check();
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.limit, 3);

  // Primeira requisição foi em now; a janela fecha 60 s depois dela.
  now += 30_000;
  const stillBlocked = limiter.check();
  assert.equal(stillBlocked.ok, false);
  assert.equal(stillBlocked.retryAfterMs, 30_000);

  now += 30_000; // exatamente na borda: já saiu
  assert.equal(limiter.check().ok, true);
});

test('a janela é deslizante, não um balde que zera de uma vez', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });

  assert.equal(limiter.check().ok, true); // t=0
  now = 400;
  assert.equal(limiter.check().ok, true); // t=400
  now = 600;
  assert.equal(limiter.check().ok, false);
  now = 1_000; // a de t=0 saiu
  assert.equal(limiter.check().ok, true);
  assert.equal(limiter.size(), 2);
});

test('chaves diferentes não se atrapalham', () => {
  const now = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
  assert.equal(limiter.check('a').ok, true);
  assert.equal(limiter.check('b').ok, true);
  assert.equal(limiter.check('a').ok, false);
  limiter.reset('a');
  assert.equal(limiter.check('a').ok, true);
});

test('rateLimitResponse converte a espera em minutos legíveis e segundos para o header', () => {
  const { message, retryAfterSeconds } = rateLimitResponse(
    { ok: false, limit: 20, remaining: 0, retryAfterMs: 125_000 },
    'análises'
  );
  assert.match(message, /20 por hora/);
  assert.match(message, /3 min/);
  assert.equal(retryAfterSeconds, 125);
});

test('ANIMA_RATE_LIMIT=off desliga; teto 0 também', () => {
  resetRateLimits();
  assert.equal(analysisRateLimit({ NODE_ENV: 'test', ANIMA_RATE_LIMIT: 'off' }).ok, true);

  resetRateLimits();
  const disabled = analysisRateLimit({ NODE_ENV: 'test', ANIMA_RATE_LIMIT_ANALYSES: '0' });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.limit, 0);
});

test('o teto vem da env e o balde é compartilhado entre chamadas', () => {
  resetRateLimits();
  const env = { NODE_ENV: 'test', ANIMA_RATE_LIMIT_ANALYSES: '2' } as NodeJS.ProcessEnv;

  assert.equal(analysisRateLimit(env).ok, true);
  assert.equal(analysisRateLimit(env).ok, true);
  const third = analysisRateLimit(env);
  assert.equal(third.ok, false);
  assert.equal(third.limit, 2);

  // Balde separado para perguntas/comparações.
  assert.equal(extraCallRateLimit({ NODE_ENV: 'test', ANIMA_RATE_LIMIT_EXTRA: '1' }).ok, true);
  resetRateLimits();
});
