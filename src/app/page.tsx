'use client';

// ANIMA — página principal: orquestra as visões (início, monitoramento, relatório)

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/anima/theme-toggle';
import { Hero } from '@/components/anima/hero';
import { PipelineView } from '@/components/anima/pipeline';
import { ReportView } from '@/components/anima/report';
import type { AnalysisDTO, AnalysisSummaryDTO } from '@/lib/anima/types';

const POLL_INTERVAL_MS = 1600;
const STALL_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutos

function isTerminal(a: AnalysisDTO): boolean {
  return (
    (a.status === 'completed' || a.status === 'failed') &&
    !a.results.some((r) => r.status === 'running')
  );
}

export default function Home() {
  const [view, setView] = useState<'idle' | 'live'>('idle');
  const [analysis, setAnalysis] = useState<AnalysisDTO | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<AnalysisSummaryDTO[]>([]);
  const [stalled, setStalled] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /* ===== Histórico ===== */
  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/analyses', { cache: 'no-store' });
      if (res.ok) {
        const data: { analyses: AnalysisSummaryDTO[] } = await res.json();
        setHistory(data.analyses);
      }
    } catch {
      /* silencioso */
    }
  }, []);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  /* ===== Polling da análise ativa ===== */
  const terminalRef = useRef(false);
  useEffect(() => {
    if (!activeId) return;
    terminalRef.current = false;
    let stopped = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/analyses/${activeId}`, { cache: 'no-store' });
        if (res.ok) {
          const data: { analysis: AnalysisDTO } = await res.json();
          if (stopped) return;
          setAnalysis(data.analysis);
          if (isTerminal(data.analysis)) {
            terminalRef.current = true;
            refreshHistory();
          }
        }
      } catch {
        /* erros transitórios de rede são ignorados */
      }
    };

    void poll();
    const interval = setInterval(() => {
      if (!terminalRef.current) void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [activeId, pollNonce, refreshHistory]);

  /* ===== Cronômetro + detecção de travamento ===== */
  const live = view === 'live' && !!analysis;
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [live]);

  useEffect(() => {
    if (!analysis || stalled || isTerminal(analysis)) return;
    if (Date.now() - new Date(analysis.createdAt).getTime() > STALL_TIMEOUT_MS) {
      setStalled(true);
      terminalRef.current = true;
      toast.error('A análise excedeu o tempo esperado.', {
        description: 'Você pode reexecutar os agentes pendentes.',
      });
    }
  }, [analysis, stalled, now]);

  /* ===== Ações ===== */
  const openAnalysis = useCallback(
    async (id: string) => {
      setStalled(false);
      setActiveId(id);
      setView('live');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      try {
        const res = await fetch(`/api/analyses/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const data: { analysis: AnalysisDTO } = await res.json();
          setAnalysis(data.analysis);
        }
      } catch {
        toast.error('Não foi possível carregar a análise.');
      }
    },
    []
  );

  const handleSubmit = useCallback(
    async (title: string) => {
      const existing = history.find(
        (h) =>
          h.status === 'completed' &&
          h.title.trim().toLowerCase() === title.trim().toLowerCase()
      );
      if (existing) {
        toast(`Abrindo a análise existente de “${existing.title}”.`, {
          description: 'O relatório completo foi carregado do histórico.',
        });
        void openAnalysis(existing.id);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch('/api/analyses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? 'Não foi possível iniciar a análise.');
          return;
        }
        setStalled(false);
        setAnalysis(null);
        setActiveId(data.id);
        setView('live');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        void refreshHistory();
      } catch {
        toast.error('Falha de conexão. Tente novamente.');
      } finally {
        setLoading(false);
      }
    },
    [history, openAnalysis, refreshHistory]
  );

  const handleRetry = useCallback(
    async (agentKeys?: string[]) => {
      if (!activeId) return;
      try {
        const res = await fetch(`/api/analyses/${activeId}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(agentKeys?.length ? { agentKeys } : {}),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? 'Não foi possível reexecutar.');
          return;
        }
        toast.success(data.message ?? 'Agentes reexecutados.');
        setStalled(false);
        setPollNonce((n) => n + 1);
        void refreshHistory();
      } catch {
        toast.error('Falha de conexão ao reexecutar.');
      }
    },
    [activeId, refreshHistory]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/analyses/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        if (id === activeId) {
          setActiveId(null);
          setAnalysis(null);
          setView('idle');
        }
        void refreshHistory();
        toast.success('Análise excluída do histórico.');
      } catch {
        toast.error('Não foi possível excluir.');
      }
    },
    [activeId, refreshHistory]
  );

  const goIdle = useCallback(() => {
    setView('idle');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /* ===== Renderização ===== */
  const showReport =
    !!analysis &&
    !stalled &&
    analysis.status === 'completed' &&
    !analysis.results.some((r) => r.status === 'running');

  const elapsedMs = analysis
    ? showReport
      ? analysis.durationMs ?? now - new Date(analysis.createdAt).getTime()
      : now - new Date(analysis.createdAt).getTime()
    : 0;

  return (
    <div className="paper-texture flex min-h-screen flex-col">
      {/* Cabeçalho fixo */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <button
            type="button"
            onClick={goIdle}
            className="flex items-center gap-3 text-left"
            aria-label="ANIMA — voltar ao início"
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 font-serif text-lg font-bold text-white shadow-sm"
              aria-hidden
            >
              A
            </span>
            <span>
              <span className="block font-serif text-lg font-semibold leading-none tracking-wide">
                ANIMA
              </span>
              <span className="mt-1 hidden text-[11px] leading-none text-muted-foreground sm:block">
                Analisador Narrativo Inteligente Multiagente
              </span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-medium text-primary md:inline-flex">
              7 agentes de IA
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {view === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-1 flex-col"
          >
            <Hero
              onSubmit={handleSubmit}
              loading={loading}
              history={history}
              onOpenHistory={openAnalysis}
              onDeleteHistory={handleDelete}
            />
          </motion.div>
        )}

        {view === 'live' && analysis && showReport && (
          <motion.div
            key={`report-${analysis.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-1 flex-col"
          >
            <ReportView analysis={analysis} onRetry={handleRetry} onNew={goIdle} />
          </motion.div>
        )}

        {view === 'live' && analysis && !showReport && (
          <motion.div
            key={`pipeline-${analysis.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-1 flex-col"
          >
            <PipelineView
              analysis={analysis}
              elapsedMs={elapsedMs}
              stalled={stalled}
              onRetryAll={() => handleRetry()}
              onExit={goIdle}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rodapé fixo ao fundo */}
      <footer className="mt-auto border-t border-border/70 bg-background/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-5 text-center text-xs text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <p>
            <span className="font-serif font-semibold text-foreground/80">ANIMA</span> ·
            protótipo de análise narrativa multiagente
          </p>
          <p>1 pesquisador + 6 especialistas · Next.js · Prisma · IA</p>
        </div>
      </footer>
    </div>
  );
}
