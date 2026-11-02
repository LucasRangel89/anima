// ANIMA — exportação do relatório em Markdown (função pura, testável).

import { AGENTS, CURATOR_META } from './agent-meta';
import { formatDate } from './format';
import { DEPTH_LABELS, WORK_KIND_LABELS, type AnalysisDTO } from './types';

export function buildReportMarkdown(a: AnalysisDTO): string {
  const meta = [
    WORK_KIND_LABELS[a.kind],
    `profundidade ${DEPTH_LABELS[a.depth].label.toLowerCase()}`,
    a.model && a.model !== 'mock' ? `modelo ${a.model}` : null,
    formatDate(a.createdAt),
  ].filter(Boolean);

  const parts: string[] = [
    `# Relatório ANIMA — ${a.title}`,
    '',
    `> ${meta.join(' · ')}`,
    '> Conteúdo gerado por IA: confira fatos e referências marcados com † antes de citar.',
    '',
  ];

  if (a.synthesis) parts.push(`## ${CURATOR_META.role}`, '', a.synthesis, '');
  parts.push('## Dossiê de pesquisa', '', a.research ?? '_(dossiê indisponível)_', '');

  if (a.sources.length > 0) {
    parts.push('### Fontes consultadas', '', ...a.sources.map((s) => `- [${s.id}] [${s.title}](${s.url})`), '');
  }

  for (const agent of AGENTS) {
    const r = a.results.find((x) => x.agentKey === agent.key);
    parts.push('---', '', `## ${agent.name} — ${agent.role}`, '');
    parts.push(r?.status === 'done' && r.content ? r.content : '_(esta análise não está disponível)_', '');
  }
  return parts.join('\n');
}
