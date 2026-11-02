'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { History, Loader2, Trash2 } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatDuration } from '@/lib/anima/format';
import { DEPTH_LABELS, WORK_KIND_LABELS, isActiveStatus, type AnalysisSummaryDTO } from '@/lib/anima/types';

export function StatusBadge({ status }: { status: AnalysisSummaryDTO['status'] }) {
  switch (status) {
    case 'completed':
      return <Badge className="bg-emerald-600/15 text-emerald-800 dark:text-emerald-300">Concluída</Badge>;
    case 'failed':
      return <Badge variant="destructive">Falhou</Badge>;
    case 'interrupted':
      return <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">Interrompida</Badge>;
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

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analyses', { cache: 'no-store' });
      if (res.ok) setItems(((await res.json()) as { analyses: AnalysisSummaryDTO[] }).analyses);
      else setItems((prev) => prev ?? []);
    } catch {
      setItems((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/analyses', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { analyses: [] }))
      .catch(() => ({ analyses: [] }))
      .then((d: { analyses: AnalysisSummaryDTO[] }) => alive && setItems(d.analyses));
    return () => {
      alive = false;
    };
  }, []);

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

  if (items === null) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Carregando histórico">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="historico" className="pb-16">
      <h2 id="historico" className="mb-4 flex items-center gap-2 font-serif text-xl font-semibold">
        <History className="h-5 w-5 text-muted-foreground" aria-hidden /> Análises recentes
      </h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 pr-2 transition-colors hover:bg-muted/50">
            <Link href={`/analise/${item.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{item.title}</span>
                <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                  {formatDate(item.createdAt, "d MMM yyyy, HH:mm")} · {WORK_KIND_LABELS[item.kind]} · {DEPTH_LABELS[item.depth].label}
                  {item.status === 'completed' && ` · ${item.doneAgents}/${item.totalAgents} especialistas`}
                  {item.status === 'completed' && formatDuration(item.durationMs) && ` · ${formatDuration(item.durationMs)}`}
                </span>
              </span>
              <StatusBadge status={item.status} />
            </Link>
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
                    O relatório de “{item.title}” será apagado permanentemente. Gerar de novo consome chamadas de API.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void remove(item.id)}>Excluir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    </section>
  );
}
