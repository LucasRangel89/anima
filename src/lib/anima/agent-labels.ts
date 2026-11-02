// ANIMA — rótulos das oito lentes, sem React.
//
// Existe porque a oficina estática (`oficina.html`) monta prompts no navegador e não pode arrastar
// React/lucide para um bundle de página pública. `agent-meta.ts` continua sendo a fonte para a interface;
// `tests/oficina.test.ts` compara os dois e falha se um rótulo divergir.

import type { AgentKey } from './types';

export interface AgentLabel {
  key: AgentKey;
  short: string;
  name: string;
  role: string;
  tagline: string;
  questions: string[];
}

export const AGENT_LABELS: Record<AgentKey, AgentLabel> = {
  structural: {
    key: 'structural',
    short: 'Estrutura',
    name: 'Agente Estrutural',
    role: 'O Arquiteto da Trama',
    tagline: 'Mapeia a arquitetura do enredo: atos, eventos nucleares, causalidade, pontos de virada e economia.',
    questions: [
      'Como a trama está construída?',
      'Quais eventos são decisivos?',
      'Qual modelo estrutural descreve melhor a obra?',
    ],
  },
  narratology: {
    key: 'narratology',
    short: 'Discurso',
    name: 'Agente Narratológico',
    role: 'O Teórico do Discurso',
    tagline: 'Analisa como a história é contada: voz, focalização, ordem, duração, frequência, confiabilidade.',
    questions: [
      'Quem narra e de onde?',
      'O que a obra revela, adia ou oculta?',
      'Como o tempo do discurso se separa do tempo da história?',
    ],
  },
  characters: {
    key: 'characters',
    short: 'Personagens',
    name: 'Agente de Personagens',
    role: 'O Dramaturgo',
    tagline: 'Estuda funções, desejos, arcos de transformação e o sistema de relações entre personagens.',
    questions: [
      'O que cada personagem quer e precisa?',
      'Quem muda e por quê?',
      'Que função dramática cada um cumpre?',
    ],
  },
  thematic: {
    key: 'thematic',
    short: 'Temas',
    name: 'Agente Temático',
    role: 'O Filósofo',
    tagline: 'Formula a ideia da obra: temas, motivos, símbolos, oposições estruturantes e subtexto.',
    questions: [
      'Qual é a ideia controladora?',
      'Onde a obra diz uma coisa e mostra outra?',
      'Que tradição filosófica ilumina a obra?',
    ],
  },
  stylistic: {
    key: 'stylistic',
    short: 'Estilo',
    name: 'Agente Estilístico',
    role: 'O Crítico da Forma',
    tagline: 'Lê a linguagem — verbal, visual ou sonora: dominante estilístico, figuras, ritmo, registro e gênero.',
    questions: [
      'Qual escolha formal organiza as demais?',
      'Que efeito produz cada recurso?',
      'Que convenções de gênero a obra cumpre ou subverte?',
    ],
  },
  psychological: {
    key: 'psychological',
    short: 'Psique',
    name: 'Agente Psicológico',
    role: 'O Psicanalista',
    tagline: 'Lê desejos, conflitos, símbolos e o efeito sobre o espectador com psicanálise e ciência cognitiva.',
    questions: [
      'Que desejos e defesas movem a trama?',
      'O que cada lente psicanalítica ilumina — e distorce?',
      'Como a obra regula empatia e identificação?',
    ],
  },
  cultural: {
    key: 'cultural',
    short: 'Contexto',
    name: 'Agente Cultural',
    role: 'O Historiador da Cultura',
    tagline: 'Situa a obra: produção, campo cultural, recepção, intertextualidade, adaptações e legado.',
    questions: [
      'Em que condições a obra nasceu?',
      'Como foi lida na época e como é lida hoje?',
      'Com que obras ela dialoga?',
    ],
  },
  critical: {
    key: 'critical',
    short: 'Crítica',
    name: 'Agente Crítico',
    role: 'O Teórico Crítico',
    tagline: 'Aplica teorias críticas — marxista, feminista, pós-colonial, queer, ecocrítica — com seus limites.',
    questions: [
      'Quem tem voz e quem é silenciado?',
      'Que relações de poder a obra naturaliza ou questiona?',
      'Onde a ideologia da forma contradiz a do enredo?',
    ],
  },
};

export const AGENT_LABEL_LIST: AgentLabel[] = Object.values(AGENT_LABELS);
