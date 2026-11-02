import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, retry, sleep, TimeoutError, withTimeout } from '../src/lib/anima/async-utils';

test('createLimiter respeita o máximo de tarefas simultâneas', async () => {
  const run = createLimiter(2);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 8 }, () =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await sleep(15);
        active--;
      })
    )
  );
  assert.equal(peak, 2);
});

test('createLimiter libera a vaga mesmo quando a tarefa falha', async () => {
  const run = createLimiter(1);
  await assert.rejects(run(async () => Promise.reject(new Error('x'))));
  assert.equal(await run(async () => 'ok'), 'ok');
});

test('withTimeout aborta o sinal e lança TimeoutError', async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('abortado'));
          });
        }),
      20,
      'teste'
    ),
    TimeoutError
  );
  assert.equal(aborted, true);
});

test('retry tenta novamente até ter sucesso', async () => {
  let calls = 0;
  const value = await retry(
    async () => {
      if (++calls < 3) throw new Error('falha');
      return 'ok';
    },
    { attempts: 3, delayMs: () => 1 }
  );
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('retry para imediatamente quando shouldRetry retorna false', async () => {
  let calls = 0;
  await assert.rejects(
    retry(
      async () => {
        calls++;
        throw new Error('fatal');
      },
      { attempts: 5, delayMs: () => 1, shouldRetry: () => false }
    ),
    /fatal/
  );
  assert.equal(calls, 1);
});
