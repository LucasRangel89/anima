'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { SystemStatusDTO } from '@/lib/anima/types';

/** Avisa quando o LLM não está configurado ou está em modo demonstração. */
export function SetupBanner() {
  const [status, setStatus] = useState<SystemStatusDTO | null>(null);

  useEffect(() => {
    fetch('/api/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { status: SystemStatusDTO } | null) => d && setStatus(d.status))
      .catch(() => undefined);
  }, []);

  if (!status?.message) return null;
  const blocking = !status.configured;
  const Icon = blocking ? AlertTriangle : Info;
  return (
    <div
      role="status"
      className={`mx-auto mb-6 flex max-w-xl items-start gap-3 rounded-xl border p-4 text-left text-sm ${
        blocking ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-primary/30 bg-primary/5 text-foreground'
      }`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>{status.message}</p>
    </div>
  );
}
