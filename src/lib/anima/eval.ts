// ANIMA — avaliação de qualidade (Fase 2).
//
// `npm test` prova que o sistema FUNCIONA; isto aqui mede se o resultado é BOM — e só faz sentido com um
// modelo real, porque o mock não escreve análise. Por isso vive fora da suíte padrão, em `npm run eval`.
//
// Três verificações, nenhuma delas bloqueante (o relatório aponta, não impede):
//   1. Forma: cada lente termina com "Limites e verificações", respeita a faixa de palavras da profundidade
//      e usa † para o que vem de conhecimento prévio do modelo.
//   2. Referências: extrai "Autor, *Obra*, ano" e "Autor (ano)" e confere contra Open Library e Crossref.
//      Sem rede, a referência fica "não verificada" — nunca "confirmada" por omissão.
//   3. Cobertura: o relatório traz as seções esperadas e o recorte pedido aparece.

import type { AnalysisDTO, Depth, WorkKind } from './types';
import { DEPTH_CONFIG } from './prompts';
import { AGENT_KEYS } from './types';

/* ───────────────────────── Obras de referência ───────────────────────── */

export interface GoldenWork {
  id: string;
  title: string;
  hint: string;
  kind: WorkKind;
  depth: Depth;
  /** Por que esta obra está no conjunto. */
  why: string;
  /** Termos que uma análise honesta desta obra quase certamente toca (checagem frouxa, só para sinalizar). */
  expectedTerms: string[];
}

/**
 * Cinco obras, cinco meios: livro brasileiro, romance estrangeiro, filme, série e jogo.
 * A escolha busca dossiês de tamanhos diferentes — Machado e García Márquez têm fortuna crítica imensa;
 * Disco Elysium tem crítica de imprensa abundante, mas acadêmica escassa. Isso testa a honestidade
 * sobre lacunas, não só a fluência.
 */
export const GOLDEN_WORKS: GoldenWork[] = [
  {
    id: 'dom-casmurro',
    title: 'Dom Casmurro',
    hint: 'Machado de Assis, 1899',
    kind: 'book',
    depth: 'brief',
    why: 'Livro brasileiro canônico: fortuna crítica gigantesca e a disputa clássica sobre a narração não confiável.',
    expectedTerms: ['Capitu', 'Bento', 'narrador'],
  },
  {
    id: 'cem-anos',
    title: 'Cem Anos de Solidão',
    hint: 'Gabriel García Márquez, 1967',
    kind: 'book',
    depth: 'brief',
    why: 'Romance estrangeiro traduzido: exige lidar com edição/tradução e com o rótulo "realismo mágico" sem reduzi-lo a clichê.',
    expectedTerms: ['Macondo', 'Buendía', 'solidão'],
  },
  {
    id: 'cidade-de-deus',
    title: 'Cidade de Deus',
    hint: 'Fernando Meirelles e Kátia Lund, 2002',
    kind: 'film',
    depth: 'brief',
    why: 'Filme brasileiro: ficha técnica importa (direção, roteiro, fotografia) e há debate público sobre representação.',
    expectedTerms: ['Zé Pequeno', 'Buscapé', 'favela'],
  },
  {
    id: 'breaking-bad',
    title: 'Breaking Bad',
    hint: 'Vince Gilligan, 2008–2013',
    kind: 'series',
    depth: 'brief',
    why: 'Série longa: testa se a análise arca com arco de temporadas sem confundir episódio com série.',
    expectedTerms: ['Walter White', 'Jesse', 'temporada'],
  },
  {
    id: 'disco-elysium',
    title: 'Disco Elysium',
    hint: 'ZA/UM, 2019',
    kind: 'game',
    depth: 'brief',
    why: 'Jogo: narrativa ramificada e agência do jogador — a lente estrutural costuma escorregar aqui.',
    expectedTerms: ['Harry', 'Revachol', 'diálogo'],
  },
];

/* ───────────────────────── Checagens de forma ───────────────────────── */

export interface SectionCheck {
  agentKey: string;
  words: number;
  /** Faixa pedida pela profundidade (min/max), com tolerância aplicada. */
  expected: { min: number; max: number };
  withinRange: boolean;
  hasLimitsSection: boolean;
  daggerCount: number;
  /** Problemas legíveis; vazio quando está tudo certo. */
  issues: string[];
}

/** Tolerância: o prompt pede uma faixa; modelos erram para cima/baixo. 25% evita ruído. */
const TOLERANCE = 0.25;

export function countWords(text: string): number {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ') // blocos de código
    .replace(/[#>*_`|]/g, ' ') // marcação
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → texto
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
}

/** A seção obrigatória, aceitando variações de título e nível de heading. */
export function hasLimitsSection(text: string): boolean {
  return /^#{2,4}\s*Limites e verifica/i.test(text.trim()) || /\n#{2,4}\s*Limites e verifica/i.test(text);
}

export function countDaggers(text: string): number {
  return (text.match(/†/g) ?? []).length;
}

export function checkSection(agentKey: string, content: string, depth: Depth): SectionCheck {
  const { minWords, maxWords } = DEPTH_CONFIG[depth];
  const words = countWords(content);
  const floor = Math.floor(minWords * (1 - TOLERANCE));
  const ceiling = Math.ceil(maxWords * (1 + TOLERANCE));
  const limits = hasLimitsSection(content);
  const daggers = countDaggers(content);

  const issues: string[] = [];
  if (words < floor) issues.push(`curta: ${words} palavras (pedido ${minWords}–${maxWords})`);
  if (words > ceiling) issues.push(`longa: ${words} palavras (pedido ${minWords}–${maxWords})`);
  if (!limits) issues.push('sem a seção "Limites e verificações"');

  return {
    agentKey,
    words,
    expected: { min: minWords, max: maxWords },
    withinRange: words >= floor && words <= ceiling,
    hasLimitsSection: limits,
    daggerCount: daggers,
    issues,
  };
}

export function checkCoverage(analysis: AnalysisDTO, work: GoldenWork): string[] {
  const text = [
    analysis.research ?? '',
    ...analysis.results.map((r) => r.content ?? ''),
    analysis.synthesis ?? '',
  ].join('\n');
  const lower = text.toLowerCase();
  return work.expectedTerms
    .filter((term) => !lower.includes(term.toLowerCase()))
    .map((term) => `termo esperado ausente: "${term}"`);
}

/* ───────────────────────── Referências ───────────────────────── */

export interface ParsedReference {
  author: string;
  title: string | null;
  year: number;
  /** Trecho original, para o relatório. */
  raw: string;
}

/**
 * Extrai referências no formato pedido pelo prompt: `Autor, *Obra*, ano` e o mais frouxo `Autor (ano)`.
 * Não tenta ser um parser de bibliografia: só o que o ANIMA de fato instrui o modelo a escrever.
 */
export function extractReferences(markdown: string): ParsedReference[] {
  const found = new Map<string, ParsedReference>();

  const strict = /([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]+(?:\s+(?:de|da|do|dos|das|van|von|der)?\s*[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]+)*)\s*,\s*\*([^*\n]{2,120})\*[^.\n]{0,20}?(\d{4})/gu;
  for (const match of markdown.matchAll(strict)) {
    const [, author, title, year] = match;
    // Mesma obra citada com e sem prenome ("Schwarz" × "Roberto Schwarz") é uma referência só.
    const key = `${title}|${year}`.toLowerCase();
    if (!found.has(key)) found.set(key, { author, title, year: Number(year), raw: match[0].trim() });
  }

  const loose = /([A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’-]+){0,3})\s*\((\d{4})\)/gu;
  for (const match of markdown.matchAll(loose)) {
    const [, author, year] = match;
    const key = `${author}||${year}`.toLowerCase();
    if (![...found.keys()].some((k) => k.startsWith(`${author.toLowerCase()}|`) && k.endsWith(`|${year}`))) {
      found.set(key, { author, title: null, year: Number(year), raw: match[0].trim() });
    }
  }

  return [...found.values()];
}

export type ReferenceStatus = 'confirmada' | 'duvidosa' | 'nao_verificada';

export interface VerifiedReference extends ParsedReference {
  status: ReferenceStatus;
  /** Onde foi encontrada (ou não) e com que ano. */
  evidence: string;
}

interface OlDoc {
  title?: string;
  first_publish_year?: number;
  author_name?: string[];
}

/** Consulta a Open Library. Devolve `null` quando a rede falha (distinto de "não achou"). */
async function lookupOpenLibrary(ref: ParsedReference, fetchImpl: typeof fetch): Promise<OlDoc[] | null> {
  const query = ref.title ? `title=${encodeURIComponent(ref.title)}&author=${encodeURIComponent(ref.author)}` : `author=${encodeURIComponent(ref.author)}&first_publish_year=${ref.year}`;
  try {
    const res = await fetchImpl(`https://openlibrary.org/search.json?${query}&limit=5&fields=title,first_publish_year,author_name`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { docs?: OlDoc[] };
    return json.docs ?? [];
  } catch {
    return null;
  }
}

interface CrossrefItem {
  title?: string[];
  author?: Array<{ family?: string }>;
  issued?: { 'date-parts'?: number[][] };
}

async function lookupCrossref(ref: ParsedReference, fetchImpl: typeof fetch): Promise<CrossrefItem[] | null> {
  const query = encodeURIComponent(`${ref.author} ${ref.title ?? ''}`.trim());
  try {
    const res = await fetchImpl(`https://api.crossref.org/works?query.bibliographic=${query}&rows=5&select=title,author,issued`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    return json.message?.items ?? null;
  } catch {
    return null;
  }
}

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sharesTitle = (a: string | null, b: string | undefined): boolean => {
  if (!a || !b) return false;
  const na = normalize(a);
  const nb = normalize(b);
  if (na.length < 4 || nb.length < 4) return false;
  return nb.includes(na) || na.includes(nb);
};

/** Diferença aceitável de ano entre o que o modelo escreveu e o que a base informa. */
const YEAR_SLACK = 1;

/** Sobrenome (último token) — é o que as bases costumam preservar e o que identifica o autor. */
const surname = (author: string) => normalize(author).split(' ').filter(Boolean).pop() ?? '';

/**
 * Autor confere? Sem isso, uma referência "Bakhtin (1981)" casaria com qualquer artigo de 1981.
 * Lista vazia (base sem metadados de autoria) conta como NÃO conferido.
 */
const sharesAuthor = (ref: ParsedReference, names: string[] | undefined): boolean => {
  if (!names || names.length === 0) return false;
  const target = surname(ref.author);
  if (!target) return false;
  return names.some((name) => normalize(name).split(' ').includes(target));
};

/**
 * Confere uma referência nas duas bases.
 *
 * Regra de honestidade: "confirmada" exige um registro com título (quando houver) e ano compatíveis.
 * Se as duas bases falharem por rede, o status é "nao_verificada" — jamais "confirmada".
 */
export async function verifyReference(
  ref: ParsedReference,
  fetchImpl: typeof fetch = fetch,
  crossref?: typeof fetch
): Promise<VerifiedReference> {
  const [olDocs, crItems] = await Promise.all([
    lookupOpenLibrary(ref, fetchImpl),
    crossref ? lookupCrossref(ref, crossref) : lookupCrossref(ref, fetchImpl),
  ]);

  if (olDocs === null && crItems === null) {
    return { ...ref, status: 'nao_verificada', evidence: 'Open Library e Crossref inacessíveis' };
  }

  const olMatch = (olDocs ?? []).find(
    (doc) =>
      sharesAuthor(ref, doc.author_name) &&
      (!ref.title || sharesTitle(ref.title, doc.title)) &&
      (!doc.first_publish_year || Math.abs(doc.first_publish_year - ref.year) <= YEAR_SLACK)
  );
  if (olMatch) {
    return {
      ...ref,
      status: 'confirmada',
      evidence: `Open Library: “${olMatch.title ?? ref.title}” (${olMatch.first_publish_year ?? 'ano não informado'})`,
    };
  }

  const crMatch = (crItems ?? []).find((item) => {
    const year = item.issued?.['date-parts']?.[0]?.[0];
    const families = (item.author ?? []).map((a) => a.family ?? '').filter(Boolean);
    return (
      sharesAuthor(ref, families) &&
      (!ref.title || sharesTitle(ref.title, item.title?.[0])) &&
      (!year || Math.abs(year - ref.year) <= YEAR_SLACK)
    );
  });
  if (crMatch) {
    const year = crMatch.issued?.['date-parts']?.[0]?.[0];
    return { ...ref, status: 'confirmada', evidence: `Crossref: “${crMatch.title?.[0] ?? ref.title}” (${year ?? '?'})` };
  }

  return {
    ...ref,
    status: 'duvidosa',
    evidence: `nada com título/ano compatíveis (${(olDocs?.length ?? 0)} resultado(s) na Open Library, ${(crItems?.length ?? 0)} no Crossref)`,
  };
}

export async function verifyReferences(
  markdown: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifiedReference[]> {
  const refs = extractReferences(markdown);
  const verified: VerifiedReference[] = [];
  for (const ref of refs) {
    verified.push(await verifyReference(ref, fetchImpl));
  }
  return verified;
}

/* ───────────────────────── Avaliação completa ───────────────────────── */

export interface WorkEvaluation {
  work: GoldenWork;
  status: AnalysisDTO['status'];
  /** Mensagem de erro quando a análise não terminou; é o que explica um relatório vazio. */
  error: string | null;
  durationMs: number | null;
  sections: SectionCheck[];
  coverage: string[];
  references: VerifiedReference[];
  usage: AnalysisDTO['usage'];
  /** Contagem de sinais ruins; não bloqueia, orienta. */
  score: {
    sectionsInRange: number;
    sectionsTotal: number;
    withLimits: number;
    daggers: number;
    refsConfirmed: number;
    refsDoubtful: number;
    refsUnverified: number;
  };
}

export function evaluateWork(work: GoldenWork, analysis: AnalysisDTO): WorkEvaluation {
  const selected = analysis.results.filter((r) => r.status === 'done' && r.content);
  const sections = selected.map((r) => checkSection(r.agentKey, r.content!, work.depth));

  const fullText = [analysis.research ?? '', ...selected.map((r) => r.content!), analysis.synthesis ?? ''].join('\n');
  const references = extractReferences(fullText).map((ref) => ({ ...ref, status: 'nao_verificada' as const, evidence: 'não conferida' }));

  return {
    work,
    status: analysis.status,
    error: analysis.error,
    durationMs: analysis.durationMs,
    sections,
    coverage: checkCoverage(analysis, work),
    references,
    usage: analysis.usage,
    score: {
      sectionsInRange: sections.filter((s) => s.withinRange).length,
      sectionsTotal: sections.length,
      withLimits: sections.filter((s) => s.hasLimitsSection).length,
      daggers: sections.reduce((sum, s) => sum + s.daggerCount, 0),
      refsConfirmed: 0,
      refsDoubtful: 0,
      refsUnverified: references.length,
    },
  };
}

/** Renderiza o relatório em Markdown (o artefato que o usuário lê depois do `npm run eval`). */
export function renderEvalReport(evaluations: WorkEvaluation[], meta: { model: string; date: string }): string {
  const lines: string[] = [
    '# Avaliação ANIMA',
    '',
    `- **Modelo:** ${meta.model}`,
    `- **Data:** ${meta.date}`,
    `- **Obras:** ${evaluations.length}`,
    '',
    '> Mede forma e verificabilidade, não gosto. Nada aqui reprova automaticamente: os sinais existem para você ',
    '> decidir onde o relatório precisa de você.',
    '',
    '## Resumo',
    '',
    '| Obra | Situação | Seções na faixa | Com "Limites" | † | Referências (conf./duvid./n.v.) | Tokens |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const e of evaluations) {
    lines.push(
      `| ${e.work.title} | ${e.status} | ${e.score.sectionsInRange}/${e.score.sectionsTotal} | ${e.score.withLimits}/${e.score.sectionsTotal} | ${e.score.daggers} | ${e.references.filter((r) => r.status === 'confirmada').length}/${e.references.filter((r) => r.status === 'duvidosa').length}/${e.references.filter((r) => r.status === 'nao_verificada').length} | ${e.usage?.totalTokens ?? '—'} |`
    );
  }

  for (const e of evaluations) {
    lines.push('', `## ${e.work.title}`, '', `_${e.work.why}_`, '');
    if (e.error) lines.push(`- **Erro:** ${e.error}`);
    if (e.coverage.length) lines.push(`- **Cobertura:** ${e.coverage.join('; ')}`);
    const problems = e.sections.filter((s) => s.issues.length);
    if (e.sections.length === 0) {
      lines.push('- **Forma:** nenhuma seção concluída — não há o que medir.');
    } else if (problems.length === 0) {
      lines.push('- **Forma:** todas as seções dentro do esperado.');
    }
    for (const section of problems) {
      lines.push(`- **${section.agentKey}:** ${section.issues.join('; ')}`);
    }
    if (e.references.length === 0) {
      lines.push('- **Referências:** nenhuma no formato "Autor, *Obra*, ano".');
    } else {
      lines.push('', '| Referência | Situação | Evidência |', '| --- | --- | --- |');
      for (const ref of e.references) {
        lines.push(`| ${ref.raw.replace(/\|/g, '\\|')} | ${ref.status} | ${ref.evidence.replace(/\|/g, '\\|')} |`);
      }
    }
  }

  lines.push('', '---', '', `Lentes consideradas: ${AGENT_KEYS.join(', ')}.`);
  return lines.join('\n');
}
