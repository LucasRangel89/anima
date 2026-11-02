// ANIMA — camada de LLM independente de provedor.
//
//  openai : qualquer API compatível com OpenAI (OpenAI, OpenRouter, Groq, Ollama, Gemini, GLM…)
//  zai    : SDK z-ai-web-dev-sdk (somente no ambiente Z.ai) — carregado sob demanda
//  mock   : respostas fictícias e determinísticas, sem custo (demonstração e testes)

import type { SystemStatusDTO } from './types';
import { sleep } from './async-utils';

export interface LLMRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Rótulo da chamada (ex.: "especialista:thematic"). Usado em logs e pelo provedor mock. */
  label: string;
}

/** Tokens informados pelo provedor (ou estimados, no caso do mock). */
export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** `true` quando os números não vieram do provedor. */
  estimated?: boolean;
}

export interface LLMCompletion {
  text: string;
  usage?: LLMUsage;
}

export interface LLM {
  readonly provider: 'openai' | 'zai' | 'mock';
  readonly model: string;
  complete(req: LLMRequest): Promise<LLMCompletion>;
  /**
   * Mesmo provedor/cliente com outro modelo. Usado para o fallback em 429 persistente
   * (LLM_FALLBACK_MODEL) e na troca manual de modelo. O mock não implementa.
   */
  withModel?(model: string): LLM;
}

/** Erro de API com status HTTP, para decidir retry e backoff. */
export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** `Retry-After` pode vir em segundos ("30") ou como data HTTP ("Wed, 21 Oct 2015 07:28:00 GMT"). */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : undefined;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  const diff = date - now;
  return diff > 0 ? diff : undefined;
}

/** Acima disto, esperar não é aceitável: é melhor tentar o modelo alternativo e avisar o usuário. */
export const MAX_RETRY_AFTER_MS = 60_000;

export function isRateLimitError(error: unknown): boolean {
  if (error instanceof LLMError) return error.status === 429;
  return error instanceof Error && /\b429\b|too many requests|rate.?limit/i.test(error.message);
}

/** Erros de configuração/credencial não se resolvem com nova tentativa. */
export function isFatalLLMError(error: unknown): boolean {
  return error instanceof LLMError && [400, 401, 403, 404].includes(error.status ?? 0);
}

type Provider = LLM['provider'];

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const explicit = env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === 'openai' || explicit === 'zai' || explicit === 'mock') return explicit;
  return env.LLM_API_KEY ? 'openai' : 'zai';
}

/** Estado de configuração sem os dados de runtime (fila/fontes), que são agregados em `status.ts`. */
export type BaseSystemStatus = Omit<SystemStatusDTO, 'sources' | 'queue'>;

export function getSystemStatus(env: NodeJS.ProcessEnv = process.env): BaseSystemStatus {
  const provider = resolveProvider(env);
  const search: SystemStatusDTO['search'] =
    provider === 'mock' ? 'none' : env.TAVILY_API_KEY ? 'tavily' : provider === 'zai' ? 'zai' : 'wikipedia';

  if (provider === 'openai') {
    const configured = Boolean(env.LLM_API_KEY);
    return {
      provider,
      configured,
      model: env.LLM_MODEL || 'gpt-4o-mini',
      search,
      message: configured ? null : 'Defina LLM_API_KEY no arquivo .env para habilitar as análises (veja .env.example).',
    };
  }
  if (provider === 'mock') {
    return {
      provider,
      configured: true,
      model: 'mock',
      search,
      message: 'Modo demonstração: as respostas são fictícias. Configure LLM_API_KEY para análises reais.',
    };
  }
  return { provider, configured: true, model: null, search, message: null };
}

/* ───────────────────────── OpenAI-compatível ───────────────────────── */

function createOpenAICompatible(env: NodeJS.ProcessEnv, overrideModel?: string): LLM {
  const baseUrl = (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = env.LLM_API_KEY;
  const model = overrideModel || env.LLM_MODEL || 'gpt-4o-mini';

  return {
    provider: 'openai',
    model,
    async complete({ system, user, maxTokens, temperature = 0.4, signal }) {
      if (!apiKey) throw new LLMError('LLM_API_KEY não configurada.', 401);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            temperature,
            ...(maxTokens ? { max_tokens: maxTokens } : {}),
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new LLMError(`Falha de rede ao chamar o LLM: ${error instanceof Error ? error.message : error}`);
      }

      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        throw new LLMError(
          `LLM respondeu ${res.status}${detail ? `: ${detail}` : ''}`,
          res.status,
          parseRetryAfter(res.headers.get('retry-after'))
        );
      }

      const data = (await res.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      } | null;
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new LLMError('Resposta vazia do modelo.');

      // `usage` é opcional na prática (provedores compatíveis variam); quando falta, o orquestrador estima.
      const u = data?.usage;
      return {
        text: content,
        usage: u
          ? {
              promptTokens: u.prompt_tokens,
              completionTokens: u.completion_tokens,
              totalTokens: u.total_tokens,
            }
          : undefined,
      };
    },
    withModel(nextModel) {
      return createOpenAICompatible(env, nextModel);
    },
  };
}

/* ───────────────────────── Z.ai (SDK) ───────────────────────── */

function createZai(): LLM {
  let clientPromise: Promise<{
    chat: {
      completions: {
        create: (args: unknown) => Promise<{
          choices: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        }>;
      };
    };
  }> | null = null;

  const getClient = () => {
    clientPromise ??= import('z-ai-web-dev-sdk').then(
      (mod) => mod.default.create() as unknown as NonNullable<typeof clientPromise>
    );
    return clientPromise;
  };

  return {
    provider: 'zai',
    model: 'z-ai',
    async complete({ system, user }) {
      const zai = await getClient();
      // O SDK da Z.ai usa a role 'assistant' como prompt de sistema.
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      });
      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) throw new LLMError('Resposta vazia do modelo.');
      return {
        text: content,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}

/* ───────────────────────── Mock ───────────────────────── */

function createMock(env: NodeJS.ProcessEnv): LLM {
  const failing = new Set((env.MOCK_FAIL_LABELS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const delay = Number(env.MOCK_DELAY_MS ?? 250);
  // Multiplicador do tamanho do texto gerado. Serve para demonstrar e testar o orçamento de contexto
  // sem depender de um provedor real: MOCK_TEXT_REPEAT=300 simula um dossiê enorme.
  const repeat = Math.max(1, Math.min(1_000, Math.floor(Number(env.MOCK_TEXT_REPEAT ?? 1) || 1)));
  const grow = (text: string) => (repeat === 1 ? text : Array.from({ length: repeat }, () => text).join('\n\n'));

  return {
    provider: 'mock',
    model: 'mock',
    async complete({ label, user, signal }) {
      await sleep(delay + Math.random() * delay);
      if (signal?.aborted) throw new Error('abortado');
      if (failing.has(label)) throw new LLMError(`Falha simulada em ${label}.`, 500);
      const work = /Obra[^:]*:\s*"([^"]+)"/.exec(user)?.[1] ?? 'a obra';

      if (label === 'pesquisador') {
        const text = [
          '**Identificação:** obra fictícia para demonstração (confiança: alta)',
          '',
          '## Ficha da obra',
          `- **Título:** ${work}`,
          '- **Tipo:** demonstração',
          '',
          '## Sinopse',
          'Texto de demonstração gerado pelo provedor *mock*. Configure um LLM real para obter o dossiê verdadeiro. [F1]',
          '',
          '## Lacunas e confiança',
          '- Todo o conteúdo é fictício.',
        ].join('\n');
        const grown = grow(text);
        return { text: grown, usage: estimateMockUsage(user, grown) };
      }
      const text = [
        `### Análise de demonstração (${label})`,
        '',
        `Este texto é gerado pelo provedor **mock** para ilustrar o relatório de *${work}*. Ele não contém análise real.`,
        '',
        '| Conceito | Aplicação |',
        '| --- | --- |',
        '| Exemplo A | Texto fictício |',
        '| Exemplo B | Texto fictício |',
        '',
        '### Limites e verificações',
        '- Conteúdo fictício; confiança: nenhuma.',
      ].join('\n');
      const grown = grow(text);
      return { text: grown, usage: estimateMockUsage(user, grown) };
    },
  };
}

/**
 * O mock simula o formato de `usage` para que o caminho de contabilização seja exercitado nos testes.
 * A marca `estimated` é honesta: não são tokens reais de um tokenizador.
 */
function estimateMockUsage(prompt: string, completion: string): LLMUsage {
  const promptTokens = Math.ceil((prompt.length + 400) / 4);
  const completionTokens = Math.ceil(completion.length / 4);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

/* ───────────────────────── Fábrica ───────────────────────── */

export function createLLM(env: NodeJS.ProcessEnv = process.env): LLM {
  const provider = resolveProvider(env);
  if (provider === 'openai') return createOpenAICompatible(env);
  if (provider === 'mock') return createMock(env);
  return createZai();
}
