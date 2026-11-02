import { AGENTS } from '@/lib/anima/agent-meta';
import { AgentShowcaseCard } from '@/components/anima/agent-card';
import { HistoryList } from '@/components/anima/history-list';
import { NewAnalysisForm } from '@/components/anima/new-analysis-form';
import { SetupBanner } from '@/components/anima/setup-banner';
import { asDepth, asWorkKind, isAgentKey, type AgentKey } from '@/lib/anima/types';
import Link from 'next/link';

const STEPS = [
  [
    '1 · Fontes',
    'O Pesquisador cruza Wikipédia, Open Library (ficha bibliográfica), OpenAlex (crítica acadêmica), ficha técnica de filmes e séries — e o que você enviar.',
  ],
  [
    '2 · Dossiê',
    'As fontes viram um dossiê factual com tipo e confiabilidade explícitos. O que falta é declarado como lacuna, não inventado.',
  ],
  [
    '3 · Especialistas',
    'As lentes escolhidas analisam em paralelo, com concorrência limitada. Falha de uma lente não derruba o relatório.',
  ],
  [
    '4 · Síntese',
    'O Curador confronta as análises: convergências, tensões, juízo crítico e controle de consistência.',
  ],
] as const;

const SCOPE = [
  ['Recorte', 'Peça a análise de um capítulo, uma temporada, uma personagem ou um aspecto específico.'],
  ['Lentes', 'Rode as oito ou só as que interessam — menos lentes custam menos e respondem mais rápido.'],
  ['Profundidade', 'De um panorama de 350 palavras por lente a quase um ensaio de 2.400.'],
] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));

/** Aceita `/?titulo=…&recorte=…&lentes=…` para ajustar uma análise anterior sem retrabalho. */
function readInitial(search: Record<string, string | string[] | undefined>) {
  const lenses = first(search.lentes).split(',').filter(isAgentKey);
  const title = first(search.titulo).slice(0, 160);
  if (!title) return undefined;
  return {
    title,
    hint: first(search.dica).slice(0, 120),
    focus: first(search.recorte).slice(0, 200),
    kind: asWorkKind(first(search.meio)),
    depth: asDepth(first(search.profundidade)),
    lenses: lenses.length > 0 ? (lenses as AgentKey[]) : undefined,
  };
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const initial = readInitial(await searchParams);
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
      <section className="mx-auto max-w-3xl pb-6 pt-12 text-center sm:pt-16">
        <h1 className="font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">
          Uma obra, oito lentes, <span className="italic text-primary">uma leitura integrada</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Estrutura, discurso, personagens, temas, estilo, psique, contexto e crítica ideológica: cada análise é ancorada
          em teoria nomeada, em fontes verificáveis e nos próprios limites.
        </p>
        <div className="mt-8">
          <SetupBanner />
          <NewAnalysisForm initial={initial} />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Uma análise leva de 2 a 30 minutos, conforme a profundidade. Você pode ler cada seção assim que ela fica
          pronta e fechar a página sem perder o trabalho.
        </p>
      </section>

      <div className="mt-10">
        <HistoryList />
      </div>

      <section className="pb-14" aria-labelledby="escopo">
        <h2 id="escopo" className="mb-2 text-center font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
          Escopo sob controle
        </h2>
        <p className="mx-auto mb-6 max-w-xl text-center text-sm text-muted-foreground">
          A análise não precisa ser do tamanho da obra inteira nem do custo de uma varredura completa.
        </p>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {SCOPE.map(([title, text]) => (
            <div key={title} className="rounded-xl border bg-card p-5 shadow-sm">
              <dt className="font-medium">{title}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="py-12" aria-labelledby="painel">
        <div className="mb-8 text-center">
          <h2 id="painel" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            O painel de especialistas
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Analistas independentes: nenhum lê a análise do outro. Só o Curador os confronta.{' '}
            <Link href="/metodo" className="text-primary underline underline-offset-2">
              Ver método, fontes e profundidades
            </Link>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map((agent) => (
            <AgentShowcaseCard key={agent.key} agent={agent} />
          ))}
        </div>
      </section>

      <section className="pb-16" aria-labelledby="como">
        <h2 id="como" className="mb-6 text-center font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
          Como funciona
        </h2>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, text]) => (
            <li key={title} className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
