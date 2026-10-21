'use client';

// ANIMA — página inicial: chamada à ação, painel de especialistas, fluxo e histórico

import { BookOpen, Clapperboard, Search, MonitorPlay, Layers, FileText, Loader2, Sparkles, Trash2, ArrowRight, History as HistoryIcon } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AgentCard } from './agent-card';
import { AGENTS } from '@/lib/anima/agent-meta';
import type { AnalysisSummaryDTO } from '@/lib/anima/types';
import { cn } from '@/lib/utils';

const EXAMPLES: { title: string; icon: typeof BookOpen }[] = [
  { title: 'Dom Casmurro', icon: BookOpen },
  { title: 'Cem Anos de Solidão', icon: BookOpen },
  { title: 'O Senhor dos Anéis', icon: BookOpen },
  { title: 'Interestelar', icon: Clapperboard },
  { title: 'A Origem', icon: Clapperboard },
  { title: 'Breaking Bad', icon: MonitorPlay },
];

const STEPS = [
  {
    icon: Search,
    title: '1 · Pesquisa factual',
    text: 'O Agente Pesquisador busca na web e compila um dossiê da obra: sinopse, personagens e contexto.',
  },
  {
    icon: Layers,
    title: '2 · Especialização paralela',
    text: 'Seis especialistas recebem o dossiê e analisam a obra simultaneamente, cada um no seu domínio.',
  },
  {
    icon: MonitorPlay,
    title: '3 · Acompanhamento ao vivo',
    text: 'Você vê o progresso de cada agente em tempo real, do pesquisador ao último especialista.',
  },
  {
    icon: FileText,
    title: '4 · Relatório consolidado',
    text: 'As seis análises independentes são reunidas em um relatório único, pronto para ler ou baixar.',
  },
];

export function Hero({
  onSubmit,
  loading,
  history,
  onOpenHistory,
  onDeleteHistory,
}: {
  onSubmit: (title: string) => void;
  loading: boolean;
  history: AnalysisSummaryDTO[];
  onOpenHistory: (id: string) => void;
  onDeleteHistory: (id: string) => void;
}) {
  const [title, setTitle] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (t.length >= 2) onSubmit(t);
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
      {/* ===== Chamada principal ===== */}
      <section className="mx-auto max-w-3xl pt-14 pb-4 text-center sm:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Badge
            variant="outline"
            className="mb-6 gap-2 rounded-full border-primary/30 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Sistema multiagente · 7 especialistas de IA
          </Badge>

          <h1 className="font-serif text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-5xl md:text-6xl">
            Uma obra, sete olhares,{' '}
            <span className="text-primary italic">um relatório profundo</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            A ANIMA reúne um pesquisador e seis agentes especialistas —
            estrutura, personagens, temas, estilo, psique e contexto — para
            analisar livros, filmes e séries em profundidade.
          </p>
        </motion.div>

        {/* Formulário */}
        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
          onSubmit={handleSubmit}
          className="mx-auto mt-8 flex max-w-xl flex-col gap-3 sm:flex-row"
        >
          <div className="relative flex-1">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Digite uma obra: livro, filme, série…"
              aria-label="Título da obra a analisar"
              maxLength={160}
              className="h-12 rounded-xl border-border bg-card pl-11 text-base shadow-sm placeholder:italic focus-visible:ring-primary"
            />
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>
          <Button
            type="submit"
            disabled={loading || title.trim().length < 2}
            className="h-12 rounded-xl px-6 text-base font-semibold shadow-md transition-all hover:shadow-lg disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Iniciando…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Analisar obra
              </>
            )}
          </Button>
        </motion.form>

        {/* Exemplos */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.24 }}
          className="mt-5 flex flex-wrap items-center justify-center gap-2"
        >
          <span className="text-xs text-muted-foreground">Experimente:</span>
          {EXAMPLES.map(({ title: t, icon: ExampleIcon }) => (
            <button
              key={t}
              type="button"
              disabled={loading}
              onClick={() => {
                setTitle(t);
                onSubmit(t);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              <ExampleIcon className="h-3.5 w-3.5 text-primary" aria-hidden />
              {t}
            </button>
          ))}
        </motion.div>

        <p className="mt-6 text-xs text-muted-foreground">
          Análise típica em 1–3 minutos · o pesquisador usa fontes da web · os
          especialistas trabalham em paralelo
        </p>
      </section>

      {/* ===== Painel de especialistas ===== */}
      <section className="py-14 sm:py-16" aria-labelledby="painel-heading">
        <div className="mb-8 text-center">
          <h2
            id="painel-heading"
            className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            O Painel de Especialistas
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Seis analistas independentes, cada um com sua própria lente teórica.
            Todos recebem o mesmo dossiê factual — e nunca veem a análise uns
            dos outros.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AGENTS.map((agent, i) => (
            <AgentCard key={agent.key} agent={agent} index={i} />
          ))}
        </div>
      </section>

      {/* ===== Como funciona ===== */}
      <section className="pb-14 sm:pb-16" aria-labelledby="como-heading">
        <div className="mb-8 text-center">
          <h2
            id="como-heading"
            className="font-serif text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Como funciona
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="rounded-xl border bg-card p-5 shadow-sm"
            >
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <step.icon className="h-4.5 w-4.5" aria-hidden />
              </span>
              <p className="text-sm font-semibold">{step.title}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {step.text}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ===== Histórico ===== */}
      {history.length > 0 && (
        <section className="pb-16" aria-labelledby="historico-heading">
          <div className="mb-5 flex items-center gap-2">
            <HistoryIcon className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            <h2
              id="historico-heading"
              className="font-serif text-xl font-semibold tracking-tight"
            >
              Análises recentes
            </h2>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-xl border bg-card shadow-sm nice-scrollbar">
            {history.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'group flex cursor-pointer items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/60',
                  item.status !== 'completed' && item.status !== 'failed' && 'opacity-80'
                )}
                onClick={() => onOpenHistory(item.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenHistory(item.id);
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{format(new Date(item.createdAt), "d 'de' MMM 'de' yyyy, HH:mm", { locale: ptBR })}</span>
                    {item.status === 'completed' && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{item.doneAgents}/{item.totalAgents} especialistas</span>
                        {item.durationMs && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{Math.max(1, Math.round(item.durationMs / 1000))}s</span>
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <HistoryStatusBadge status={item.status} />
                <button
                  type="button"
                  aria-label={`Excluir análise de ${item.title}`}
                  className="rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteHistory(item.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

export function HistoryStatusBadge({ status }: { status: AnalysisSummaryDTO['status'] }) {
  if (status === 'completed')
    return <Badge className="shrink-0 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">Concluída</Badge>;
  if (status === 'failed')
    return <Badge variant="destructive" className="shrink-0">Falhou</Badge>;
  if (status === 'researching')
    return <Badge variant="outline" className="shrink-0 animate-pulse border-primary/40 text-primary">Pesquisando…</Badge>;
  return <Badge variant="outline" className="shrink-0 animate-pulse border-primary/40 text-primary">Analisando…</Badge>;
}
