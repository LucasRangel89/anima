// ANIMA — utilitários assíncronos: timeout, espera, limitador de concorrência e retry.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: tempo limite de ${Math.round(ms / 1000)}s excedido`);
    this.name = 'TimeoutError';
  }
}

/** A operação foi cancelada por quem chamou (ex.: usuário cancelou a análise). */
export class AbortedError extends Error {
  constructor(label: string) {
    super(`${label}: operação cancelada`);
    this.name = 'AbortedError';
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof AbortedError || (error instanceof Error && error.name === 'AbortError');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa `fn` com timeout. O `AbortSignal` recebido por `fn` é acionado no estouro,
 * permitindo cancelar de fato a requisição HTTP (em vez de apenas ignorar a resposta).
 * `external` permite cancelar de fora (cancelamento da análise pelo usuário).
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  external?: AbortSignal
): Promise<T> {
  if (external?.aborted) throw new AbortedError(label);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortFromOutside = () => {
    controller.abort();
    rejectAbort();
  };
  let rejectAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new AbortedError(label));
  });

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rejeitar ANTES de abortar: o abort faz a requisição rejeitar com AbortError,
      // e o usuário deve ver a mensagem de timeout, não "operação abortada".
      reject(new TimeoutError(label, ms));
      controller.abort();
    }, ms);
  });

  external?.addEventListener('abort', abortFromOutside, { once: true });
  try {
    const racers: Array<Promise<T>> = [fn(controller.signal), timeout];
    if (external) racers.push(aborted);
    return await Promise.race(racers);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', abortFromOutside);
  }
}

/** Limitador de concorrência (semáforo): no máximo `max` tarefas simultâneas. */
export function createLimiter(max: number) {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    queue.shift()?.();
  };

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

export interface RetryOptions {
  attempts: number;
  /** Atraso (ms) antes da tentativa seguinte, dado o erro e o número da tentativa que falhou. */
  delayMs: (error: unknown, failedAttempt: number) => number;
  /** Retorna false para erros que não valem nova tentativa (ex.: 401, 400). */
  shouldRetry?: (error: unknown) => boolean;
}

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === opts.attempts || opts.shouldRetry?.(error) === false) break;
      await sleep(opts.delayMs(error, attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function errorMessage(error: unknown, fallback = 'Falha inesperada.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
