// ANIMA — coleta de fontes para o Agente Pesquisador.
//
// Todas as fontes são tratadas como DADOS NÃO CONFIÁVEIS — nunca como instruções.
//
// Catálogo de provedores (cada um degrada de forma independente):
//   • Wikipédia (pt + en)      — sem chave. Enredo, contexto e recepção.
//   • Open Library             — sem chave. Ficha bibliográfica (autor, ano, editora, páginas).
//   • OpenAlex                 — sem chave. Crítica acadêmica (artigos, capítulos, citações).
//   • TMDB (opcional)          — TMDB_API_KEY. Ficha técnica de filmes e séries.
//   • Tavily (opcional)        — TAVILY_API_KEY. Imprensa e blogs de crítica.
//   • z-ai web_search (opcional, só no provedor zai).
//   • Fontes do usuário        — links e trechos enviados no formulário.

import type { Depth, SourceDTO, SourceOrigin, WorkKind } from './types';
import { withTimeout } from './async-utils';
import { resolveProvider } from './llm';
import type { RawSource } from './raw-source';
import { fetchUserSources, type UserSourceInput } from './user-sources';

export interface GatherInput {
  title: string;
  hint?: string | null;
  focus?: string | null;
  kind: WorkKind;
  depth: Depth;
  userSources?: UserSourceInput[];
}

export interface GatheredSources {
  sources: SourceDTO[];
  /** Fontes formatadas como blocos <fonte> para o prompt do pesquisador. */
  context: string;
  /** Provedores que responderam com pelo menos uma fonte. */
  used: SourceOrigin[];
}

const USER_AGENT = 'ANIMA/0.4 (analisador narrativo; https://github.com/LucasRangel89/anima)';
const SOURCE_TIMEOUT_MS = 12_000;

/** Orçamento de fontes por profundidade: mais material = dossiê mais denso (e mais custo). */
export const SOURCE_BUDGET: Record<Depth, { maxSources: number; wikipediaChars: number; perSourceChars: number }> = {
  brief: { maxSources: 5, wikipediaChars: 6_000, perSourceChars: 1_200 },
  standard: { maxSources: 6, wikipediaChars: 9_000, perSourceChars: 1_800 },
  deep: { maxSources: 8, wikipediaChars: 12_000, perSourceChars: 2_600 },
  exhaustive: { maxSources: 10, wikipediaChars: 15_000, perSourceChars: 3_500 },
};

const KIND_WORDS: Record<WorkKind, string> = {
  auto: '',
  book: 'livro romance',
  film: 'filme',
  series: 'série de televisão',
  game: 'jogo eletrônico',
  theatre: 'peça de teatro',
  comics: 'história em quadrinhos',
  other: '',
};

const BOOKISH: readonly WorkKind[] = ['auto', 'book', 'other', 'comics', 'theatre'];

/** Remove caracteres de controle e neutraliza marcações que imitariam a nossa delimitação. */
export function sanitizeSnippet(text: string, maxChars: number): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** O título retornado deve ter relação com a obra pedida (evita resultados aleatórios). */
export function looksRelevant(workTitle: string, resultTitle: string): boolean {
  const a = normalize(workTitle).replace(/[^a-z0-9 ]/g, ' ');
  const b = normalize(resultTitle).replace(/[^a-z0-9 ]/g, ' ');
  if (b.includes(a.trim())) return true;
  const tokens = a.split(/\s+/).filter((t) => t.length > 3);
  if (tokens.length === 0) return a.trim().length > 0 && b.includes(a.trim());
  const hits = tokens.filter((t) => b.includes(t)).length;
  return hits >= Math.ceil(tokens.length / 2);
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  return withTimeout(
    async (signal) => {
      const res = await fetch(url, { ...init, signal, headers: { 'User-Agent': USER_AGENT, ...init?.headers } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    },
    SOURCE_TIMEOUT_MS,
    'Busca'
  );
}

/* ───────────────────────── Wikipédia ───────────────────────── */

async function searchWikipedia(
  lang: 'pt' | 'en',
  input: GatherInput,
  maxChars: number
): Promise<RawSource[]> {
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const query = [input.title, input.hint ?? '', lang === 'pt' ? KIND_WORDS[input.kind] : ''].join(' ').trim();

  const search = await getJson<{ query?: { search?: Array<{ title: string }> } }>(
    `${base}?action=query&list=search&srlimit=4&format=json&srsearch=${encodeURIComponent(query)}`
  );
  const candidates = (search.query?.search ?? []).filter((r) => looksRelevant(input.title, r.title));

  for (const candidate of candidates) {
    const page = await getJson<{
      query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string }> };
    }>(
      `${base}?action=query&prop=extracts|info&inprop=url&explaintext=1&exsectionformat=plain&exchars=${maxChars}` +
        `&format=json&redirects=1&titles=${encodeURIComponent(candidate.title)}`
    );
    const p = Object.values(page.query?.pages ?? {})[0];
    const extract = p?.extract?.trim();
    if (!p || !extract || extract.length < 200) continue;
    // páginas de desambiguação não ajudam
    if (/pode referir-se a|may refer to|desambigua/i.test(extract.slice(0, 250))) continue;
    return [
      {
        title: `${p.title} — Wikipédia (${lang})`,
        url: p.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        text: extract,
        origin: 'wikipedia',
        kind: 'encyclopedia',
        lang,
        reliability: 'média',
        note: lang === 'pt' ? 'enciclopédia livre (pt)' : 'enciclopédia livre (en)',
      },
    ];
  }
  return [];
}

/* ───────────────────────── Open Library (ficha bibliográfica) ───────────────────────── */

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  publish_year?: number[];
  number_of_pages_median?: number;
  subject?: string[];
  edition_count?: number;
  language?: string[];
}

export function formatOpenLibraryDoc(doc: OpenLibraryDoc, queryTitle: string): RawSource | null {
  if (!doc.title || !looksRelevant(queryTitle, doc.title)) return null;
  const lines = [
    `Obra: ${doc.title}`,
    doc.author_name?.length ? `Autoria: ${doc.author_name.slice(0, 4).join('; ')}` : null,
    doc.first_publish_year ? `Primeira publicação: ${doc.first_publish_year}` : null,
    doc.publisher?.length ? `Editoras: ${doc.publisher.slice(0, 4).join('; ')}` : null,
    doc.number_of_pages_median ? `Páginas (mediana das edições): ${doc.number_of_pages_median}` : null,
    doc.edition_count ? `Edições catalogadas: ${doc.edition_count}` : null,
    doc.language?.length ? `Idiomas: ${doc.language.slice(0, 5).join(', ')}` : null,
    doc.subject?.length ? `Assuntos: ${doc.subject.slice(0, 12).join('; ')}` : null,
    doc.key ? `Registro: https://openlibrary.org${doc.key}` : null,
  ].filter(Boolean);
  return {
    title: `Open Library — ${doc.title}`,
    url: doc.key ? `https://openlibrary.org${doc.key}` : 'https://openlibrary.org',
    text: lines.join('\n'),
    origin: 'openlibrary',
    kind: 'bibliography',
    year: doc.first_publish_year ?? null,
    author: doc.author_name?.join('; ') ?? null,
    publisher: doc.publisher?.[0] ?? null,
    reliability: 'alta',
    note: 'dados catalográficos',
  };
}

async function searchOpenLibrary(input: GatherInput): Promise<RawSource[]> {
  if (!BOOKISH.includes(input.kind)) return [];
  const q = [input.title, input.hint ?? ''].filter(Boolean).join(' ');
  const data = await getJson<{ docs?: OpenLibraryDoc[] }>(
    `https://openlibrary.org/search.json?limit=3&fields=key,title,author_name,first_publish_year,publisher,publish_year,` +
      `number_of_pages_median,subject,edition_count,language&q=${encodeURIComponent(q)}`
  );
  return (data.docs ?? [])
    .map((doc) => formatOpenLibraryDoc(doc, input.title))
    .filter((s): s is RawSource => s !== null)
    .slice(0, 1);
}

/* ───────────────────────── OpenAlex (crítica acadêmica) ───────────────────────── */

interface OpenAlexWork {
  display_name?: string;
  publication_year?: number;
  cited_by_count?: number;
  doi?: string | null;
  type?: string;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } | null; landing_page_url?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** O OpenAlex entrega o abstract "invertido" (palavra → posições); isto remonta o texto. */
export function reconstructAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) pairs.push([position, word]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(([, word]) => word).join(' ');
}

/**
 * Estudos acadêmicos raramente trazem o título da obra no próprio título ("Machado e o romance
 * da suspeita"), então não aplicamos o filtro de relevância por título: a consulta já é específica.
 * O pesquisador recebe o resumo e pondera o que serve.
 */
export function formatOpenAlexWork(work: OpenAlexWork): RawSource | null {
  if (!work.display_name) return null;
  const authors = (work.authorships ?? [])
    .map((a) => a.author?.display_name)
    .filter((n): n is string => Boolean(n))
    .slice(0, 5);
  const venue = work.primary_location?.source?.display_name;
  const abstract = reconstructAbstract(work.abstract_inverted_index).slice(0, 1_400);
  const lines = [
    `Estudo: ${work.display_name}`,
    authors.length ? `Autoria: ${authors.join('; ')}` : null,
    work.publication_year ? `Ano: ${work.publication_year}` : null,
    venue ? `Publicado em: ${venue}` : null,
    work.type ? `Tipo: ${work.type}` : null,
    typeof work.cited_by_count === 'number' ? `Citações: ${work.cited_by_count}` : null,
    work.doi ? `DOI: ${work.doi}` : null,
    abstract ? `Resumo: ${abstract}` : null,
  ].filter(Boolean);
  return {
    title: `${venue ? `${venue} — ` : ''}${work.display_name}`,
    url: work.doi ?? work.primary_location?.landing_page_url ?? 'https://openalex.org',
    text: lines.join('\n'),
    origin: 'openalex',
    kind: 'academic',
    year: work.publication_year ?? null,
    author: authors.join('; ') || null,
    publisher: venue ?? null,
    reliability: 'média',
    note: typeof work.cited_by_count === 'number' ? `${work.cited_by_count} citações` : 'estudo indexado',
  };
}

async function searchOpenAlex(input: GatherInput): Promise<RawSource[]> {
  const q = [input.title, input.hint ?? ''].filter(Boolean).join(' ');
  const data = await getJson<{ results?: OpenAlexWork[] }>(
    `https://api.openalex.org/works?per-page=5&sort=cited_by_count:desc&search=${encodeURIComponent(q)}`
  );
  return (data.results ?? [])
    .filter((w) => w.type !== 'paratext')
    .map((work) => formatOpenAlexWork(work))
    .filter((s): s is RawSource => s !== null)
    .slice(0, 3);
}

/* ───────────────────────── TMDB (ficha técnica, opcional) ───────────────────────── */

interface TmdbSearch {
  results?: Array<{ id: number; title?: string; name?: string; original_title?: string; release_date?: string; first_air_date?: string }>;
}
interface TmdbDetails {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  vote_average?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  tagline?: string;
  credits?: {
    crew?: Array<{ job?: string; name?: string }>;
    cast?: Array<{ name?: string; character?: string }>;
    created_by?: Array<{ name?: string }>;
  };
  production_companies?: Array<{ name?: string }>;
}

async function searchTmdb(input: GatherInput, apiKey: string): Promise<RawSource[]> {
  if (!['auto', 'film', 'series', 'other'].includes(input.kind)) return [];
  const isTv = input.kind === 'series';
  const query = [input.title, input.hint ?? ''].filter(Boolean).join(' ');
  const lang = 'pt-BR';
  const base = 'https://api.themoviedb.org/3';

  const tryKind = async (kind: 'movie' | 'tv'): Promise<RawSource[]> => {
    const search = await getJson<TmdbSearch>(
      `${base}/search/${kind}?api_key=${encodeURIComponent(apiKey)}&language=${lang}&query=${encodeURIComponent(query)}`
    );
    const hit = (search.results ?? []).find((r) => looksRelevant(input.title, r.title ?? r.name ?? ''));
    if (!hit) return [];
    const details = await getJson<TmdbDetails>(
      `${base}/${kind}/${hit.id}?api_key=${encodeURIComponent(apiKey)}&language=${lang}&append_to_response=credits`
    );
    const release = details.release_date ?? details.first_air_date ?? '';
    const year = Number(release.slice(0, 4)) || null;
    const directors = (details.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name);
    const creators = details.credits?.created_by?.map((c) => c.name) ?? [];
    const cast = (details.credits?.cast ?? []).slice(0, 8).map((c) => `${c.name}${c.character ? ` (${c.character})` : ''}`);
    const runtime = details.runtime ?? details.episode_run_time?.[0];
    const lines = [
      `Título: ${details.title ?? details.name ?? hit.title ?? hit.name ?? input.title}`,
      details.original_title || details.original_name ? `Título original: ${details.original_title ?? details.original_name}` : null,
      year ? `Ano: ${year}` : null,
      directors.length ? `Direção: ${directors.join('; ')}` : null,
      creators.length ? `Criação: ${creators.join('; ')}` : null,
      cast.length ? `Elenco principal: ${cast.join('; ')}` : null,
      runtime ? `Duração: ${runtime} min` : null,
      details.number_of_seasons ? `Temporadas: ${details.number_of_seasons} · Episódios: ${details.number_of_episodes ?? '?'}` : null,
      details.production_companies?.length ? `Produção: ${details.production_companies.slice(0, 4).map((c) => c.name).join('; ')}` : null,
      typeof details.vote_average === 'number' && details.vote_average > 0 ? `Nota média TMDB: ${details.vote_average.toFixed(1)}` : null,
      details.tagline ? `Tagline: ${details.tagline}` : null,
      details.overview ? `Sinopse (TMDB): ${details.overview}` : null,
    ].filter(Boolean);
    return [
      {
        title: `TMDB — ${details.title ?? details.name ?? input.title}`,
        url: `https://www.themoviedb.org/${kind}/${hit.id}`,
        text: lines.join('\n'),
        origin: 'tmdb',
        kind: 'credits',
        year,
        author: (directors.length ? directors : creators).join('; ') || null,
        publisher: details.production_companies?.[0]?.name ?? null,
        reliability: 'média',
        note: 'ficha técnica',
      },
    ];
  };

  if (isTv) return tryKind('tv');
  if (input.kind === 'film') return tryKind('movie');
  // 'auto': tenta filme e, se não houver, série
  const movie: RawSource[] = await tryKind('movie').catch(() => []);
  if (movie.length > 0) return movie;
  return (await tryKind('tv').catch(() => [])).slice(0, 1);
}

/* ───────────────────────── Tavily / Z.ai ───────────────────────── */

async function searchTavily(query: string, apiKey: string): Promise<RawSource[]> {
  const data = await getJson<{ results?: Array<{ title: string; url: string; content: string }> }>(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic', include_answer: false }),
    }
  );
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    text: r.content,
    origin: 'tavily' as const,
    kind: 'review' as const,
    reliability: 'média' as const,
    note: 'web (Tavily)',
  }));
}

async function searchZai(query: string): Promise<RawSource[]> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  const zai = await ZAI.create();
  const results = (await zai.functions.invoke('web_search', { query, num: 6 })) as Array<{
    name: string;
    url: string;
    snippet: string;
    host_name?: string;
  }>;
  return results.map((r) => ({
    title: r.name,
    url: r.url,
    text: r.snippet,
    origin: 'zai' as const,
    kind: 'web' as const,
    reliability: 'baixa' as const,
    note: r.host_name ?? 'web (Z.ai)',
  }));
}

/* ───────────────────────── Orquestração das fontes ───────────────────────── */

/** Fontes habilitadas no ambiente atual (usado por /api/status e pelo painel de configuração). */
export function availableSources(env: NodeJS.ProcessEnv = process.env): SourceOrigin[] {
  const provider = resolveProvider(env);
  const out: SourceOrigin[] = [];
  if (provider === 'mock') return ['user'];
  out.push('wikipedia', 'openlibrary', 'openalex');
  if (env.TMDB_API_KEY) out.push('tmdb');
  if (env.TAVILY_API_KEY) out.push('tavily');
  else if (provider === 'zai') out.push('zai');
  return out;
}

/** Ordem de prioridade ao montar o dossiê: o que é do usuário e o que é fato catalogado vem primeiro. */
const ORIGIN_PRIORITY: Record<SourceOrigin, number> = {
  user: 0,
  openlibrary: 1,
  tmdb: 1,
  wikipedia: 2,
  openalex: 3,
  tavily: 4,
  zai: 5,
};

export async function gatherSources(
  input: GatherInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<GatheredSources> {
  const budget = SOURCE_BUDGET[input.depth];
  const provider = resolveProvider(env);
  const label = [input.title, input.hint].filter(Boolean).join(' ');

  // 1) Fontes do usuário primeiro (são as que ele considera importantes)
  const userSources = input.userSources?.length ? await fetchUserSources(input.userSources) : [];

  if (provider === 'mock') {
    const mock: RawSource = {
      title: `${input.title} — fonte de demonstração`,
      url: 'https://example.com/demo',
      text: 'Conteúdo de demonstração.',
      origin: 'wikipedia',
      kind: 'encyclopedia',
      lang: 'pt',
      reliability: 'baixa',
      note: 'demonstração',
    };
    return format([...userSources, mock], input, budget);
  }

  // 2) Fontes automáticas, em paralelo e com falha tolerada
  const tasks: Array<Promise<RawSource[]>> = [
    searchWikipedia('pt', input, budget.wikipediaChars),
    searchWikipedia('en', input, Math.round(budget.wikipediaChars * 0.66)),
    searchOpenLibrary(input),
    searchOpenAlex(input),
  ];
  if (env.TMDB_API_KEY) tasks.push(searchTmdb(input, env.TMDB_API_KEY));
  if (env.TAVILY_API_KEY) {
    tasks.push(
      searchTavily(`"${label}" análise crítica interpretação tema recepção`, env.TAVILY_API_KEY),
      searchTavily(`"${label}" ${KIND_WORDS[input.kind]} resumo enredo personagens contexto`.trim(), env.TAVILY_API_KEY)
    );
  } else if (provider === 'zai') {
    tasks.push(searchZai(`"${label}" obra resumo enredo personagens`), searchZai(`"${label}" análise crítica recepção`));
  }

  const settled = await Promise.allSettled(tasks);
  const merged: RawSource[] = [...userSources];
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn(
        '[anima] fonte indisponível:',
        result.reason instanceof Error ? result.reason.message : result.reason
      );
      continue;
    }
    merged.push(...result.value);
  }
  return format(merged, input, budget);
}

/** Deduplica, prioriza e monta o contexto do prompt, respeitando o orçamento de caracteres. */
export function format(
  raw: RawSource[],
  input: Pick<GatherInput, 'title' | 'depth'>,
  budget = SOURCE_BUDGET[input.depth]
): GatheredSources {
  const seen = new Set<string>();
  const unique: RawSource[] = [];
  for (const src of raw) {
    if (!src.text?.trim()) continue;
    const dedupeKey = `${src.url}::${normalize(src.title).slice(0, 60)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push(src);
  }

  unique.sort((a, b) => ORIGIN_PRIORITY[a.origin] - ORIGIN_PRIORITY[b.origin]);
  const chosen = unique.slice(0, budget.maxSources);

  const sources: SourceDTO[] = chosen.map((r, i) => ({
    id: `F${i + 1}`,
    title: sanitizeSnippet(r.title, 160),
    url: r.url,
    origin: r.origin,
    kind: r.kind,
    lang: r.lang ?? null,
    year: r.year ?? null,
    author: r.author ? sanitizeSnippet(r.author, 120) : null,
    publisher: r.publisher ? sanitizeSnippet(r.publisher, 120) : null,
    reliability: r.reliability,
    note: r.note ? sanitizeSnippet(r.note, 120) : null,
  }));

  const context = chosen
    .map((r, i) => {
      const chars = r.origin === 'user' ? Math.min(12_000, budget.perSourceChars * 3) : budget.perSourceChars;
      const body = sanitizeSnippet(r.text, chars);
      const attrs = [
        `id="F${i + 1}"`,
        `origem="${r.origin}"`,
        r.kind ? `tipo="${r.kind}"` : null,
        r.reliability ? `confiabilidade="${r.reliability}"` : null,
        r.year ? `ano="${r.year}"` : null,
        `titulo="${sanitizeSnippet(r.title, 120).replace(/"/g, "'")}"`,
        `url="${r.url.replace(/"/g, '%22')}"`,
      ].filter(Boolean);
      return `<fonte ${attrs.join(' ')}>\n${body}\n</fonte>`;
    })
    .join('\n\n');

  return { sources, context, used: [...new Set(chosen.map((s) => s.origin))] };
}
