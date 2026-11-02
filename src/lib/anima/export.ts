// ANIMA — exportação do relatório em Markdown (função pura, testável).

import { AGENTS, CURATOR_META } from './agent-meta';
import { formatDate } from './format';
import { DEPTH_LABELS, SOURCE_KIND_LABELS, WORK_KIND_LABELS, type AnalysisDTO } from './types';
import { createZip } from './zip';

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

/* ───────────────────────── Exportação para Obsidian ───────────────────────── */

/**
 * Um cofre do Obsidian é uma pasta de notas `.md` ligadas por `[[wikilinks]]`. O relatório inteiro num só
 * arquivo é bom para ler; no Obsidian, vira uma parede. Aqui a análise é fatiada em notas: índice, dossiê e
 * uma por lente — cada uma com frontmatter próprio, para o Obsidian indexar por tag e por obra.
 */
export interface ObsidianNote {
  path: string;
  content: string;
}

/** Caracteres proibidos em nome de arquivo ou que quebram um wikilink. */
const UNSAFE_NAME = /[\\/:*?"<>|#[\]^]/g;

/**
 * Nome de nota legível e seguro. Mantém acentos (o zip é UTF-8 e o Obsidian lida bem), remove o que quebra
 * no Windows ou dentro de `[[...]]` e limita o tamanho para não soar o limite do sistema de arquivos.
 */
export function obsidianNoteName(title: string): string {
  const clean = title
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_NAME, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  return (clean.slice(0, 80) || 'Sem título').trim();
}

/** Tag do Obsidian: sem espaços, sem acento e sem o que o formato recusa. */
export function obsidianTag(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'obra'
  );
}

/** YAML de uma linha: aspas duplas e escapes — evita que dois-pontos no título quebrem o frontmatter. */
function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function frontmatter(fields: Record<string, string | string[]>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(yamlString).join(', ')}]`);
    } else {
      lines.push(`${key}: ${yamlString(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

const stableDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
};

/** Monta as notas em memória. Pura: nada toca o disco. */
export function buildObsidianNotes(a: AnalysisDTO): ObsidianNote[] {
  const base = obsidianNoteName(a.title);
  const fileFor = (suffix: string) => `${base} - ${obsidianNoteName(suffix)}.md`;
  const indexName = `${base}.md`;

  const kindTag = obsidianTag(WORK_KIND_LABELS[a.kind]);
  const tags = ['anima', kindTag];

  const common = {
    obra: a.title,
    fonte: 'ANIMA',
    ...(a.model && a.model !== 'mock' ? { modelo: a.model } : {}),
    data: stableDate(a.createdAt),
  };

  /* Índice */
  const index: string[] = [
    frontmatter({
      tags,
      aliases: [a.title],
      ...common,
      tipo: 'indice',
      profundidade: DEPTH_LABELS[a.depth].label,
      ...(a.focus ? { recorte: a.focus } : {}),
    }),
    `# ${a.title}`,
    '',
    ...(a.hint ? [`_${a.hint}_`, ''] : []),
    '> Conteúdo gerado por IA. Confira fatos e referências marcados com † antes de citar.',
    '',
  ];

  if (a.synthesis) {
    index.push(`## ${CURATOR_META.role}`, '', a.synthesis, '');
  }

  index.push('## Notas', '');
  index.push(`- [[${base} - Dossiê|Dossiê de pesquisa]]`);
  for (const agent of AGENTS) {
    const result = a.results.find((r) => r.agentKey === agent.key);
    if (result?.status !== 'done' || !result.content) continue;
    index.push(`- [[${base} - ${agent.short}|${agent.name} — ${agent.role}]]`);
  }
  index.push('');

  if (a.sources.length > 0) {
    index.push('## Fontes consultadas', '');
    for (const source of a.sources) {
      const details = [source.kind ? SOURCE_KIND_LABELS[source.kind] : null, source.author, source.year ? String(source.year) : null]
        .filter(Boolean)
        .join(' · ');
      index.push(`- [${source.title}](${source.url})${details ? ` — ${details}` : ''}`);
    }
    index.push('');
  }

  const notes: ObsidianNote[] = [{ path: indexName, content: index.join('\n') }];

  /* Dossiê */
  notes.push({
    path: fileFor('Dossiê'),
    content: [
      frontmatter({ tags: [...tags, 'anima/dossie'], ...common, tipo: 'dossie', lente: 'Dossiê de pesquisa' }),
      `# Dossiê de pesquisa`,
      '',
      `[[${base}]] · [[${base} - Dossiê|Dossiê]]`,
      '',
      a.research ?? '_(dossiê indisponível)_',
      '',
    ].join('\n'),
  });

  /* Uma nota por lente executada */
  for (const agent of AGENTS) {
    const result = a.results.find((r) => r.agentKey === agent.key);
    if (result?.status !== 'done' || !result.content) continue;
    notes.push({
      path: `${base} - ${obsidianNoteName(agent.short)}.md`,
      content: [
        frontmatter({
          tags: [...tags, `anima/lente/${obsidianTag(agent.key)}`, `lente/${obsidianTag(agent.short)}`],
          ...common,
          tipo: 'lente',
          lente: agent.name,
          papel: agent.role,
          profundidade: DEPTH_LABELS[a.depth].label,
        }),
        `# ${agent.name} — ${agent.role}`,
        '',
        `[[${base}]] · [[${base} - Dossiê|Dossiê]]`,
        '',
        result.content,
        '',
      ].join('\n'),
    });
  }

  return notes;
}

/**
 * Nome do arquivo `.zip` entregue ao usuário. Prefixo `anima-` evita colidir com uma pasta do cofre que já
 * tenha o nome da obra.
 */
export function obsidianVaultFilename(a: AnalysisDTO): string {
  const slug = a.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `anima-${slug || 'obra'}-obsidian.zip`;
}

/** Pronto para baixar: notas + zip (store), sem tocar em disco. */
export function buildObsidianVault(a: AnalysisDTO): { filename: string; notes: ObsidianNote[]; bytes: Uint8Array<ArrayBuffer> } {
  const notes = buildObsidianNotes(a);
  const encoder = new TextEncoder();
  const bytes = createZip(notes.map((note) => ({ path: note.path, data: encoder.encode(note.content) })));
  return { filename: obsidianVaultFilename(a), notes, bytes };
}
