import type { Metadata } from 'next';
import Link from 'next/link';
import { AGENTS, CURATOR_META, RESEARCHER_META } from '@/lib/anima/agent-meta';
import { AgentShowcaseCard } from '@/components/anima/agent-card';
import { SOURCE_BUDGET } from '@/lib/anima/search';
import { DEPTHS, DEPTH_LABELS } from '@/lib/anima/types';

export const metadata: Metadata = { title: 'Método' };

const PRINCIPLES = [
  [
    'Teoria aplicada, não decorativa',
    'Todo conceito vem com autor e obra, evidência na obra analisada, o que a lente revela e o que ela deixa de ver.',
  ],
  [
    'Camadas de afirmação',
    'Dossiê (fato com fonte), interpretação (do analista) e conhecimento prévio do modelo, este marcado com † para checagem.',
  ],
  ['Pluralidade de leituras', 'Cada analista apresenta ao menos uma leitura concorrente antes de sustentar a sua.'],
  ['Limites explícitos', 'Toda análise termina com nível de confiança, itens a verificar e lentes não exploradas.'],
] as const;

const FLOW = [
  [
    'Fila',
    'Cada pedido entra na hora. Se já houver o máximo de análises rodando (ANIMA_MAX_ACTIVE), ele espera numa fila e começa sozinho — a posição aparece na tela.',
  ],
  [
    'Fontes',
    'O Pesquisador consulta os provedores em paralelo. Um provedor fora do ar não impede os outros: cada falha é registrada e o dossiê segue com o que veio.',
  ],
  [
    'Dossiê',
    'As fontes são tipadas (enciclopédia, ficha catalográfica, crítica acadêmica, crítica de imprensa, enviada por você) e delimitadas como dado — nunca como instrução.',
  ],
  [
    'Especialistas',
    'As lentes rodam com concorrência limitada (LLM_CONCURRENCY). Cada agente grava seu resultado ao terminar, o que permite ler o relatório em construção.',
  ],
  [
    'Síntese',
    'Com pelo menos três lentes concluídas, o Curador costura o conjunto. Menos que isso: a análise termina parcial e diz por quê.',
  ],
  [
    'Interrupção',
    'Você pode cancelar a qualquer momento. As chamadas em curso são abortadas, o texto já escrito fica salvo e a análise pode ser retomada depois.',
  ],
] as const;

const SOURCES = [
  ['Wikipédia (pt/en)', 'Enciclopédia', 'Não', 'Enredo, contexto de produção e recepção documentada.'],
  ['Open Library', 'Ficha bibliográfica', 'Não', 'Autoria, primeira publicação, editoras, páginas, assuntos.'],
  ['OpenAlex', 'Crítica acadêmica', 'Não', 'Artigos e capítulos sobre a obra, com ano, veículo e citações.'],
  ['TMDB', 'Ficha técnica', 'Sim (TMDB_API_KEY)', 'Direção, elenco, duração, temporadas e produção de filmes e séries.'],
  ['Tavily', 'Imprensa e web', 'Sim (TAVILY_API_KEY)', 'Resenhas, entrevistas e ensaios fora do circuito acadêmico.'],
  ['Z.ai web_search', 'Web', 'Só no provedor zai', 'Busca genérica quando não há chave Tavily.'],
  ['Enviadas por você', 'Prioritária', 'Não', 'Links e trechos colados no formulário. O servidor lê a página e descarta scripts.'],
] as const;

export default function MetodoPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
      <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Método</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        O ANIMA organiza a análise narrativa em três etapas — pesquisa factual, leitura por especialistas independentes e
        síntese crítica — dentro de um fluxo que você controla: fontes, recorte, lentes, profundidade e cancelamento. Os
        referenciais abaixo são os que cada prompt oferece ao modelo, que escolhe os pertinentes à obra.
      </p>

      <section className="mt-10" aria-labelledby="principios">
        <h2 id="principios" className="mb-4 font-serif text-2xl font-semibold">
          Princípios de rigor
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map(([t, d]) => (
            <div key={t} className="rounded-xl border bg-card p-5">
              <dt className="font-semibold">{t}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-12" aria-labelledby="fluxo">
        <h2 id="fluxo" className="mb-1 font-serif text-2xl font-semibold">
          Fluxo, do pedido ao relatório
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          O pipeline roda no processo do servidor, com progresso persistido a cada etapa.
        </p>
        <ol className="grid gap-4 sm:grid-cols-2">
          {FLOW.map(([title, text], i) => (
            <li key={title} className="rounded-xl border bg-card p-5">
              <p className="flex items-baseline gap-2 font-semibold">
                <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, '0')}</span> {title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12" aria-labelledby="fontes">
        <h2 id="fontes" className="mb-1 font-serif text-2xl font-semibold">
          Fontes
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          O dossiê é montado com o que estiver disponível. Sem chaves de API, o ANIMA funciona só com as fontes abertas —
          e diz no relatório o que faltou.
        </p>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Provedor</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Tipo</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Chave</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">O que fornece</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SOURCES.map(([name, kind, key, what]) => (
                <tr key={name}>
                  <td className="px-4 py-2.5 font-medium">{name}</td>
                  <td className="px-4 py-2.5">{kind}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{key}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="profundidade">
        <h2 id="profundidade" className="mb-1 font-serif text-2xl font-semibold">
          Profundidade
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
          Profundidade não é só tamanho: muda quanta fonte o pesquisador recebe, o teto de tokens de cada etapa e a
          calibragem do argumento pedida no prompt.
        </p>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Nível</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Por lente</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Fontes no dossiê</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Duração típica</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {DEPTHS.map((d) => (
                <tr key={d}>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{DEPTH_LABELS[d].label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{DEPTH_LABELS[d].description}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {DEPTH_LABELS[d].words[0]}–{DEPTH_LABELS[d].words[1]} palavras
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">até {SOURCE_BUDGET[d].maxSources}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    ≈ {DEPTH_LABELS[d].minutes[0]}–{DEPTH_LABELS[d].minutes[1]} min
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="etapas">
        <h2 id="etapas" className="mb-4 font-serif text-2xl font-semibold">
          Pesquisador e Curador
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[RESEARCHER_META, CURATOR_META].map((m) => (
            <article key={m.name} className="rounded-xl border bg-card p-5">
              <h3 className="flex items-center gap-2 font-semibold">
                <m.icon className="h-4 w-4 text-primary" aria-hidden /> {m.name}{' '}
                <span className="text-sm font-normal text-muted-foreground">· {m.role}</span>
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">{m.tagline}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="especialistas">
        <h2 id="especialistas" className="mb-4 font-serif text-2xl font-semibold">
          Os oito especialistas
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {AGENTS.map((a) => (
            <AgentShowcaseCard key={a.key} agent={a} detailed />
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5" aria-labelledby="limites">
        <h2 id="limites" className="font-serif text-xl font-semibold">
          Limites que você deve conhecer
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm marker:text-primary">
          <li>
            Os modelos não leram ou assistiram à obra nesta tarefa: trabalham com o dossiê e conhecimento prévio, que
            pode conter erros. O que não vem do dossiê é marcado com †.
          </li>
          <li>
            Referências bibliográficas podem estar imprecisas (edição, ano). Verifique antes de citar em trabalhos
            acadêmicos.
          </li>
          <li>As leituras são interpretações fundamentadas, não verdades: obras ricas admitem muitas leituras.</li>
          <li>Obras pouco conhecidas têm dossiês menos confiáveis; o grau de confiança aparece no relatório.</li>
          <li>
            Links que você envia são lidos por um servidor: envie apenas páginas públicas que você tem o direito de
            consultar. Endereços internos e privados são bloqueados.
          </li>
        </ul>
      </section>

      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/" className="text-primary underline underline-offset-2">
          Voltar ao início
        </Link>{' '}
        para pedir uma análise.
      </p>
    </main>
  );
}
