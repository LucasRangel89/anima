// ANIMA — coleta de fontes para o Agente Pesquisador.
//
// Fontes (todas tratadas como DADOS NÃO CONFIÁVEIS — nunca como instruções):
//   • Wikipédia (pt + en): gratuita, sem chave. Fornece enredo, contexto e recepção.
//   • Tavily (opcional, TAVILY_API_KEY): resenhas e análises críticas.
//   • z-ai web_search (opcional, apenas provedor zai).

import type { SourceDTO, WorkKind } from './types';
import { withTimeout } from './async-utils';
import { resolveProvider } from './llm';

export interface GatherInput {
  title: string;
  hint?: string | null;
  kind: WorkKind;
}

export interface GatheredSources {
  sources: SourceDTO[];
  /** Fontes formatadas como blocos <fonte> para o prompt do pesquisador. */
  context: string;
}

interface RawSource {
  title: string;
  url: string;
  text: string;
  origin: SourceDTO['origin'];
}

const USER_AGENT = 'ANIMA/0.3 (analisador narrativo; https://github.com/LucasRangel89/anima)';
const SOURCE_TIMEOUT_MS = 12_000;
const MAX_SOURCES = 8;

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

async function searchWikipedia(lang: 'pt' | 'en', input: GatherInput, maxChars: number): Promise<RawSource[]> {
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
      },
    ];
  }
  return [];
}

/* ───────────────────────── Tavily ───────────────────────── */

async function searchTavily(query: string, apiKey: string): Promise<RawSource[]> {
  const data = await getJson<{ results?: Array<{ title: string; url: string; content: string }> }>(
    'https://api.tavily.com/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, max_results: 5, search_depth: 'basic', include_answer: false }),
    }
  );
  return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, text: r.content, origin: 'tavily' as const }));
}

/* ───────────────────────── Z.ai ───────────────────────── */

async function searchZai(query: string): Promise<RawSource[]> {
  const { default: ZAI } = await import('z-ai-web-dev-sdk');
  const zai = await ZAI.create();
  const results = (await zai.functions.invoke('web_search', { query, num: 6 })) as Array<{
    name: string;
    url: string;
    snippet: string;
    host_name?: string;
  }>;
  return results.map((r) => ({ title: r.name, url: r.url, text: r.snippet, origin: 'zai' as const }));
}

/* ───────────────────────── Orquestração das fontes ───────────────────────── */

export async function gatherSources(
  input: GatherInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<GatheredSources> {
  const provider = resolveProvider(env);
  if (provider === 'mock') {
    const mock: RawSource = {
      title: `${input.title} — fonte de demonstração`,
      url: 'https://example.com/demo',
      text: 'Conteúdo de demonstração.',
      origin: 'wikipedia',
    };
    return format([mock]);
  }

  const label = [input.title, input.hint].filter(Boolean).join(' ');
  const tasks: Array<Promise<RawSource[]>> = [
    searchWikipedia('pt', input, 9_000),
    searchWikipedia('en', input, 6_000),
  ];
  if (env.TAVILY_API_KEY) {
    tasks.push(
      searchTavily(`"${label}" análise crítica interpretação tema recepção`, env.TAVILY_API_KEY),
      searchTavily(`"${label}" ${KIND_WORDS[input.kind]} resumo enredo personagens contexto`.trim(), env.TAVILY_API_KEY)
    );
  } else if (provider === 'zai') {
    tasks.push(searchZai(`"${label}" obra resumo enredo personagens`), searchZai(`"${label}" análise crítica recepção`));
  }

  const settled = await Promise.allSettled(tasks);
  const seen = new Set<string>();
  const merged: RawSource[] = [];
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn('[anima] fonte indisponível:', result.reason instanceof Error ? result.reason.message : result.reason);
      continue;
    }
    for (const src of result.value) {
      if (!src.url || seen.has(src.url) || !src.text?.trim()) continue;
      seen.add(src.url);
      merged.push(src);
    }
  }
  return format(merged.slice(0, MAX_SOURCES));
}

function format(raw: RawSource[]): GatheredSources {
  const sources: SourceDTO[] = raw.map((r, i) => ({
    id: `F${i + 1}`,
    title: sanitizeSnippet(r.title, 160),
    url: r.url,
    origin: r.origin,
  }));
  const context = raw
    .map((r, i) => {
      const body = sanitizeSnippet(r.text, r.origin === 'wikipedia' ? 9_000 : 900);
      return `<fonte id="F${i + 1}" origem="${r.origin}" titulo="${sanitizeSnippet(r.title, 120).replace(/"/g, "'")}" url="${r.url}">\n${body}\n</fonte>`;
    })
    .join('\n\n');
  return { sources, context };
}
