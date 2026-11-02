// ANIMA — sugestões de perguntas de acompanhamento (seguro para import no cliente).
//
// Separado de `follow-up.ts` de propósito: aquele módulo conversa com o LLM e carrega coisas de servidor.
// Este só olha o que a análise tem e devolve perguntas curtas — nenhum acesso a rede, nenhum pacote pesado.

import { AGENTS } from './agent-meta';
import type { AnalysisDTO } from './types';

/**
 * Sugestões de acompanhamento: derivadas do que **esta** análise tem, não de um menu genérico.
 * São perguntas que o material consegue responder — sugerir o que ele não cobre só gera frustração.
 */
export function suggestedQuestions(analysis: AnalysisDTO): string[] {
  const done = AGENTS.filter((agent) => {
    const result = analysis.results.find((r) => r.agentKey === agent.key);
    return result?.status === 'done' && result.content;
  });
  const has = (key: string) => done.some((agent) => agent.key === key);
  const questions: string[] = [];

  if (analysis.focus) {
    questions.push(`O recorte “${analysis.focus}” aparece em quais lentes, e o que muda se eu tirar o recorte?`);
  }
  if (has('critical')) {
    questions.push('Qual é a objeção mais forte à leitura que o relatório defende?');
  }
  if (has('characters')) {
    questions.push('Qual personagem o relatório trata de forma mais frágil, e o que falta para sustentar essa leitura?');
  }
  if (has('structural') || has('narratology')) {
    questions.push('Que passagem do texto sustentaria melhor a tese central? Onde eu deveria reler?');
  }
  questions.push('O que ficou de fora deste dossiê e mudaria a conclusão se entrasse?');
  questions.push('Por onde eu começo se quiser estudar esta obra a fundo?');

  return questions.slice(0, 4);
}
