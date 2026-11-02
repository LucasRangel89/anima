// ANIMA — exportação do relatório em Markdown (função pura, testável).

import { AGENTS, CURATOR_META } from './agent-meta';
import { formatDate } from './format';
import { DEPTH_LABELS, SOURCE_KIND_LABELS, WORK_KIND_LABELS, type AnalysisDTO } from './types';

export function buildReportMarkdown(a: AnalysisDTO): string {
  const lenses = a.results.filter((r) => r.status !== 'skipped').length;
  const meta = [
    WORK_KIND_LABELS[a.kind],
    `profundidade ${DEPTH_LABELS[a.depth].label.toLowerCase()}`,
    `${lenses} lente(s)`,
    a.model && a.model !== 'mock' ? `modelo ${a.model}` : null,
    formatDate(a.createdAt),
  ].filter(Boolean);

  const parts: string[] = [
    `# Relatório ANIMA — ${a.title}`,
    '',
    `> ${meta.join(' · ')}`,
    ...(a.focus ? [`> **Recorte:** ${a.focus}`] : []),
    '> Conteúdo gerado por IA: confira fatos e referências marcados com † antes de citar.',
    '',
  ];

  if (a.synthesis) parts.push(`## ${CURATOR_META.role}`, '', a.synthesis, '');
  parts.push('## Dossiê de pesquisa', '', a.research ?? '_(dossiê indisponível)_', '');

  if (a.sources.length > 0) {
    parts.push(
      '### Fontes consultadas',
      '',
      ...a.sources.map((s) => {
        const details = [
          s.kind ? SOURCE_KIND_LABELS[s.kind] : null,
          s.author,
          s.year ? String(s.year) : null,
          s.reliability ? `confiabilidade ${s.reliability}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return `- [${s.id}] [${s.title}](${s.url})${details ? ` — ${details}` : ''}`;
      }),
      ''
    );
  }

  if (a.usage && a.usage.calls > 0) {
    const u = a.usage;
    parts.push(
      '---',
      '',
      '## Recursos desta análise',
      '',
      `- **Chamadas ao modelo:** ${u.calls}`,
      `- **Tokens:** ${u.totalTokens.toLocaleString('pt-BR')} (${u.promptTokens.toLocaleString('pt-BR')} de entrada, ${u.completionTokens.toLocaleString('pt-BR')} de saída)${u.estimated ? ' — números estimados: o provedor não informou `usage`' : ''}`,
      `- **Contexto configurado:** ${u.contextLimit.toLocaleString('pt-BR')} tokens`,
      ...(u.notices.length ? ['', '**Avisos de contexto**', '', ...u.notices.map((n) => `- ${n}`)] : []),
      ''
    );
  }

  for (const agent of AGENTS) {
    const r = a.results.find((x) => x.agentKey === agent.key);
    parts.push('---', '', `## ${agent.name} — ${agent.role}`, '');
    parts.push(r?.status === 'done' && r.content ? r.content : '_(esta análise não está disponível)_', '');
  }
  return parts.join('\n');
}
