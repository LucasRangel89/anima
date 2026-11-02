'use client';

// Polling inteligente de uma análise: só enquanto há atividade, pausa com a aba oculta,
// recua em caso de erro de rede e permite forçar atualização imediata (`refresh`).

import { useCallback, useEffect, useRef, useState } from 'react';
import { isActiveStatus, type AnalysisDTO } from '@/lib/anima/types';

export type LoadError = 'not_found' | 'network' | null;

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 15_000;

export function isBusy(a: AnalysisDTO | null): boolean {
  if (!a) return true; // ainda carregando
  return isActiveStatus(a.status) || a.results.some((r) => r.status === 'running');
}

export function useAnalysis(id: string) {
  const [analysis, setAnalysis] = useState<AnalysisDTO | null>(null);
  const [error, setError] = useState<LoadError>(null);
  const [tick, setTick] = useState(0); // incrementar reinicia o ciclo de polling
  const analysisRef = useRef<AnalysisDTO | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const schedule = (ms: number) => {
      if (!cancelled) timer = setTimeout(load, ms);
    };

    async function load() {
      if (cancelled) return;
      if (document.hidden) {
        schedule(POLL_MS); // aba oculta: apenas reagenda, sem requisição
        return;
      }
      try {
        const res = await fetch(`/api/analyses/${id}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 404) {
          setError('not_found');
          return; // sem novo agendamento
        }
        if (!res.ok) throw new Error(String(res.status));
        const data: { analysis: AnalysisDTO } = await res.json();
        if (cancelled) return;
        failures = 0;
        analysisRef.current = data.analysis;
        setAnalysis(data.analysis);
        setError(null);
        if (isBusy(data.analysis)) schedule(POLL_MS);
      } catch {
        if (cancelled) return;
        failures++;
        // com dados já exibidos, mantém a tela e tenta de novo; sem dados, informa o erro
        if (!analysisRef.current) setError('network');
        schedule(Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures));
      }
    }

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id, tick]);

  return { analysis, error, refresh };
}
