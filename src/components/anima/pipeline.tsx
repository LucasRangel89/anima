'use client';

// ANIMA — monitoramento ao vivo do pipeline: Pesquisador -> 6 Especialistas

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { AgentCard } from './agent-card';
import { AGENTS } from '@/lib/anima/agent-meta';
import type { AnalysisDTO } from '@/lib/anima/types';
import { cn } from '@/lib/utils';

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function PipelineView({
  analysis,
  elapsedMs,
  stalled,
  onRetryAll,
  onExit,
}: {
  analysis: AnalysisDTO;
  elapsedMs: number;
  stalled: boolean;
  onRetryAll: () => void;
  onExit: () => void;
}) {
  const researchDone = analysis.researchStatus === 'done';
  const researchRunning = analysis.researchStatus === 'running';
  const researchFailed = analysis.researchStatus === 'failed';

  const doneCount =
    (researchDone ? 1 : 0) + analysis.results.filter((r) => r.status === 'done').length;
  const totalSteps = 1 + AGENTS.length;
  const progress = Math.round((doneCount / totalSteps) * 100);

  const isWorking = !stalled && (researchRunning || analysis.results.some((r) => r.status === 'running'));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      {/* Cabeçalho da análise em andamento */}
      <div className="mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="mb-4 -ml-2 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Início
        </Button>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Análise em andamento
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {analysis.title}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={cn(
                'gap-1.5 px-3 py-1',
                isWorking && 'animate-pulse border-primary/40 text-primary'
              )}
            >
              {researchDone ? 'Especialistas em paralelo' : 'Pesquisador compilando o dossiê'}
            </Badge>
            <span className="font-mono text-sm tabular-nums text-muted-foreground" aria-live="polite">
              {formatElapsed(elapsedMs)}
            </span>
          </div>
        </div>

        <div className="mt-6">
          <Progress value={progress} className="h-2" />
          <p className="mt-2 text-xs text-muted-foreground">
            {doneCount} de {totalSteps} etapas concluídas
            {researchDone ? ' · dossiê pronto, especialistas trabalhando' : ''}
          </p>
        </div>
      </div>

      {/* Agente Pesquisador */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={cn(
          'relative overflow-hidden rounded-xl border bg-card p-5 shadow-sm transition-colors',
          researchRunning && 'border-primary/40 shadow-md',
          researchDone && 'border-emerald-600/30',
          researchFailed && 'border-destructive/40'
        )}
      >
        {researchRunning && (
          <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r from-amber-500 to-orange-500" />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <span
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border',
                researchDone
                  ? 'border-emerald-600/30 bg-emerald-600/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400'
              )}
              aria-hidden
            >
              {researchDone ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : (
                <Search className={cn('h-6 w-6', researchRunning && 'animate-pulse')} />
              )}
            </span>
            <div>
              <p className="font-semibold">Agente Pesquisador</p>
              <p className="text-[13px] text-muted-foreground">
                Busca na web e compila o dossiê factual: sinopse, personagens e contexto.
              </p>
              {researchFailed && (
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {analysis.error || 'A pesquisa falhou.'}
                </p>
              )}
            </div>
          </div>
          <ResearcherStatus status={analysis.researchStatus} />
        </div>
      </motion.div>

      {/* Conector visual */}
      <div className="flex flex-col items-center py-3" aria-hidden>
        <ArrowDown className={cn('h-5 w-5', researchDone ? 'text-emerald-500' : 'text-muted-foreground/50')} />
      </div>

      {/* Grid de especialistas */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent, i) => {
          const result = analysis.results.find((r) => r.agentKey === agent.key);
          return (
            <AgentCard
              key={agent.key}
              agent={agent}
              index={i}
              status={result?.status ?? 'pending'}
              durationMs={result?.durationMs}
              error={result?.error}
            />
          );
        })}
      </div>

      {/* Rodapé da visão */}
      <div className="mt-8">
        {stalled ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> A análise excedeu o tempo esperado.
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Você pode tentar reexecutar os agentes pendentes ou voltar ao início.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" size="sm" onClick={onRetryAll}>
                <RefreshCw className="h-4 w-4" /> Reexecutar
              </Button>
              <Button variant="ghost" size="sm" onClick={onExit}>
                <ArrowLeft className="h-4 w-4" /> Voltar ao início
              </Button>
            </div>
          </div>
        ) : researchFailed ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> A pesquisa inicial falhou — os especialistas dependem dela.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={onRetryAll}>
                <RefreshCw className="h-4 w-4" /> Tentar novamente
              </Button>
              <Button variant="ghost" size="sm" onClick={onExit}>
                <ArrowLeft className="h-4 w-4" /> Voltar ao início
              </Button>
            </div>
          </div>
        ) : (
          <p className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Cada especialista redige de 400 a 700 palavras — a análise completa costuma levar de 1 a 3 minutos.
          </p>
        )}
      </div>
    </main>
  );
}

function ResearcherStatus({ status }: { status: AnalysisDTO['researchStatus'] }) {
  if (status === 'done')
    return (
      <Badge className="gap-1.5 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Dossiê pronto
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge variant="destructive" className="gap-1.5">
        <AlertTriangle className="h-3 w-3" /> Falhou
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1.5 animate-pulse border-primary/40 text-primary">
      <Loader2 className="h-3 w-3 animate-spin" />
      {status === 'running' ? 'Buscando e compilando…' : 'Na fila'}
    </Badge>
  );
}
