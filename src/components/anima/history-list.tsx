'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { History, Loader2, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatDuration } from '@/lib/anima/format';
import {
  DEPTH_LABELS,
  WORK_KINDS,
  WORK_KIND_LABELS,
  isActiveStatus,
  type AnalysisSummaryDTO,
  type WorkKind,
} from '@/lib/anima/types';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Em andamento' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'failed', label: 'Com problema' },
];

export function StatusBadge({
  status,
  queuePosition,
}: {
  status: AnalysisSummaryDTO['status'];
  queuePosition?: number | null;
}) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-emerald-600/15 text-emerald-800 dark:text-emerald-300">Concluída</Badge>;
    case 'failed':
      return <Badge variant="destructive">Falhou</Badge>;
    case 'interrupted':
      return (
        <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">
          Interrompida
        </Badge>
      );
    case 'queued':
      return (
        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
          <Loader2 className="animate-spin" aria-hidden /> Na fila{queuePosition ? ` · ${queuePosition}º` : ''}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
          <Loader2 className="animate-spin" aria-hidden /> Em andamento
        </Badge>
      );
  }
}

export function HistoryList() {
  const [items, setItems] = useState<AnalysisSummaryDTO[] | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [kind, setKind] = useState<WorkKind | 'all'>('all');

  const query = useCallback(() => {
    const params = new URLSearchParams({ status, kind, limit: '30' });
    return `/api/analyses?${params.toString()}`;
  }, [status, kind]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(query(), { cache: 'no-store' });
      if (res.ok) setItems(((await res.json()) as { analyses: AnalysisSummaryDTO[] }).analyses);
      else setItems((prev) => prev ?? []);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, [query]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(query(), { cache: 'no-store', signal: controller.signal });
        const data = res.ok ? ((await res.json()) as { analyses: AnalysisSummaryDTO[] }) : { analyses: [] };
        if (alive) setItems(data.analyses);
      } catch {
        if (alive) setItems((prev) => prev ?? []);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [query]);

  // atualiza enquanto houver análise em andamento
  const hasActive = items?.some((i) => isActiveStatus(i.status)) ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [hasActive, load]);

  async function remove(id: string) {
    const res = await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 404) {
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev);
      toast.success('Análise excluída.');
    } else {
      toast.error('Não foi possível excluir.');
    }
  }

  async function cancel(id: string) {
    const res = await fetch(`/api/analyses/${id}/cancel`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return void toast.error(data.error ?? 'Não foi possível cancelar.');
    toast.success(data.message ?? 'Análise cancelada.');
    void load();
  }

  if (items === null) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Carregando histórico">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <section aria-labelledby="historico" className="pb-16">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="historico" className="flex items-center gap-2 font-serif text-xl font-semibold">
          <History className="h-5 w-5 text-muted-foreground" aria-hidden /> Análises recentes
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filtrar por situação" className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                aria-pressed={status === f.value}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  status === f.value
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="filtro-meio">
            Filtrar por meio
          </label>
          <select
            id="filtro-meio"
            value={kind}
            onChange={(e) => setKind(e.target.value as WorkKind | 'all')}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs"
          >
            <option value="all">Todos os meios</option>
            {WORK_KINDS.map((k) => (
              <option key={k} value={k}>
                {WORK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {status === 'all' && kind === 'all'
            ? 'Nenhuma análise ainda. A primeira aparece aqui.'
            : 'Nenhuma análise com esses filtros.'}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {items.map((item) => {
            const active = isActiveStatus(item.status);
            return (
              <li key={item.id} className="group flex items-center gap-2 pr-2 transition-colors hover:bg-muted/50">
                <Link
                  href={`/analise/${item.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {formatDate(item.createdAt, 'd MMM yyyy, HH:mm')} · {WORK_KIND_LABELS[item.kind]} ·{' '}
                      {DEPTH_LABELS[item.depth].label}
                      {item.focus && ` · recorte: ${item.focus}`}
                      {item.status === 'completed' &&
                        ` · ${item.doneAgents}/${item.totalAgents} lentes`}
                      {item.status === 'completed' && formatDuration(item.durationMs) && ` · ${formatDuration(item.durationMs)}`}
                    </span>
                    {active && (
                      <span className="mt-1.5 flex items-center gap-2">
                        <Progress value={item.progress} className="h-1 w-32" aria-label={`${item.progress}% concluído`} />
                        <span className="text-xs tabular-nums text-muted-foreground">{item.progress}%</span>
                      </span>
                    )}
                  </span>
                  <StatusBadge status={item.status} queuePosition={item.queuePosition} />
                </Link>

                {active && (
                  <button
                    type="button"
                    onClick={() => void cancel(item.id)}
                    aria-label={`Cancelar análise de ${item.title}`}
                    className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <XCircle className="h-4 w-4" aria-hidden />
                  </button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Excluir análise de ${item.title}`}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir esta análise?</AlertDialogTitle>
                      <AlertDialogDescription>
                        O relatório de “{item.title}” será apagado permanentemente. Gerar de novo consome chamadas de
                        API.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void remove(item.id)}>Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
