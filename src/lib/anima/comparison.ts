// ANIMA — comparação entre duas obras já analisadas.
//
// Diferente do pipeline: nada de oito lentes para cada lado. Uma comparação é uma leitura cruzada, feita em
// **uma** chamada com o que já existe (dossiê + síntese de cada análise). O valor está em ver o que uma obra
// ilumina na outra — não em repetir os dois relatórios.

import { contextLimit, estimateTokens, fitTogether, shrink } from './budget';
import { callWithRetry } from './llm-call';
import type { LLM, LLMUsage } from './llm';
import type { AnalysisDTO, ComparisonDTO, WorkKind } from './types';
import { WORK_KIND_LABELS } from './types';
import type { ComparisonRow } from './store';

export const MAX_COMPARISON_TOKENS = 1_400;
const OVERHEAD_TOKENS = 900;

export interface ComparisonResult {
  content: string;
  model: string;
  durationMs: number;
  usage?: LLMUsage;
  trimmed: boolean;
}

const SYSTEM_PROMPT = `# Papel

Você é o curador do ANIMA numa leitura cruzada: duas obras já analisadas, duas fortuna críticas, uma pergunta
— o que uma faz a outra dizer?

# Regras

1. Português do Brasil. Entre 700 e 1.000 palavras, em Markdown, com estas seções e títulos exatos:
   "## O que aproxima", "## O que separa", "## O que uma ilumina na outra", "## Veredito".
2. Trabalhe **a partir dos dossiês e das sínteses fornecidos**. Fora deles, marque † e diga que é conhecimento
   geral seu.
3. Não invente títulos, datas, falas, números de página ou prêmios. Se faltar dado, diga que falta.
4. Compare estruturas, não impressões: narrador, tempo, espaço, conflito, voz, relação com o leitor.
5. Nada de "ambas são obras-primas". Diga o que cada uma faz que a outra não faz, e pague o preço de escolher.
6. No veredito, responda em uma frase: qual das duas leituras viaja melhor para um leitor que só vai ler uma —
   e por quê. Pode dizer que a pergunta não tem vencedor, desde que explique o critério.`;

/** Bloco de uma obra: dossiê + síntese, sem as oito lentes (o contexto tem de caber e o essencial está aqui). */
export function comparisonSide(analysis: AnalysisDTO, label: 'A' | 'B'): string {
  const meta = [
    WORK_KIND_LABELS[analysis.kind],
    analysis.hint,
    analysis.focus ? `recorte: ${analysis.focus}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return [
    `<obra lado="${label}" meio="${kindTag(analysis.kind)}">`,
    `# ${analysis.title}`,
    meta ? `_${meta}_` : '',
    '',
    '## Dossiê',
    analysis.research ?? '(dossiê indisponível)',
    '',
    '## Síntese',
    analysis.synthesis ?? '(síntese indisponível)',
    '</obra>',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');
}

const kindTag = (kind: WorkKind) => kind;

/** Contexto completo, reduzido de forma determinística para caber no orçamento. */
export function buildComparisonContext(left: AnalysisDTO, right: AnalysisDTO, maxTokens: number): { context: string; trimmed: boolean } {
  const parts = [
    { key: 'obra-a', text: comparisonSide(left, 'A') },
    { key: 'obra-b', text: comparisonSide(right, 'B') },
  ];
  const fitted = fitTogether(parts, maxTokens);
  return {
    context: fitted.parts.map((part) => part.text).join('\n\n'),
    trimmed: fitted.parts.some((part) => part.shrink.method !== 'nenhum'),
  };
}

export function buildComparisonMessages(left: AnalysisDTO, right: AnalysisDTO, context: string): { system: string; user: string } {
  return {
    system: SYSTEM_PROMPT,
    user: [
      'Compare as duas obras abaixo a partir dos materiais do ANIMA. Não repita os relatórios.',
      '',
      context,
      '',
      'Produza agora a comparação, com as quatro seções pedidas.',
    ].join('\n'),
  };
}

export async function compareAnalyses({
  left,
  right,
  llm,
  signal,
  timeoutMs = 180_000,
  env = process.env,
}: {
  left: AnalysisDTO;
  right: AnalysisDTO;
  llm: LLM;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<ComparisonResult> {
  const started = Date.now();
  const limit = contextLimit(env);
  const budget = Math.max(2_000, limit - MAX_COMPARISON_TOKENS - OVERHEAD_TOKENS);
  const { context, trimmed } = buildComparisonContext(left, right, budget);
  const { system, user } = buildComparisonMessages(left, right, context);

  // Rede de segurança: se ainda estourar, corta o enunciado (nunca deixa de comparar).
  let finalUser = user;
  if (estimateTokens(system) + estimateTokens(user) + MAX_COMPARISON_TOKENS > limit) {
    finalUser = shrink(user, Math.max(1_000, limit - estimateTokens(system) - MAX_COMPARISON_TOKENS)).text;
  }

  const result = await callWithRetry(
    llm,
    { system, user: finalUser, maxTokens: MAX_COMPARISON_TOKENS, temperature: 0.55 },
    { timeoutMs, signal, env, label: 'comparacao' }
  );

  const content = result.text.trim();
  if (!content) throw new Error('O modelo devolveu uma comparação vazia.');

  return { content, model: result.model, durationMs: Date.now() - started, usage: result.usage, trimmed };
}

export function toComparisonDTO(row: ComparisonRow): ComparisonDTO {
  return {
    id: row.id,
    status: row.status,
    left: { id: row.leftId, title: row.leftTitle },
    right: { id: row.rightId, title: row.rightTitle },
    content: row.content,
    error: row.error,
    model: row.model,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}
