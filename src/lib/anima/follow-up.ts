// ANIMA — perguntas de acompanhamento.
//
// A ideia é simples e barata: o material caro (dossiê + oito lentes) já está pago. Uma pergunta de
// acompanhamento é respondida por **uma** chamada ao modelo, usando esse material como contexto — sem nova
// pesquisa, sem nova rodada de lentes. O que o material não cobre, a resposta deve dizer, não inventar.

import { fitTogether, contextLimit, estimateTokens, shrink } from './budget';
import type { LLM, LLMUsage } from './llm';
import { callWithRetry } from './llm-call';
import { AGENTS } from './agent-meta';

export { suggestedQuestions } from './follow-up-suggestions';
import { WORK_KIND_LABELS, type AnalysisDTO, type FollowUpDTO } from './types';

export const MAX_QUESTION_CHARS = 500;
export const MAX_FOLLOW_UPS = 30;
/** Uma resposta longa vira palestra; 900 tokens já permitem um argumento com exemplo. */
const MAX_ANSWER_TOKENS = 900;

export interface FollowUpRequest {
  analysis: AnalysisDTO;
  question: string;
  llm: LLM;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface FollowUpResult {
  answer: string;
  model: string;
  durationMs: number;
  usage?: LLMUsage;
  /** `true` quando o contexto precisou ser reduzido para caber. */
  contextTrimmed: boolean;
}

const SYSTEM_PROMPT = `# Papel

Você é o interlocutor do ANIMA: um estudioso que já leu o dossiê e as análises abaixo e agora responde a uma
pergunta do leitor sobre **esta** obra.

# Regras

1. Responda em português do Brasil, direto, em 3 a 6 parágrafos curtos. Sem refazer o relatório inteiro.
2. Parta do material fornecido. Quando afirmar algo que **não** está nele, marque com † no fim da frase e diga,
   na mesma frase, que é conhecimento geral seu.
3. Não invente títulos, autores, datas, números de página, falas ou citações literais. Se não tiver certeza, diga
   que não tem — e como o leitor pode verificar.
4. Quando a pergunta pedir algo que o dossiê não cobre (ex.: um capítulo que não foi analisado), diga o que falta
   e qual recorte resolveria, em vez de improvisar.
5. Se a pergunta fugir da obra, responda em uma frase e traga a conversa de volta.
6. Cite a lente ou a fonte quando a afirmação vier delas: (Estrutura), (Dossiê), [F2].
7. Não use abertura protocolar ("Ótima pergunta", "Claro!") nem encerramento vazio.`;

/** Bloco de contexto: dossiê + análises concluídas, já reduzidos para caber no contexto configurado. */
export function buildFollowUpContext(analysis: AnalysisDTO, maxTokens: number): { context: string; trimmed: boolean } {
  const done = AGENTS.map((agent) => {
    const result = analysis.results.find((r) => r.agentKey === agent.key);
    return result?.status === 'done' && result.content ? { agent, content: result.content } : null;
  }).filter((item): item is { agent: (typeof AGENTS)[number]; content: string } => item !== null);

  const analyses = done.map(({ agent, content }) => `<analise lente="${agent.short}">\n${content}\n</analise>`).join('\n\n');

  const parts = [
    { key: 'dossie', text: analysis.research ?? '(dossiê indisponível)' },
    { key: 'analises', text: analyses || '(nenhuma lente concluída)' },
  ];

  const fitted = fitTogether(parts, maxTokens);
  const blocks = fitted.parts.map((part) => `<${part.key}>\n${part.text}\n</${part.key}>`).join('\n\n');
  const trimmed = fitted.parts.some((part) => part.shrink.method !== 'nenhum');
  return { context: blocks, trimmed };
}

export function buildFollowUpMessages(analysis: AnalysisDTO, question: string, context: string): { system: string; user: string } {
  const meta = [WORK_KIND_LABELS[analysis.kind], analysis.model && analysis.model !== 'mock' ? `modelo ${analysis.model}` : null]
    .filter(Boolean)
    .join(' · ');

  const user = [
    `Obra analisada: **${analysis.title}**${analysis.hint ? ` (${analysis.hint})` : ''}`,
    meta ? `(${meta})` : '',
    analysis.focus ? `Recorte desta análise: ${analysis.focus}` : '',
    '',
    context,
    '',
    '<pergunta>',
    question,
    '</pergunta>',
    '',
    'Responda agora, seguindo as regras.',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');

  return { system: SYSTEM_PROMPT, user };
}

/** Resposta de acompanhamento: uma chamada, com retry e fallback de modelo em 429 — como no pipeline. */
export async function answerFollowUp({
  analysis,
  question,
  llm,
  signal,
  timeoutMs = 120_000,
  env = process.env,
}: FollowUpRequest): Promise<FollowUpResult> {
  const started = Date.now();
  const limit = contextLimit(env);
  // Reserva: resposta + margem para o enunciado da pergunta e as instruções.
  const contextBudget = Math.max(1_500, limit - MAX_ANSWER_TOKENS - 1_200);
  const { context, trimmed } = buildFollowUpContext(analysis, contextBudget);
  const { system } = buildFollowUpMessages(analysis, question, context);
  let { user } = buildFollowUpMessages(analysis, question, context);

  // Rede de segurança: se ainda passar do contexto, reduz o enunciado todo (nunca deixa de responder).
  const total = estimateTokens(system) + estimateTokens(user) + MAX_ANSWER_TOKENS;
  if (total > limit) {
    const shrunk = shrink(user, Math.max(800, limit - estimateTokens(system) - MAX_ANSWER_TOKENS));
    user = shrunk.text;
  }

  const result = await callWithRetry(
    llm,
    { system, user, maxTokens: MAX_ANSWER_TOKENS, temperature: 0.5 },
    { timeoutMs, signal, env, label: 'pergunta' }
  );

  const answer = result.text.trim();
  if (!answer) throw new Error('O modelo devolveu uma resposta vazia.');

  return {
    answer,
    model: result.model,
    durationMs: Date.now() - started,
    usage: result.usage,
    contextTrimmed: trimmed,
  };
}

/** Monta o registro persistido. Ids curtos e estáveis: data + sufixo aleatório evitam colisão em lote. */
export function toFollowUpRecord(question: string, result: FollowUpResult, now = new Date()): FollowUpDTO {
  const random = Math.random().toString(36).slice(2, 8);
  return {
    id: `q_${now.getTime().toString(36)}_${random}`,
    question,
    answer: result.answer,
    model: result.model,
    createdAt: now.toISOString(),
    durationMs: Math.round(result.durationMs),
  };
}
