import type { Metadata } from 'next';
import { AGENTS, CURATOR_META, RESEARCHER_META } from '@/lib/anima/agent-meta';
import { AgentShowcaseCard } from '@/components/anima/agent-card';

export const metadata: Metadata = { title: 'Método' };

const PRINCIPLES = [
  ['Teoria aplicada, não decorativa', 'Todo conceito vem com autor e obra, evidência na obra analisada, o que a lente revela e o que ela deixa de ver.'],
  ['Três camadas de afirmação', 'Dossiê (fatos com fonte), interpretação (do analista) e conhecimento prévio do modelo, este marcado com † para checagem.'],
  ['Pluralidade de leituras', 'Cada analista apresenta ao menos uma leitura concorrente antes de sustentar a sua.'],
  ['Limites explícitos', 'Toda análise termina com nível de confiança, itens a verificar e lentes não exploradas.'],
] as const;

export default function MetodoPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Método</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        O ANIMA organiza a análise narrativa em três etapas: pesquisa factual, leitura por especialistas independentes e
        síntese crítica. Os referenciais abaixo são os que cada prompt oferece ao modelo, que escolhe os pertinentes à obra.
      </p>

      <section className="mt-10" aria-labelledby="principios">
        <h2 id="principios" className="mb-4 font-serif text-2xl font-semibold">Princípios de rigor</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(([t, d]) => (
            <div key={t} className="rounded-xl border bg-card p-5">
              <dt className="font-semibold">{t}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12" aria-labelledby="etapas">
        <h2 id="etapas" className="mb-4 font-serif text-2xl font-semibold">Pesquisador e Curador</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[RESEARCHER_META, CURATOR_META].map((m) => (
            <article key={m.name} className="rounded-xl border bg-card p-5">
              <h3 className="flex items-center gap-2 font-semibold"><m.icon className="h-4 w-4 text-primary" aria-hidden /> {m.name} <span className="text-sm font-normal text-muted-foreground">· {m.role}</span></h3>
              <p className="mt-2 text-sm text-muted-foreground">{m.tagline}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="especialistas">
        <h2 id="especialistas" className="mb-4 font-serif text-2xl font-semibold">Os oito especialistas</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {AGENTS.map((a) => (
            <AgentShowcaseCard key={a.key} agent={a} detailed />
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5" aria-labelledby="limites">
        <h2 id="limites" className="font-serif text-xl font-semibold">Limites que você deve conhecer</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm marker:text-primary">
          <li>Os modelos não leram ou assistiram à obra nesta tarefa: trabalham com o dossiê e conhecimento prévio, que pode conter erros.</li>
          <li>Referências bibliográficas podem estar imprecisas (edição, ano). Verifique antes de citar em trabalhos acadêmicos.</li>
          <li>As leituras são interpretações fundamentadas, não verdades: obras ricas admitem muitas leituras.</li>
          <li>Obras pouco conhecidas têm dossiês menos confiáveis; o grau de confiança aparece no relatório.</li>
        </ul>
      </section>
    </main>
  );
}
