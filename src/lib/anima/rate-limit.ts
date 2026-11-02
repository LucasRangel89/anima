// ANIMA — limitador de requisições em memória (janela deslizante).
//
// Por que existe: publicar o ANIMA fora do localhost significa uma URL que qualquer um com o link alcança. Sem
// limite, um script (ou uma aba repetida) enfileira análises e queima a cota gratuita do provedor em minutos.
//
// Escopo: é **por processo**, não por usuário autenticado — o ANIMA é de uso pessoal e roda num processo só.
// Quem publica deve manter `ANIMA_ACCESS_TOKEN` ligado; o limite é a segunda barreira, não a primeira.
// Com mais de uma instância, cada instância tem o próprio contador (documentado, não fingido).

export interface RateLimitOptions {
  /** Quantas requisições cabem na janela. */
  limit: number;
  windowMs: number;
  /** Relógio injetável: os testes não precisam esperar. */
  now?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  /** Quantas ainda cabem nesta janela. */
  remaining: number;
  /** Quanto falta para a requisição mais antiga sair da janela (0 quando `ok`). */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key?: string): RateLimitResult;
  reset(key?: string): void;
  /** Só para diagnóstico/teste: quantas marcas a chave tem agora. */
  size(key?: string): number;
}

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();
  const safeLimit = Math.max(1, Math.floor(limit));

  const prune = (key: string, time: number) => {
    const list = hits.get(key);
    if (!list) return [];
    const fresh = list.filter((t) => time - t < windowMs);
    if (fresh.length) hits.set(key, fresh);
    else hits.delete(key);
    return fresh;
  };

  return {
    check(key = 'global') {
      const time = now();
      const fresh = prune(key, time);

      if (fresh.length >= safeLimit) {
        const oldest = fresh[0];
        return {
          ok: false,
          limit: safeLimit,
          remaining: 0,
          // +1 ms: no instante exato da borda, a janela ainda conta.
          retryAfterMs: Math.max(1, windowMs - (time - oldest)),
        };
      }

      fresh.push(time);
      hits.set(key, fresh);
      return { ok: true, limit: safeLimit, remaining: safeLimit - fresh.length, retryAfterMs: 0 };
    },

    reset(key = 'global') {
      hits.delete(key);
    },

    size(key = 'global') {
      return prune(key, now()).length;
    },
  };
}

/** Janela de uma hora, com teto configurável. `0` desliga aquele limite. */
function limitFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = Number.parseInt(env[name] ?? '', 10);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, raw);
}

/** `ANIMA_RATE_LIMIT=off` desliga todos os limites (útil em teste e em máquina isolada). */
function enabled(env: NodeJS.ProcessEnv): boolean {
  return (env.ANIMA_RATE_LIMIT ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * Limites por hora. Defaults pensados para cota gratuita: 20 análises e 120 chamadas curtas (perguntas +
 * comparações) por hora — muito acima do uso humano, muito abaixo de um loop acidental.
 *
 * O limitador é escolhido pelo teto configurado: mudar a env não mistura históricos de limites diferentes.
 */
const WINDOW_MS = 60 * 60_000;
const limiters = new Map<string, RateLimiter>();

function limiterFor(name: string, limit: number): RateLimiter {
  const key = `${name}:${limit}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = createRateLimiter({ limit, windowMs: WINDOW_MS });
    limiters.set(key, limiter);
  }
  return limiter;
}

function check(name: string, env: NodeJS.ProcessEnv, envName: string, fallback: number, off: RateLimitResult): RateLimitResult {
  if (!enabled(env)) return off;
  const limit = limitFromEnv(env, envName, fallback);
  if (limit === 0) return off;
  return limiterFor(name, limit).check();
}

const OFF: RateLimitResult = { ok: true, limit: 0, remaining: 0, retryAfterMs: 0 };

export function analysisRateLimit(env: NodeJS.ProcessEnv = process.env): RateLimitResult {
  return check('analises', env, 'ANIMA_RATE_LIMIT_ANALYSES', 20, OFF);
}

/** Perguntas e comparações compartilham o mesmo balde: ambas são uma chamada curta ao modelo. */
export function extraCallRateLimit(env: NodeJS.ProcessEnv = process.env): RateLimitResult {
  return check('extras', env, 'ANIMA_RATE_LIMIT_EXTRA', 120, OFF);
}

/** Mensagem pronta para a API, com `Retry-After` em segundos (mínimo 1). */
export function rateLimitResponse(result: RateLimitResult, what: string): { message: string; retryAfterSeconds: number } {
  const minutes = Math.max(1, Math.ceil(result.retryAfterMs / 60_000));
  return {
    message: `Limite de ${what} atingido (${result.limit} por hora). Tente de novo em ${minutes} min.`,
    retryAfterSeconds: Math.max(1, Math.ceil(result.retryAfterMs / 1000)),
  };
}

/** Apenas para testes: zera os baldes globais. */
export function resetRateLimits(): void {
  limiters.clear();
}
