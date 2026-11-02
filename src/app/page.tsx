import { AGENTS } from '@/lib/anima/agent-meta';
import { AgentShowcaseCard } from '@/components/anima/agent-card';
import { HistoryList } from '@/components/anima/history-list';
import { NewAnalysisForm } from '@/components/anima/new-analysis-form';
import { SetupBanner } from '@/components/anima/setup-banner';
import Link from 'next/link';

const STEPS = [
  ['1 · Pesquisa', 'O Pesquisador reúne fontes (Wikipédia e, se configurado, web) e compila um dossiê factual com grau de confiança.'],
  ['2 · Especialistas', 'Oito analistas independentes, cada um com sua lente teórica, recebem o mesmo dossiê.'],
  ['3 · Síntese', 'O Curador confronta as análises: convergências, tensões, juízo crítico e controle de consistência.'],
  ['4 · Relatório', 'Leia no navegador enquanto cada parte fica pronta; exporte em Markdown ou imprima.'],
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
      <section className="mx-auto max-w-3xl pb-6 pt-12 text-center sm:pt-16">
        <h1 className="font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl">
          Uma obra, oito lentes, <span className="italic text-primary">uma leitura integrada</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Estrutura, discurso, personagens, temas, estilo, psique, contexto e crítica ideológica: cada análise é ancorada em
          teoria nomeada e acompanhada de seus limites.
        </p>
        <div className="mt-8">
          <SetupBanner />
          <NewAnalysisForm />
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Uma análise leva alguns minutos e você pode ler cada seção assim que ela ficar pronta.
        </p>
      </section>

      <div className="mt-10">
        <HistoryList />
      </div>

      <section className="py-12" aria-labelledby="painel">
        <div className="mb-8 text-center">
          <h2 id="painel" className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            O painel de especialistas
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Analistas independentes: nenhum lê a análise do outro. Só o Curador os confronta.{' '}
            <Link href="/metodo" className="text-primary underline underline-offset-2">
              Ver método e referenciais
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
