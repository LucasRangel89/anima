// ANIMA — verificação da coleta de fontes contra respostas REAIS dos provedores (fixtures).
//
// O ambiente de desenvolvimento não tem acesso a Wikipédia/OpenLibrary/OpenAlex, então
// substituímos `globalThis.fetch` por um roteador que devolve o formato documentado de cada API.
// Isso executa o caminho de código real (URL, parsing, dedupe, orçamento, formatação do prompt).

import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherSources, SOURCE_BUDGET } from '../src/lib/anima/search';

const WIKI_EXTRACT =
  'Dom Casmurro é um romance escrito por Machado de Assis, publicado em 1899 pela Livraria Garnier. ' +
  'Narrado em primeira pessoa por Bento Santiago, o livro retrata a história de amor entre Bento e Capitu, ' +
  'e a suspeita de traição que atravessa o relato. A obra é considerada um marco do Realismo brasileiro e ' +
  'é objeto de vasta fortuna crítica, com leituras que vão da condenação de Capitu à suspeita do próprio narrador.';

interface Route {
  url: string;
  status?: number;
  json: unknown;
}

let routes: Route[] = [];
const originalFetch = globalThis.fetch;
let calls: string[] = [];

function installFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const match = routes.find((r) => url.startsWith(r.url));
    if (!match) {
      return new Response(JSON.stringify({ error: 'rota não mapeada', url }), { status: 404 });
    }
    void init;
    return new Response(JSON.stringify(match.json), {
      status: match.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function standardRoutes(): Route[] {
  return [
    {
      url: 'https://pt.wikipedia.org/w/api.php?action=query&list=search',
      json: { query: { search: [{ title: 'Dom Casmurro' }] } },
    },
    {
      url: 'https://pt.wikipedia.org/w/api.php?action=query&prop=extracts',
      json: {
        query: {
          pages: {
            '1': {
              title: 'Dom Casmurro',
              extract: WIKI_EXTRACT,
              fullurl: 'https://pt.wikipedia.org/wiki/Dom_Casmurro',
            },
          },
        },
      },
    },
    {
      url: 'https://en.wikipedia.org/w/api.php?action=query&list=search',
      json: { query: { search: [] } },
    },
    {
      url: 'https://openlibrary.org/search.json',
      json: {
        docs: [
          {
            key: '/works/OL76837W',
            title: 'Dom Casmurro',
            author_name: ['Machado de Assis'],
            first_publish_year: 1899,
            publisher: ['Garnier'],
            number_of_pages_median: 256,
            edition_count: 320,
            language: ['por'],
            subject: ['Brazilian fiction', 'Jealousy'],
          },
        ],
      },
    },
    {
      url: 'https://api.openalex.org/works',
      json: {
        results: [
          {
            display_name: 'Dom Casmurro and the poetics of suspicion',
            publication_year: 2001,
            cited_by_count: 42,
            doi: 'https://doi.org/10.1/abc',
            type: 'article',
            authorships: [{ author: { display_name: 'J. Silva' } }],
            primary_location: { source: { display_name: 'Luso-Brazilian Review' } },
            abstract_inverted_index: { Dom: [0], Casmurro: [1], turns: [2], suspicion: [3], into: [4], method: [5] },
          },
        ],
      },
    },
  ];
}

beforeEach(() => {
  routes = standardRoutes();
  calls = [];
  installFetch();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const env = { LLM_PROVIDER: 'openai', LLM_API_KEY: 'test' } as unknown as NodeJS.ProcessEnv;

test('gatherSources monta o dossiê com os quatro provedores abertos', async () => {
  const out = await gatherSources({ title: 'Dom Casmurro', hint: 'Machado de Assis, 1899', kind: 'book', depth: 'standard' }, env);

  const origins = out.sources.map((s) => s.origin);
  assert.ok(origins.includes('wikipedia'), 'faltou Wikipédia');
  assert.ok(origins.includes('openlibrary'), 'faltou Open Library');
  assert.ok(origins.includes('openalex'), 'faltou OpenAlex');

  // prioridade: ficha catalográfica antes da enciclopédia; enciclopédia antes da crítica acadêmica
  assert.deepEqual(origins, ['openlibrary', 'wikipedia', 'openalex']);

  const ol = out.sources.find((s) => s.origin === 'openlibrary')!;
  assert.equal(ol.kind, 'bibliography');
  assert.equal(ol.year, 1899);
  assert.equal(ol.author, 'Machado de Assis');
  assert.equal(ol.reliability, 'alta');

  const oa = out.sources.find((s) => s.origin === 'openalex')!;
  assert.equal(oa.kind, 'academic');
  assert.equal(oa.note, '42 citações');

  // o contexto entregue ao pesquisador carrega os atributos que ensinam a hierarquizar
  assert.match(out.context, /<fonte id="F1" origem="openlibrary" tipo="bibliography" confiabilidade="alta" ano="1899"/);
  assert.match(out.context, /Dom Casmurro é um romance escrito por Machado de Assis/);
  // nenhuma fonte pode crescer além do orçamento da profundidade
  assert.ok(out.context.length <= 20_000, `contexto grande demais: ${out.context.length}`);
});

test('o orçamento de caracteres por fonte corta textos longos conforme a profundidade', async () => {
  // O orçamento só morde quando a fonte é maior que ele: usamos um extrato de ~30 mil caracteres,
  // que é o tamanho real de verbetes de obras canônicas na Wikipédia.
  const longExtract = `${WIKI_EXTRACT} `.repeat(80);
  assert.ok(longExtract.length > 25_000, `fixture curta demais: ${longExtract.length}`);

  routes = standardRoutes().map((r) =>
    r.url.includes('prop=extracts')
      ? { ...r, json: { query: { pages: { '1': { title: 'Dom Casmurro', extract: longExtract, fullurl: 'https://pt.wikipedia.org/wiki/Dom_Casmurro' } } } } }
      : r
  );
  const brief = await gatherSources({ title: 'Dom Casmurro', kind: 'book', depth: 'brief' }, env);
  routes = standardRoutes().map((r) =>
    r.url.includes('prop=extracts')
      ? { ...r, json: { query: { pages: { '1': { title: 'Dom Casmurro', extract: longExtract, fullurl: 'https://pt.wikipedia.org/wiki/Dom_Casmurro' } } } } }
      : r
  );
  const exhaustive = await gatherSources({ title: 'Dom Casmurro', kind: 'book', depth: 'exhaustive' }, env);

  assert.equal(SOURCE_BUDGET.brief.maxSources < SOURCE_BUDGET.exhaustive.maxSources, true);

  /** Corpo de uma <fonte> (sem a tag de abertura e sem as quebras de linha do delimitador). */
  const bodyChars = (ctx: string, origin: string) => {
    for (const chunk of ctx.split('<fonte ')) {
      if (!chunk.includes(`origem="${origin}"`)) continue;
      const open = chunk.indexOf('>');
      const body = chunk.slice(open + 1, chunk.indexOf('</fonte>'));
      if (body) return body.trim().length;
    }
    return 0;
  };
  const briefChars = bodyChars(brief.context, 'wikipedia');
  const exhaustiveChars = bodyChars(exhaustive.context, 'wikipedia');

  assert.ok(briefChars > 0 && exhaustiveChars > 0, 'a fonte da Wikipédia deveria estar nos dois casos');
  assert.ok(briefChars <= SOURCE_BUDGET.brief.perSourceChars, `brief=${briefChars}`);
  assert.ok(exhaustiveChars <= SOURCE_BUDGET.exhaustive.perSourceChars, `exhaustive=${exhaustiveChars}`);
  assert.ok(briefChars < exhaustiveChars, `brief=${briefChars} deveria ser menor que exhaustive=${exhaustiveChars}`);
});

test('um provedor fora do ar não derruba os outros e não aparece na lista', async () => {
  routes = standardRoutes().map((r) =>
    r.url.includes('openlibrary.org') ? { ...r, status: 503 } : r
  );

  const out = await gatherSources({ title: 'Dom Casmurro', kind: 'book', depth: 'standard' }, env);
  assert.equal(out.sources.some((s) => s.origin === 'openlibrary'), false);
  assert.ok(out.sources.length >= 2);
  assert.ok(out.sources.some((s) => s.origin === 'wikipedia'));
});

test('sem nenhuma fonte, o contexto fica vazio e a análise pode seguir com aviso', async () => {
  routes = [];
  const out = await gatherSources({ title: 'Obra Inexistente XYZ', kind: 'other', depth: 'brief' }, env);
  assert.equal(out.sources.length, 0);
  assert.equal(out.context, '');
});

test('o provedor mock não faz chamadas de rede', async () => {
  calls = [];
  const out = await gatherSources(
    { title: 'Dom Casmurro', kind: 'book', depth: 'standard' },
    { LLM_PROVIDER: 'mock' } as unknown as NodeJS.ProcessEnv
  );
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0].origin, 'wikipedia');
  assert.equal(calls.length, 0, `houve chamadas de rede: ${calls.join(', ')}`);
});

test('a página de desambiguação da Wikipédia é descartada', async () => {
  routes = standardRoutes().map((r) =>
    r.url.includes('prop=extracts')
      ? {
          ...r,
          json: {
            query: {
              pages: {
                '1': {
                  title: 'Dom Casmurro',
                  extract:
                    'Dom Casmurro pode referir-se a: o romance de Machado de Assis; a minissérie de 1999; ' +
                    'o filme de 2003. Esta é uma página de desambiguação que lista os artigos que podem ser ' +
                    'associados a um mesmo título. Se uma ligação interna o conduziu até aqui, sugerimos que a ' +
                    'corrija para apontar para o artigo pretendido.',
                  fullurl: 'https://pt.wikipedia.org/wiki/Dom_Casmurro',
                },
              },
            },
          },
        }
      : r
  );

  const out = await gatherSources({ title: 'Dom Casmurro', kind: 'book', depth: 'standard' }, env);
  assert.equal(out.sources.some((s) => s.origin === 'wikipedia'), false);
});
