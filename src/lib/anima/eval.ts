// ANIMA — avaliação de qualidade (Fase 2).
//
// O `npm test` prova que o pipeline **funciona**; ele não diz se o texto que sai é bom. Este módulo reúne o
// que dá para medir sem opinião: tamanho por lente, presença da seção obrigatória, uso da marca † e — o mais
// importante — se cada referência bibliográfica existe de fato.
//
// Nada aqui reprova: o relatório **reporta**. Quem decide o que fazer com o sinal é o leitor.

import { DEPTH_CONFIG } from './prompts';
import { AGENT_KEYS, type AgentKey, type AnalysisDTO, type Depth, type WorkKind } from './types';

/* ───────────────────────── Conjunto de obras ───────────────────────── */

export interface GoldenWork {
  id: string;
  title: string;
  hint: string;
  kind: WorkKind;
  focus: string | null;
  depth: Depth;
  /** Por que esta obra está no conjunto — o que ela testa que as outras não testam. */
  why: string;
}

/**
 * Cinco obras, cinco meios, cinco tipos de dificuldade:
 * • canônica brasileira com fortuna crítica vasta;
 * • clássico estrangeiro traduzido (nome de personagem e título mudam com a tradução);
 * • filme com ficha técnica e elenco — testa fonte de créditos;
 * • série longa, onde "obra" e "temporada" não são a mesma coisa;
 * • jogo, onde a narrativa depende de agência do jogador.
 */
export const GOLDEN_WORKS: GoldenWork[] = [
  {
    id: 'dom-casmurro',
    title: 'Dom Casmurro',
    hint: 'Machado de Assis, 1899',
    kind: 'book',
    focus: null,
    depth: 'standard',
    why: 'Obra canônica brasileira: exige separar narrador de autor e lidar com a fortuna crítica acumulada.',
  },
  {
    id: 'cem-anos',
    title: 'Cem Anos de Solidão',
    hint: 'Gabriel García Márquez, 1967',
    kind: 'book',
    focus: null,
    depth: 'standard',
    why: 'Clássico traduzido: nomes, títulos e datas chegam ao modelo por vias diferentes — bom teste de referência.',
  },
  {
    id: 'cidade-de-deus',
    title: 'Cidade de Deus',
    hint: 'Fernando Meirelles e Kátia Lund, 2002',
    kind: 'film',
    focus: null,
    depth: 'brief',
    why: 'Filme com adaptação literária: a ficha técnica (direção, roteiro, fotografia) precisa vir da fonte certa.',
  },
  {
    id: 'breaking-bad',
    title: 'Breaking Bad',
    hint: 'Vince Gilligan, 2008–2013',
    kind: 'series',
    focus: 'a temporada 4 e o arco de Gus Fring',
    depth: 'brief',
    why: 'Série longa com recorte de temporada: testa se o modelo respeita o escopo pedido em vez de resumir tudo.',
  },
  {
    id: 'disco-elysium',
    title: 'Disco Elysium',
    hint: 'ZA/UM, 2019',
    kind: 'game',
    focus: null,
    depth: 'brief',
    why: 'Jogo narrativo: a análise precisa falar de agência e sistema, não só de "enredo".',
  },
];

/* ───────────────────────── Contagem e forma ───────────────────────── */

/** Palavras de verdade: ignora marcação, blocos de código, URLs e números soltos de lista. */
export function countWords(markdown: string): number {
  const clean = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[#>\s*-]+/gm, ' ')
    .replace(/[*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return 0;
  return clean.split(' ').filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

/** A seção obrigatória pedida em todo prompt de lente. */
export function hasLimitsSection(markdown: string): boolean {
  return /^#{2,4}\s*limites e verifica[^\n]*$/im.test(markdown);
}

/** Marcas de "não veio do dossiê": ajuda a ver se o modelo está sinalizando incerteza. */
export function countDaggers(markdown: string): number {
  return (markdown.match(/†/g) ?? []).length;
}

/** Marcadores de título, para checar se a lente entregou seções além do bloco de limites. */
export function countHeadings(markdown: string): number {
  return (markdown.match(/^#{2,4}\s+\S/gm) ?? []).length;
}

export interface SectionCheck {
  agentKey: AgentKey;
  words: number;
  min: number;
  max: number;
  /** Dentro da faixa com 25% de tolerância para baixo/cima — o modelo erra para os dois lados. */
  withinRange: boolean;
  hasLimits: boolean;
  daggers: number;
  headings: number;
  /** Vazio quando não há nada a reportar. */
  issues: string[];
}

const TOLERANCE = 0.25;

export function checkSection(agentKey: AgentKey, content: string, depth: Depth): SectionCheck {
  const { minWords, maxWords } = DEPTH_CONFIG[depth];
  const words = countWords(content);
  const floor = Math.round(minWords * (1 - TOLERANCE));
  const ceiling = Math.round(maxWords * (1 + TOLERANCE));
  const withinRange = words >= floor && words <= ceiling;
  const hasLimits = hasLimitsSection(content);
  const daggers = countDaggers(content);
  const headings = countHeadings(content);

  const issues: string[] = [];
  if (!withinRange) issues.push(words < floor ? `curta (${words} palavras)` : `longa (${words} palavras)`);
  if (!hasLimits) issues.push('sem a seção "Limites e verificações"');
  if (headings < 2) issues.push('poucos subtítulos — texto corrido dificulta a leitura');
  if (words > 0 && daggers === 0) issues.push('nenhuma marca † — afirmação de fora do dossiê sem sinalizar');

  return { agentKey, words, min: minWords, max: maxWords, withinRange, hasLimits, daggers, headings, issues };
}

/* ───────────────────────── Referências ───────────────────────── */

export interface ParsedReference {
  /** Trecho como apareceu no texto. */
  raw: string;
  author: string;
  title: string | null;
  year: number;
  /** Formato de origem, para o relatório ser honesto sobre o que foi lido. */
  format: 'autor-obra-ano' | 'autor-ano';
}

// Nome próprio com partículas ("Machado de Assis", "García Márquez"), sem invadir a frase anterior.
const AUTHOR = String.raw`[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’.-]*(?:\s+(?:(?:de|da|do|das|dos|e|van|von|der|di)\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}'’.-]*)*`;

const STRICT = new RegExp(`${AUTHOR}\\s*,\\s*\\*([^*\\n]{2,90})\\*[^\\n\\d]{0,24}(\\d{4})`, 'gu');
const LOOSE = new RegExp(`${AUTHOR}\\s*\\((\\d{4})\\)`, 'gu');

/** Extrai as duas formas que os prompts pedem: `Autor, *Obra*, ano` e `Autor (ano)`. */
export function parseReferences(markdown: string): ParsedReference[] {
  const found = new Map<string, ParsedReference>();

  for (const match of markdown.matchAll(STRICT)) {
    const [raw, title, year] = match;
    const author = raw.slice(0, raw.indexOf(',')).trim();
    const key = `${author.toLowerCase()}|${year}`;
    if (!found.has(key)) {
      found.set(key, { raw: raw.trim(), author, title: title.trim(), year: Number(year), format: 'autor-obra-ano' });
    }
  }

  for (const match of markdown.matchAll(LOOSE)) {
    const [raw, year] = match;
    const author = raw.slice(0, raw.indexOf('(')).trim();
    const key = `${author.toLowerCase()}|${year}`;
    if (!found.has(key)) {
      found.set(key, { raw: raw.trim(), author, title: null, year: Number(year), format: 'autor-ano' });
    }
  }

  return [...found.values()];
}

export type ReferenceVerdict = 'confirmada' | 'duvidosa' | 'nao_verificada';

export interface ReferenceResult extends ParsedReference {
  verdict: ReferenceVerdict;
  /** O que cada base respondeu — é o que permite conferir a conferência. */
  evidence: string;
}

export type JsonFetcher = (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>;

const OL = 'https://openlibrary.org/search.json';
const CR = 'https://api.crossref.org/works';

/** Ano aceitável: ±1 cobre reimpressão, tradução e divergência entre catálogos. */
const YEAR_SLACK = 1;

interface OpenLibraryDoc {
  title?: string;
  first_publish_year?: number;
}

interface CrossrefItem {
  title?: string[];
  issued?: { 'date-parts'?: number[][] };
}

export async function verifyReference(ref: ParsedReference, fetchImpl: JsonFetcher = fetch): Promise<ReferenceResult> {
  const queries = [
    { name: 'Open Library', url: `${OL}?title=${encodeURIComponent(ref.title ?? '')}&author=${encodeURIComponent(ref.author)}&limit=5&fields=title,first_publish_year` },
    {
      name: 'Crossref',
      url: `${CR}?query.bibliographic=${encodeURIComponent([ref.author, ref.title].filter(Boolean).join(' '))}&rows=5&select=title,issued`,
    },
  ];

  let answered = 0;
  const evidence: string[] = [];

  for (const query of queries) {
    try {
      const response = await fetchImpl(query.url);
      if (!response.ok) {
        evidence.push(`${query.name}: HTTP ${response.status ?? '???'}`);
        continue;
      }
      const payload = (await response.json()) as { docs?: OpenLibraryDoc[]; message?: { items?: CrossrefItem[] } };
      answered += 1;

      const years =
        payload.docs?.map((doc) => doc.first_publish_year) ??
        payload.message?.items?.map((item) => item.issued?.['date-parts']?.[0]?.[0]);

      const hit = (years ?? []).some((year) => typeof year === 'number' && Math.abs(year - ref.year) <= YEAR_SLACK);
      evidence.push(`${query.name}: ${(years ?? []).length} resultado(s)${hit ? ', ano confere' : ', ano não confere'}`);
      if (hit) {
        return { ...ref, verdict: 'confirmada', evidence: evidence.join(' · ') };
      }
    } catch (error) {
      evidence.push(`${query.name}: ${error instanceof Error ? error.message : 'falhou'}`);
    }
  }

  return {
    ...ref,
    verdict: answered > 0 ? 'duvidosa' : 'nao_verificada',
    evidence: evidence.join(' · '),
  };
}

/** Verifica em série com um teto: bibliografia longa não pode virar uma tempestade de requisições. */
export async function verifyReferences(
  references: ParsedReference[],
  fetchImpl: JsonFetcher = fetch,
  limit = 12
): Promise<ReferenceResult[]> {
  const results: ReferenceResult[] = [];
  for (const reference of references.slice(0, limit)) {
    results.push(await verifyReference(reference, fetchImpl));
  }
  return results;
}

/* ───────────────────────── Avaliação de uma análise ───────────────────────── */

export interface WorkEvaluation {
  work: GoldenWork;
  status: AnalysisDTO['status'];
  durationMs: number | null;
  sections: SectionCheck[];
  /** Todas as referências do relatório inteiro (dossiê + lentes + síntese). */
  references: ParsedReference[];
  totals: {
    lenses: number;
    withinRange: number;
    withLimits: number;
    daggers: number;
    words: number;
  };
  /** Só os problemas, já em texto — é o que vira linha do relatório. */
  issues: string[];
}

export function evaluateAnalysis(work: GoldenWork, analysis: AnalysisDTO): WorkEvaluation {
  const selected = AGENT_KEYS.filter((key) => {
    const result = analysis.results.find((r) => r.agentKey === key);
    return result?.status === 'done' && Boolean(result.content);
  });

  const sections = selected.map((key) =>
    checkSection(key, analysis.results.find((r) => r.agentKey === key)?.content ?? '', work.depth)
  );

  const fullText = [analysis.research ?? '', ...sections.map((s) => analysis.results.find((r) => r.agentKey === s.agentKey)?.content ?? ''), analysis.synthesis ?? ''].join('\n\n');

  const issues: string[] = [];
  for (const section of sections) {
    for (const issue of section.issues) issues.push(`${section.agentKey}: ${issue}`);
  }
  if (!analysis.research) issues.push('sem dossiê de pesquisa');
  if (!analysis.synthesis) issues.push('sem síntese do curador');

  return {
    work,
    status: analysis.status,
    durationMs: analysis.durationMs,
    sections,
    references: parseReferences(fullText),
    totals: {
      lenses: sections.length,
      withinRange: sections.filter((s) => s.withinRange).length,
      withLimits: sections.filter((s) => s.hasLimits).length,
      daggers: sections.reduce((sum, s) => sum + s.daggers, 0),
      words: sections.reduce((sum, s) => sum + s.words, 0),
    },
    issues,
  };
}

/* ───────────────────────── Relatório ───────────────────────── */

const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '_nada a reportar_');

export function renderEvalReport(
  evaluations: WorkEvaluation[],
  verified: Map<string, ReferenceResult[]>,
  meta: { model: string; date: string; offline?: boolean }
): string {
  const lines: string[] = [
    `# Avaliação do ANIMA — ${meta.date}`,
    '',
    `Modelo: \`${meta.model}\`${meta.offline ? ' · referências **não** conferidas (--offline)' : ''}`,
    '',
    'Este relatório mede forma e verificabilidade, não gosto. Ele não reprova nada: aponta onde olhar.',
    '',
    '| Obra | Lentes | Na faixa | Com "Limites" | † | Palavras |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const evaluation of evaluations) {
    const { totals } = evaluation;
    lines.push(
      `| ${evaluation.work.title} | ${totals.lenses} | ${totals.withinRange}/${totals.lenses} | ${totals.withLimits}/${totals.lenses} | ${totals.daggers} | ${totals.words} |`
    );
  }

  for (const evaluation of evaluations) {
    lines.push('', `## ${evaluation.work.title}`, '', `_${evaluation.work.hint} — ${evaluation.work.why}_`, '');

    lines.push('**Forma**', '');
    lines.push('| Lente | Palavras | Faixa | Limites | † |', '| --- | --- | --- | --- | --- |');
    for (const section of evaluation.sections) {
      lines.push(
        `| ${section.agentKey} | ${section.words} | ${section.min}–${section.max} | ${section.hasLimits ? 'sim' : 'NÃO'} | ${section.daggers} |`
      );
    }

    lines.push('', '**Pontos de atenção**', '', list(evaluation.issues), '');

    const results = verified.get(evaluation.work.id) ?? [];
    lines.push('**Referências**', '');
    if (results.length === 0) {
      lines.push('_nenhuma referência no formato "Autor, *Obra*, ano" ou "Autor (ano)"_');
    } else {
      lines.push('| Referência | Situação | Evidência |', '| --- | --- | --- |');
      for (const result of results) {
        const mark = result.verdict === 'confirmada' ? '✓' : result.verdict === 'duvidosa' ? '?' : '—';
        lines.push(`| ${result.raw.replace(/\|/g, '\\|')} | ${mark} ${result.verdict} | ${result.evidence.replace(/\|/g, '\\|')} |`);
      }
    }
    lines.push('');
  }

  const all = [...verified.values()].flat();
  lines.push('', '---', '', `Referências: ${all.filter((r) => r.verdict === 'confirmada').length} confirmadas, ${all.filter((r) => r.verdict === 'duvidosa').length} duvidosas, ${all.filter((r) => r.verdict === 'nao_verificada').length} não verificadas.`);
  lines.push('', '`†` = afirmação vinda do conhecimento do modelo, fora do dossiê.');
  lines.push('');
  lines.push('_Confirmação significa "existe uma obra com esse autor e esse ano nas bases consultadas". Não significa que a citação diz o que o texto afirma._');

  return lines.join('\n');
}
