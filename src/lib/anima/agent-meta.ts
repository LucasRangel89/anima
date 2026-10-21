// ANIMA — metadados do painel de especialistas (seguro para import no cliente)
import {
  Network,
  Drama,
  Lightbulb,
  Feather,
  Brain,
  Landmark,
  type LucideIcon,
} from 'lucide-react';
import type { AgentKey } from './types';

export interface AgentMeta {
  key: AgentKey;
  name: string;
  role: string;
  tagline: string;
  icon: LucideIcon;
  /** classes tailwind para o tom de cor exclusivo do agente */
  color: {
    text: string;
    bg: string;
    border: string;
    dot: string;
    gradient: string;
  };
}

export const AGENTS: AgentMeta[] = [
  {
    key: 'structural',
    name: 'Agente Estrutural',
    role: 'O Arquiteto Narrativo',
    tagline: 'Mapeia o esqueleto da história: atos, arco narrativo, cronologia e pontos de virada.',
    icon: Network,
    color: {
      text: 'text-amber-700 dark:text-amber-400',
      bg: 'bg-amber-100 dark:bg-amber-950/50',
      border: 'border-amber-300 dark:border-amber-800',
      dot: 'bg-amber-500',
      gradient: 'from-amber-500 to-orange-500',
    },
  },
  {
    key: 'characters',
    name: 'Agente de Personagens',
    role: 'O Dramaturgo',
    tagline: 'Analisa papéis, profundidade, arcos de transformação e arquétipos (Jung, Campbell, Propp).',
    icon: Drama,
    color: {
      text: 'text-rose-700 dark:text-rose-400',
      bg: 'bg-rose-100 dark:bg-rose-950/50',
      border: 'border-rose-300 dark:border-rose-800',
      dot: 'bg-rose-500',
      gradient: 'from-rose-500 to-pink-500',
    },
  },
  {
    key: 'thematic',
    name: 'Agente Temático',
    role: 'O Filósofo',
    tagline: 'Destila conflitos centrais, temas, mensagens explícitas e subtexto da obra.',
    icon: Lightbulb,
    color: {
      text: 'text-emerald-700 dark:text-emerald-400',
      bg: 'bg-emerald-100 dark:bg-emerald-950/50',
      border: 'border-emerald-300 dark:border-emerald-800',
      dot: 'bg-emerald-500',
      gradient: 'from-emerald-500 to-teal-500',
    },
  },
  {
    key: 'stylistic',
    name: 'Agente Estilístico',
    role: 'O Crítico Literário',
    tagline: 'Avalia a arte da palavra: figuras de linguagem, tom, ritmo, voz narrativa e gênero.',
    icon: Feather,
    color: {
      text: 'text-violet-700 dark:text-violet-400',
      bg: 'bg-violet-100 dark:bg-violet-950/50',
      border: 'border-violet-300 dark:border-violet-800',
      dot: 'bg-violet-500',
      gradient: 'from-violet-500 to-purple-500',
    },
  },
  {
    key: 'psychological',
    name: 'Agente Psicológico',
    role: 'O Psicanalista',
    tagline: 'Lê as dinâmicas psíquicas da trama com Freud, Jung e Lacan: desejos, símbolos, inconsciente.',
    icon: Brain,
    color: {
      text: 'text-fuchsia-700 dark:text-fuchsia-400',
      bg: 'bg-fuchsia-100 dark:bg-fuchsia-950/50',
      border: 'border-fuchsia-300 dark:border-fuchsia-800',
      dot: 'bg-fuchsia-500',
      gradient: 'from-fuchsia-500 to-pink-500',
    },
  },
  {
    key: 'cultural',
    name: 'Agente Cultural & Contextual',
    role: 'O Historiador Social',
    tagline: 'Situa a obra em seu tempo: contexto histórico, diálogo cultural, tradição e legado.',
    icon: Landmark,
    color: {
      text: 'text-teal-700 dark:text-teal-400',
      bg: 'bg-teal-100 dark:bg-teal-950/50',
      border: 'border-teal-300 dark:border-teal-800',
      dot: 'bg-teal-500',
      gradient: 'from-teal-500 to-cyan-600',
    },
  },
];

export function getAgent(key: AgentKey): AgentMeta {
  return AGENTS.find((a) => a.key === key) ?? AGENTS[0];
}
