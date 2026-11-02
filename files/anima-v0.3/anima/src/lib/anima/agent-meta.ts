// ANIMA — metadados do painel de especialistas (seguro para import no cliente).
// Os textos teóricos completos (que o LLM recebe) ficam em prompts.ts; aqui estão os resumos exibidos na interface.

import {
  BookOpenText,
  Brain,
  Drama,
  Feather,
  Landmark,
  Lightbulb,
  Network,
  Scale,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { AgentKey } from './types';

export interface AgentColor {
  text: string;
  bg: string;
  border: string;
  gradient: string;
}

export interface AgentMeta {
  key: AgentKey;
  /** Nome curto para navegação e chips */
  short: string;
  name: string;
  role: string;
  tagline: string;
  /** Perguntas que este analista responde (exibidas em "Método") */
  questions: string[];
  /** Referenciais teóricos centrais */
  frameworks: string[];
  icon: LucideIcon;
  color: AgentColor;
}

export const AGENTS: AgentMeta[] = [
  {
    key: 'structural',
    short: 'Estrutura',
    name: 'Agente Estrutural',
    role: 'O Arquiteto da Trama',
    tagline: 'Mapeia a arquitetura do enredo: atos, eventos nucleares, causalidade, pontos de virada e economia.',
    questions: ['Como a trama está construída?', 'Quais eventos são decisivos?', 'Qual modelo estrutural descreve melhor a obra?'],
    frameworks: ['Aristóteles', 'Freytag', 'Propp', 'Todorov', 'Barthes/Chatman (núcleos e satélites)', 'Campbell/Vogler', 'McKee', 'Bordwell'],
    icon: Network,
    color: {
      text: 'text-amber-700 dark:text-amber-400',
      bg: 'bg-amber-100 dark:bg-amber-950/50',
      border: 'border-amber-300 dark:border-amber-800',
      gradient: 'from-amber-500 to-orange-500',
    },
  },
  {
    key: 'narratology',
    short: 'Discurso',
    name: 'Agente Narratológico',
    role: 'O Teórico do Discurso',
    tagline: 'Analisa como a história é contada: voz, focalização, ordem, duração, frequência, confiabilidade.',
    questions: ['Quem narra e de onde?', 'O que a obra revela, adia ou oculta?', 'Como o tempo do discurso se separa do tempo da história?'],
    frameworks: ['Genette', 'Booth', 'Chatman', 'Bal', 'Bakhtin', 'Cohn', 'Sternberg', 'Jost (cinema)'],
    icon: Waypoints,
    color: {
      text: 'text-sky-700 dark:text-sky-400',
      bg: 'bg-sky-100 dark:bg-sky-950/50',
      border: 'border-sky-300 dark:border-sky-800',
      gradient: 'from-sky-500 to-blue-500',
    },
  },
  {
    key: 'characters',
    short: 'Personagens',
    name: 'Agente de Personagens',
    role: 'O Dramaturgo',
    tagline: 'Estuda funções, desejos, arcos de transformação e o sistema de relações entre personagens.',
    questions: ['O que cada personagem quer e precisa?', 'Quem muda e por quê?', 'Que função dramática cada um cumpre?'],
    frameworks: ['Forster', 'Phelan', 'Hamon', 'Greimas (actantes)', 'Propp', 'Egri', 'McKee', 'Murray Smith'],
    icon: Drama,
    color: {
      text: 'text-rose-700 dark:text-rose-400',
      bg: 'bg-rose-100 dark:bg-rose-950/50',
      border: 'border-rose-300 dark:border-rose-800',
      gradient: 'from-rose-500 to-pink-500',
    },
  },
  {
    key: 'thematic',
    short: 'Temas',
    name: 'Agente Temático',
    role: 'O Filósofo',
    tagline: 'Formula a ideia da obra: temas, motivos, símbolos, oposições estruturantes e subtexto.',
    questions: ['Qual é a ideia controladora?', 'Onde a obra diz uma coisa e mostra outra?', 'Que tradição filosófica ilumina a obra?'],
    frameworks: ['Aristóteles', 'Frye', 'Greimas (quadrado semiótico)', 'Lévi-Strauss', 'Ricoeur', 'Nussbaum', 'Macherey', 'McKee'],
    icon: Lightbulb,
    color: {
      text: 'text-emerald-700 dark:text-emerald-400',
      bg: 'bg-emerald-100 dark:bg-emerald-950/50',
      border: 'border-emerald-300 dark:border-emerald-800',
      gradient: 'from-emerald-500 to-teal-500',
    },
  },
  {
    key: 'stylistic',
    short: 'Estilo',
    name: 'Agente Estilístico',
    role: 'O Crítico da Forma',
    tagline: 'Lê a linguagem — verbal, visual ou sonora: dominante estilístico, figuras, ritmo, registro e gênero.',
    questions: ['Qual escolha formal organiza as demais?', 'Que efeito produz cada recurso?', 'Que convenções de gênero a obra cumpre ou subverte?'],
    frameworks: ['Jakobson', 'Shklovsky', 'Bakhtin', 'Spitzer', 'Auerbach', 'Leech & Short', 'Altman', 'Bordwell & Thompson'],
    icon: Feather,
    color: {
      text: 'text-violet-700 dark:text-violet-400',
      bg: 'bg-violet-100 dark:bg-violet-950/50',
      border: 'border-violet-300 dark:border-violet-800',
      gradient: 'from-violet-500 to-purple-500',
    },
  },
  {
    key: 'psychological',
    short: 'Psique',
    name: 'Agente Psicológico',
    role: 'O Psicanalista',
    tagline: 'Lê desejos, conflitos, símbolos e o efeito sobre o espectador com psicanálise e ciência cognitiva.',
    questions: ['Que desejos e defesas movem a trama?', 'O que cada lente psicanalítica ilumina — e distorce?', 'Como a obra regula empatia e identificação?'],
    frameworks: ['Freud', 'Jung', 'Lacan', 'Klein', 'Winnicott', 'Kristeva', 'Brooks', 'Zunshine (cognitivismo)'],
    icon: Brain,
    color: {
      text: 'text-fuchsia-700 dark:text-fuchsia-400',
      bg: 'bg-fuchsia-100 dark:bg-fuchsia-950/50',
      border: 'border-fuchsia-300 dark:border-fuchsia-800',
      gradient: 'from-fuchsia-500 to-pink-500',
    },
  },
  {
    key: 'cultural',
    short: 'Contexto',
    name: 'Agente Cultural',
    role: 'O Historiador da Cultura',
    tagline: 'Situa a obra: produção, campo cultural, recepção, intertextualidade, adaptações e legado.',
    questions: ['Em que condições a obra nasceu?', 'Como foi lida na época e como é lida hoje?', 'Com que obras ela dialoga?'],
    frameworks: ['Williams', 'Bourdieu', 'Jauss', 'Iser', 'Genette (transtextualidade)', 'Hutcheon', 'Candido', 'Schwarz'],
    icon: Landmark,
    color: {
      text: 'text-teal-700 dark:text-teal-400',
      bg: 'bg-teal-100 dark:bg-teal-950/50',
      border: 'border-teal-300 dark:border-teal-800',
      gradient: 'from-teal-500 to-cyan-600',
    },
  },
  {
    key: 'critical',
    short: 'Crítica',
    name: 'Agente Crítico',
    role: 'O Teórico Crítico',
    tagline: 'Aplica teorias críticas — marxista, feminista, pós-colonial, queer, ecocrítica — com seus limites.',
    questions: ['Quem tem voz e quem é silenciado?', 'Que relações de poder a obra naturaliza ou questiona?', 'Onde a ideologia da forma contradiz a do enredo?'],
    frameworks: ['Jameson', 'Mulvey', 'Butler', 'Said', 'Bhabha', 'Spivak', 'Foucault', 'Schwarz'],
    icon: Scale,
    color: {
      text: 'text-indigo-700 dark:text-indigo-400',
      bg: 'bg-indigo-100 dark:bg-indigo-950/50',
      border: 'border-indigo-300 dark:border-indigo-800',
      gradient: 'from-indigo-500 to-blue-600',
    },
  },
];

export function getAgent(key: AgentKey): AgentMeta {
  return AGENTS.find((a) => a.key === key) ?? AGENTS[0];
}

/** Agentes que não são especialistas de painel: pesquisador e curador (síntese). */
export const RESEARCHER_META = {
  name: 'Agente Pesquisador',
  role: 'O Arquivista',
  tagline: 'Busca fontes (Wikipédia, web) e compila o dossiê factual que ancora todas as análises.',
  icon: BookOpenText,
  color: {
    text: 'text-stone-700 dark:text-stone-300',
    bg: 'bg-stone-100 dark:bg-stone-900/60',
    border: 'border-stone-300 dark:border-stone-700',
    gradient: 'from-stone-500 to-stone-600',
  } satisfies AgentColor,
};

export const CURATOR_META = {
  name: 'Curador',
  role: 'A Síntese Integrada',
  tagline: 'Lê as oito análises, confronta convergências e tensões e propõe uma tese de leitura.',
  icon: Sparkles,
  color: {
    text: 'text-primary',
    bg: 'bg-primary/10',
    border: 'border-primary/30',
    gradient: 'from-amber-500 to-orange-600',
  } satisfies AgentColor,
};
