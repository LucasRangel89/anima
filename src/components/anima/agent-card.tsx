'use client';

// ANIMA — cartão de agente especialista (vitrine e monitoramento ao vivo)

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
} from 'lucide-react';
import type { AgentMeta } from '@/lib/anima/agent-meta';
import type { AgentStatus } from '@/lib/anima/types';
import { cn } from '@/lib/utils';

function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms < 0) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function AgentCard({
  agent,
  status = 'showcase',
  durationMs,
  error,
  index = 0,
}: {
  agent: AgentMeta;
  status?: AgentStatus | 'showcase';
  durationMs?: number | null;
  error?: string | null;
  index?: number;
}) {
  const Icon = agent.icon;
  const isShowcase = status === 'showcase';
  const isRunning = status === 'running';
  const isDone = status === 'done';
  const isFailed = status === 'failed';
  const isPending = status === 'pending';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: 'easeOut' }}
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all duration-300',
        isShowcase && 'hover:-translate-y-0.5 hover:shadow-md',
        isPending && 'opacity-60',
        isRunning && 'border-primary/40 shadow-md',
        isDone && cn(agent.color.border, 'shadow-sm'),
        isFailed && 'border-destructive/40'
      )}
    >
      {/* barra superior animada quando o agente está trabalhando */}
      {isRunning && (
        <div
          className={cn(
            'absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r',
            agent.color.gradient
          )}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
              agent.color.bg,
              agent.color.border,
              agent.color.text
            )}
            aria-hidden
          >
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold leading-tight">{agent.name}</p>
            <p
              className={cn(
                'text-[11px] font-medium uppercase tracking-wider',
                agent.color.text
              )}
            >
              {agent.role}
            </p>
          </div>
        </div>

        {!isShowcase && (
          <StatusBadge status={status} durationMs={durationMs} />
        )}
      </div>

      {isShowcase && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          {agent.tagline}
        </p>
      )}

      {isRunning && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          Redigindo a análise…
        </p>
      )}

      {isFailed && (
        <p className="mt-3 flex items-start gap-2 text-[13px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">
            {error || 'Falha inesperada neste agente.'}
          </span>
        </p>
      )}
    </motion.div>
  );
}

function StatusBadge({
  status,
  durationMs,
}: {
  status: AgentStatus;
  durationMs?: number | null;
}) {
  if (status === 'pending') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
        <Clock className="h-3 w-3" /> Na fila
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
        <Loader2 className="h-3 w-3 animate-spin" /> Analisando
      </span>
    );
  }
  if (status === 'done') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-600/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        {formatDuration(durationMs) ? `Concluído · ${formatDuration(durationMs)}` : 'Concluído'}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
      <AlertTriangle className="h-3 w-3" /> Falhou
    </span>
  );
}
