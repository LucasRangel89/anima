'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info, Layers } from 'lucide-react';
import { SOURCE_ORIGIN_LABELS, type SystemStatusDTO } from '@/lib/anima/types';

/** Avisa quando o LLM não está configurado/modo demonstração e resume o que está ativo. */
export function SetupBanner() {
  const [status, setStatus] = useState<SystemStatusDTO | null>(null);

  useEffect(() => {
    fetch('/api/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status: SystemStatusDTO } | null) => d && setStatus(d.status))
      .catch(() => undefined);
  }, []);

  if (!status) return null;

  if (status.message) {
    const blocking = !status.configured;
    const Icon = blocking ? AlertTriangle : Info;
    return (
      <div
        role="status"
        className={`mx-auto mb-6 flex max-w-xl items-start gap-3 rounded-xl border p-4 text-left text-sm ${
          blocking
            ? 'border-destructive/40 bg-destructive/5 text-destructive'
            : 'border-primary/30 bg-primary/5 text-foreground'
        }`}
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{status.message}</p>
      </div>
    );
  }

  const sources = status.sources.length > 0 ? status.sources.map((s) => SOURCE_ORIGIN_LABELS[s]).join(' · ') : 'nenhuma';
  return (
    <div
      role="status"
      className="mx-auto mb-6 flex max-w-xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border bg-card/60 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        {status.provider === 'zai' ? 'Z.ai' : status.provider}
        {status.model && status.model !== 'mock' ? ` · ${status.model}` : ''}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5" aria-hidden /> {sources}
      </span>
      {status.queue.max > 0 && (
        <span>
          {status.queue.active}/{status.queue.max} em execução
          {status.queue.waiting > 0 ? ` · ${status.queue.waiting} na fila` : ''}
        </span>
      )}
    </div>
  );
}
