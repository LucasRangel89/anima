// ANIMA — orçamento de contexto.
//
// Por que existe: uma análise "exaustiva" com 8 lentes manda o dossiê inteiro para cada especialista e,
// na síntese, manda o dossiê *mais* as 8 análises. Num provedor gratuito (contexto menor, TPM baixo),
// isso vira 400/413/429 no meio do trabalho — depois de já ter gasto as chamadas anteriores.
//
// Estratégia (determinística, sem chamada extra ao modelo):
//   1. estimamos tokens de forma CONSERVADORA (mais tokens do que o real, nunca menos);
//   2. reservamos espaço para a saída (`max_tokens` da etapa);
//   3. se não couber, primeiro condensamos mantendo o que importa (títulos, listas, primeira frase de
//      cada parágrafo); se ainda não couber, cortamos cabeça e cauda com marcador explícito;
//   4. tudo o que foi mexido é registrado em avisos que aparecem na interface e no relatório.
//
// Avisar é parte do contrato: o usuário precisa saber que o modelo recebeu menos contexto do que o
// dossiê reunido, para não ler o silêncio do texto como ausência de evidência.

/** Estimativa conservadora de tokens. Português costuma ficar entre 3 e 4 caracteres por token. */
const CHARS_PER_TOKEN = 3;

/** Tokens por mensagem (papéis, delimitadores) — pequeno, mas contamos. */
const MESSAGE_OVERHEAD = 8;

/** Contexto assumido quando `LLM_CONTEXT_TOKENS` não está definido. Conservador de propósito: 32k. */
export const DEFAULT_CONTEXT_TOKENS = 32_768;

/** Piso: abaixo disso a análise não teria sentido; recusamos valores absurdos de configuração. */
export const MIN_CONTEXT_TOKENS = 4_096;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN) + MESSAGE_OVERHEAD;
}

export function contextLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LLM_CONTEXT_TOKENS);
  return Number.isFinite(raw) && raw >= MIN_CONTEXT_TOKENS ? Math.floor(raw) : DEFAULT_CONTEXT_TOKENS;
}

export type ShrinkMethod = 'nenhum' | 'condensado' | 'cortado';

export interface ShrunkText {
  text: string;
  method: ShrinkMethod;
  before: number;
  after: number;
  /** Estimativa de tokens aproveitados (inclui o marcador, se houver). */
  tokens: number;
}

/**
 * Condensação determinística: mantém títulos, listas, citações e a primeira frase de cada parágrafo.
 * É o suficiente para preservar a "espinha" factual de um dossiê (ficha, datas, nomes) sem inventar nada.
 */
export function condense(text: string): string {
  const kept: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // Linhas estruturais passam inteiras.
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || /^([-*+]|\d+\.)\s/.test(trimmed) || trimmed.startsWith('>')) {
      kept.push(line);
      continue;
    }

    // Parágrafos: primeira frase (até ~240 caracteres), que carrega a afirmação principal.
    const firstSentence = /^(.{20,240}?[.!?])(\s|$)/.exec(trimmed);
    kept.push(firstSentence ? firstSentence[1] : trimmed.slice(0, 240));
  }
  return kept.join('\n');
}

/** Corte cabeça/cauda: preserva o começo (identificação/ficha) e o fim (limites, lacunas). */
function cut(text: string, maxChars: number): string {
  const marker = '\n\n[… trecho omitido por limite de contexto …]\n\n';
  if (text.length <= maxChars) return text;
  const room = Math.max(0, maxChars - marker.length);
  const head = Math.floor(room * 0.7);
  const tail = room - head;
  return `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(text.length - tail) : ''}`;
}

/**
 * Reduz `text` até caber em `maxTokens`.
 *
 * Ordem: nada → condensar → cortar. Cada passo é determinístico: o mesmo dossiê gera sempre o mesmo
 * resultado, o que mantém a análise reproduzível (e testável).
 */
export function shrink(text: string, maxTokens: number): ShrunkText {
  const before = estimateTokens(text);
  if (before <= maxTokens) {
    return { text, method: 'nenhum', before, after: before, tokens: before };
  }

  // Descontar o overhead da mensagem, senão o resultado final fica alguns tokens acima do limite.
  const maxChars = Math.max(400, Math.floor((maxTokens - MESSAGE_OVERHEAD) * CHARS_PER_TOKEN));

  const condensed = condense(text);
  const condensedTokens = estimateTokens(condensed);
  if (condensedTokens <= maxTokens) {
    return { text: condensed, method: 'condensado', before, after: condensedTokens, tokens: condensedTokens };
  }

  const truncated = cut(condensed, maxChars);
  const after = estimateTokens(truncated);
  return { text: truncated, method: 'cortado', before, after, tokens: after };
}

/**
 * Divisão justa de um orçamento entre partes que precisam caber juntas.
 * Se tudo cabe, devolve os textos como estão; se não, reduz proporcionalmente as partes que sobraram.
 */
export function fitTogether(
  parts: Array<{ key: string; text: string }>,
  maxTokens: number
): { parts: Array<{ key: string; text: string; shrink: ShrunkText }>; ok: boolean } {
  const total = parts.reduce((sum, p) => sum + estimateTokens(p.text), 0);
  if (total <= maxTokens) {
    return {
      parts: parts.map((p) => ({
        key: p.key,
        text: p.text,
        shrink: { text: p.text, method: 'nenhum', before: estimateTokens(p.text), after: estimateTokens(p.text), tokens: estimateTokens(p.text) },
      })),
      ok: true,
    };
  }

  // Reserva mínima por parte para que nenhuma vire uma linha inútil (o modelo ainda vê que existe).
  const floor = Math.max(48, Math.floor(maxTokens / parts.length / 4));
  const budgetPerPart = Math.floor(maxTokens / Math.max(1, parts.length));

  const result = parts.map((p) => {
    const tokens = estimateTokens(p.text);
    if (tokens <= budgetPerPart) {
      return { key: p.key, text: p.text, shrink: { text: p.text, method: 'nenhum' as ShrinkMethod, before: tokens, after: tokens, tokens } };
    }
    const reduced: ShrunkText = shrink(p.text, Math.max(floor, budgetPerPart));
    return { key: p.key, text: reduced.text, shrink: reduced };
  });

  return { parts: result, ok: false };
}

/* ───────────────────────── Registro de uso ───────────────────────── */

export interface StageUsage {
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export interface AnalysisUsage {
  /** Total de chamadas efetivamente feitas ao provedor. */
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** `true` quando o provedor não devolveu `usage` e os números são estimativa por caracteres. */
  estimated: boolean;
  /** Detalhe por etapa (pesquisador, especialista:x, sintese). */
  byStage: Record<string, StageUsage>;
  /** Limite de contexto usado nesta análise. */
  contextLimit: number;
  /** Avisos legíveis sobre contexto reduzido, modelo alternativo, etc. */
  notices: string[];
}

export function emptyUsage(contextLimitTokens: number): AnalysisUsage {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimated: false,
    byStage: {},
    contextLimit: contextLimitTokens,
    notices: [],
  };
}

/** Acumula uma chamada. Mutações acontecem em um único lugar para o registro ficar consistente. */
export function recordCall(
  usage: AnalysisUsage,
  stage: string,
  tokens: { prompt?: number; completion?: number; estimated?: boolean }
): void {
  const prompt = Math.max(0, Math.round(tokens.prompt ?? 0));
  const completion = Math.max(0, Math.round(tokens.completion ?? 0));

  usage.calls += 1;
  usage.promptTokens += prompt;
  usage.completionTokens += completion;
  usage.totalTokens = usage.promptTokens + usage.completionTokens;
  if (tokens.estimated) usage.estimated = true;

  const entry = (usage.byStage[stage] ??= { calls: 0, promptTokens: 0, completionTokens: 0 });
  entry.calls += 1;
  entry.promptTokens += prompt;
  entry.completionTokens += completion;
}

/** Acrescenta um aviso uma única vez (o mesmo corte pode acontecer em várias lentes). */
export function addNotice(usage: AnalysisUsage, notice: string): void {
  if (!usage.notices.includes(notice)) usage.notices.push(notice);
}

export function describeShrink(label: string, shrink: ShrunkText): string | null {
  if (shrink.method === 'nenhum') return null;
  const action = shrink.method === 'condensado' ? 'condensado' : 'cortado';
  return `${label} ${action}: ~${shrink.before.toLocaleString('pt-BR')} → ~${shrink.after.toLocaleString('pt-BR')} tokens.`;
}

export function describeUsage(usage: AnalysisUsage): string {
  const calls = `${usage.calls} chamada(s)`;
  const tokens = `${usage.totalTokens.toLocaleString('pt-BR')} tokens${usage.estimated ? ' (estimados)' : ''}`;
  return `${calls} · ${tokens}`;
}
