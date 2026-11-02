'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Circle, Loader2, MinusCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDuration, wordCount } from '@/lib/anima/format';
import type { AgentColor } from '@/lib/anima/agent-meta';
import { cn } from '@/lib/utils';
import { Prose } from './markdown';

export type SectionState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export function StateIcon({ state, className }: { state: SectionState; className?: string }) {
  const c = cn('h-3.5 w-3.5 shrink-0', className);
  switch (state) {
    case 'done':
      return <CheckCircle2 className={cn(c, 'text-emerald-600 dark:text-emerald-400')} aria-label="concluído" />;
    case 'running':
      return <Loader2 className={cn(c, 'animate-spin text-primary')} aria-label="em andamento" />;
    case 'failed':
      return <AlertTriangle className={cn(c, 'text-destructive')} aria-label="falhou" />;
    case 'skipped':
      return <MinusCircle className={cn(c, 'text-muted-foreground')} aria-label="não gerado" />;
    default:
      return <Circle className={cn(c, 'text-muted-foreground/60')} aria-label="na fila" />;
  }
}

const STATE_TEXT: Record<SectionState, string> = {
  pending: 'Na fila',
  running: 'Redigindo…',
  done: 'Concluído',
  failed: 'Falhou',
  skipped: 'Não gerado',
};

interface Props {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  color: AgentColor;
  state: SectionState;
  content: string | null;
  error: string | null;
  durationMs: number | null;
  open: boolean;
  onToggle: () => void;
  /** Texto do botão de ação quando falhou/não foi gerado (ex.: "Reexecutar este agente") */
  actionLabel?: string;
  onAction?: () => void;
  emptyHint?: string;
  footer?: ReactNode;
  highlight?: boolean;
}

export function SectionCard({
  id, title, subtitle, icon: Icon, color, state, content, error, durationMs,
  open, onToggle, actionLabel, onAction, emptyHint, footer, highlight,
}: Props) {
  const words = wordCount(content);
  const meta = [state === 'done' ? formatDuration(durationMs) : null, state === 'done' && words ? `${words} palavras` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="scroll-mt-36">
      <article className={cn('overflow-hidden rounded-xl border bg-card shadow-sm', highlight && 'border-primary/40 ring-1 ring-primary/20')}>
        <h2 id={`${id}-titulo`} className="m-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`${id}-corpo`}
            className="flex w-full items-center gap-3 border-b bg-muted/40 px-5 py-4 text-left transition-colors hover:bg-muted/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6 print:bg-transparent"
          >
            <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', color.bg, color.border, color.text)} aria-hidden>
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold leading-tight">{title}</span>
              <span className="block text-sm text-muted-foreground">{subtitle}</span>
            </span>
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <StateIcon state={state} />
              {meta || STATE_TEXT[state]}
            </span>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform print:hidden', open && 'rotate-180')} aria-hidden />
          </button>
        </h2>

        <div id={`${id}-corpo`} className={cn('px-5 py-5 sm:px-6 sm:py-6', !open && 'hidden print:block')}>
          {state === 'done' && content ? (
            <Prose content={content} />
          ) : state === 'running' ? (
            <div aria-busy="true" role="status" aria-label={`${title}: redigindo`}>
              <p className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden /> Redigindo a análise…
              </p>
              <div className="space-y-2.5">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          ) : state === 'failed' ? (
            <div className="text-sm">
              <p className="flex items-start gap-2 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{error || 'Esta etapa não foi concluída.'}</span>
              </p>
              {onAction && (
                <Button variant="outline" size="sm" className="mt-3" onClick={onAction}>
                  <RefreshCw aria-hidden /> {actionLabel ?? 'Tentar novamente'}
                </Button>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              <p>{emptyHint ?? (state === 'skipped' ? 'Esta etapa não foi gerada.' : 'Aguardando a vez na fila.')}</p>
              {state === 'skipped' && onAction && (
                <Button variant="outline" size="sm" className="mt-3" onClick={onAction}>
                  <RefreshCw aria-hidden /> {actionLabel ?? 'Gerar agora'}
                </Button>
              )}
            </div>
          )}
          {footer}
        </div>
      </article>
    </section>
  );
}
