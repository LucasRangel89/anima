// ANIMA — chamada única ao LLM com retry, timeout e fallback de modelo.
//
// O pipeline tem a própria versão (embrulhada pelo limitador de concorrência e pela contabilidade da análise).
// Perguntas de acompanhamento e comparações precisam da mesma política — 429 passageiro é refeito, credencial
// errada falha na hora, `LLM_FALLBACK_MODEL` entra uma vez só — sem duas implementações que divergem com o tempo.

import { isAbortError, retry, withTimeout } from './async-utils';
import { LLMError, isFatalLLMError, isRateLimitError, type LLM, type LLMCompletion } from './llm';

export interface CallWithRetryOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Tentativas no modelo principal (inclui a primeira). */
  attempts?: number;
  label?: string;
}

export interface CallWithRetryResult extends LLMCompletion {
  model: string;
  fallbackUsed: boolean;
}

export async function callWithRetry(
  llm: LLM,
  req: { system: string; user: string; maxTokens: number; temperature?: number },
  { timeoutMs = 120_000, signal, env = process.env, attempts = 2, label = 'chamada' }: CallWithRetryOptions = {}
): Promise<CallWithRetryResult> {
  const fallbackModel = (env.LLM_FALLBACK_MODEL ?? '').trim();

  const attempt = (target: LLM, tries: number) =>
    retry(
      () =>
        withTimeout(
          (inner) => target.complete({ ...req, temperature: req.temperature ?? 0.5, signal: inner, label }),
          timeoutMs,
          label,
          signal
        ),
      {
        attempts: tries,
        shouldRetry: (error) => !isFatalLLMError(error) && !isAbortError(error) && !signal?.aborted,
        delayMs: (error, n) =>
          isRateLimitError(error) ? (error instanceof LLMError && error.retryAfterMs) || 6_000 * n : 1_200 * n,
      }
    );

  try {
    const result = await attempt(llm, attempts);
    return { ...result, model: llm.model, fallbackUsed: false };
  } catch (error) {
    const alternative =
      fallbackModel && isRateLimitError(error) && !signal?.aborted ? llm.withModel?.(fallbackModel) : undefined;
    if (!alternative) throw error;
    const result = await attempt(alternative, 1);
    return { ...result, model: alternative.model, fallbackUsed: true };
  }
}
