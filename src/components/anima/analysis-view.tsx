'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, BookOpenText, ChevronsDownUp, ChevronsUpDown, Copy, Download, Printer, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { AGENTS, CURATOR_META, RESEARCHER_META } from '@/lib/anima/agent-meta';
import { buildReportMarkdown } from '@/lib/anima/export';
import { formatClock, formatDate, formatDuration, slugify } from '@/lib/anima/format';
import { DEPTH_LABELS, WORK_KIND_LABELS, isActiveStatus, type AgentKey, type AnalysisDTO } from '@/lib/anima/types';
import { isBusy, useAnalysis } from '@/hooks/use-analysis';
import { cn } from '@/lib/utils';
import { SectionCard, StateIcon, type SectionState } from './section-card';

/** Cronômetro isolado: só ele re-renderiza a cada segundo. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="font-mono text-sm tabular-nums text-muted-foreground">{formatClock(now - since)}</span>;
}

interface SectionDef {
  id: string;
  label: string;
  state: SectionState;
  icon: React.ComponentType<{ className?: string }>;
}

function buildSections(a: AnalysisDTO): SectionDef[] {
  const active = isActiveStatus(a.status);
  const synthState: SectionState =
    a.synthesisStatus === 'done' ? 'done' : a.synthesisStatus === 'running' ? 'running' : a.synthesisStatus === 'failed' ? 'failed' : active ? 'pending' : 'skipped';
  const researchState: SectionState = a.researchStatus === 'skipped' ? 'skipped' : a.researchStatus;
  return [
    { id: 'sintese', label: 'Síntese', state: synthState, icon: CURATOR_META.icon },
    { id: 'dossie', label: 'Dossiê', state: researchState, icon: RESEARCHER_META.icon },
    ...AGENTS.map((ag) => ({
      id: ag.key,
      label: ag.short,
      state: (a.results.find((r) => r.agentKey === ag.key)?.status ?? 'skipped') as SectionState,
      icon: ag.icon,
    })),
  ];
}

export function AnalysisView({ id }: { id: string }) {
  const router = useRouter();
  const { analysis, error, refresh } = useAnalysis(id);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [activeSection, setActiveSection] = useState('sintese');
  const [startedAt] = useState(() => Date.now());

  const title = analysis?.title;
  useEffect(() => {
    if (title) document.title = `${title} · ANIMA`;
  }, [title]);

  const sections = useMemo(() => (analysis ? buildSections(analysis) : []), [analysis]);
  const isOpen = (sid: string) => openMap[sid] ?? sid !== 'dossie';
  const setOpen = (sid: string, v: boolean) => setOpenMap((m) => ({ ...m, [sid]: v }));
  const allOpen = sections.length > 0 && sections.every((s) => isOpen(s.id));

  // Realce da seção atual no sumário (determinístico, sem IntersectionObserver)
  const sectionIds = sections.map((s) => s.id).join(',');
  useEffect(() => {
    if (!sectionIds) return;
    const ids = sectionIds.split(',');
    const onScroll = () => {
      const band = window.innerHeight * 0.35;
      let current = ids[0];
      for (const sid of ids) {
        const el = document.getElementById(sid);
        if (el && el.getBoundingClientRect().top <= band) current = sid;
      }
      setActiveSection(current);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [sectionIds]);

  const retry = useCallback(
    async (body: { agentKeys?: AgentKey[]; research?: boolean; synthesis?: boolean } = {}) => {
      try {
        const res = await fetch(`/api/analyses/${id}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return void toast.error(data.error ?? 'Não foi possível reexecutar.');
        toast.success(data.message ?? 'Reexecutando…');
        refresh();
      } catch {
        toast.error('Falha de conexão ao reexecutar.');
      }
    },
    [id, refresh]
  );

  const redo = useCallback(async () => {
    if (!analysis) return;
    const res = await fetch('/api/analyses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: analysis.title, hint: analysis.hint, kind: analysis.kind, depth: analysis.depth, force: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return void toast.error(data.error ?? 'Não foi possível refazer a análise.');
    router.push(`/analise/${data.id}`);
  }, [analysis, router]);

  if (error === 'not_found') {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-20 text-center">
        <h1 className="font-serif text-2xl font-semibold">Análise não encontrada</h1>
        <p className="mt-2 text-muted-foreground">Ela pode ter sido excluída ou o endereço está incorreto.</p>
        <Button asChild className="mt-6"><Link href="/">Voltar ao início</Link></Button>
      </main>
    );
  }
  if (error === 'network' && !analysis) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-20 text-center">
        <h1 className="font-serif text-2xl font-semibold">Não foi possível carregar</h1>
        <p className="mt-2 text-muted-foreground">Verifique se o servidor está no ar e tente de novo.</p>
        <Button className="mt-6" onClick={refresh}><RefreshCw aria-hidden /> Tentar de novo</Button>
      </main>
    );
  }
  if (!analysis) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-10" aria-busy="true" aria-label="Carregando análise">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  const a = analysis;
  const busy = isBusy(a);
  const failedAgents = a.results.filter((r) => r.status === 'failed');
  const doneAgents = a.results.filter((r) => r.status === 'done').length;
  const steps = (a.researchStatus === 'done' ? 1 : 0) + doneAgents + (a.synthesisStatus === 'done' ? 1 : 0);
  const totalSteps = 2 + AGENTS.length;
  const phase =
    a.status === 'researching' ? 'Pesquisador compilando o dossiê'
    : a.status === 'analyzing' ? `Especialistas analisando (${doneAgents}/${AGENTS.length})`
    : a.status === 'synthesizing' ? 'Curador redigindo a síntese'
    : '';
  const since = Date.parse(a.createdAt) > startedAt - 30 * 60_000 && a.status !== 'completed' ? Math.max(Date.parse(a.createdAt), startedAt - 30 * 60_000) : startedAt;

  const markdown = () => buildReportMarkdown(a);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      toast.success('Relatório copiado.');
    } catch {
      toast.error('Não foi possível copiar. Use “Baixar .md”.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `anima-${slugify(a.title)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const meta = [WORK_KIND_LABELS[a.kind], DEPTH_LABELS[a.depth].label, a.model && a.model !== 'mock' ? a.model : a.model === 'mock' ? 'demonstração' : null, formatDate(a.createdAt), formatDuration(a.durationMs)].filter(Boolean);

  const agentAction = (key: AgentKey) => ({
    actionLabel: a.results.find((r) => r.agentKey === key)?.status === 'skipped' ? 'Executar este agente' : 'Reexecutar este agente',
    onAction: () => void retry({ agentKeys: [key] }),
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground print:hidden">
        <Link href="/"><ArrowLeft aria-hidden /> Início</Link>
      </Button>

      <header className="mb-6">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-balance sm:text-4xl">{a.title}</h1>
        {a.hint && <p className="mt-1 text-muted-foreground">{a.hint}</p>}
        <p className="mt-2 text-sm text-muted-foreground">{meta.join(' · ')}</p>
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          <Button size="sm" variant="outline" onClick={download}><Download aria-hidden /> Baixar .md</Button>
          <Button size="sm" variant="outline" onClick={() => void copy()}><Copy aria-hidden /> Copiar</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer aria-hidden /> Imprimir / PDF</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void redo()}><RefreshCw aria-hidden /> Refazer do zero</Button>
          <Button size="sm" variant="ghost" onClick={() => sections.forEach((s) => setOpen(s.id, !allOpen))}>
            {allOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />} {allOpen ? 'Recolher tudo' : 'Expandir tudo'}
          </Button>
        </div>
      </header>

      {busy && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-card p-4 shadow-sm print:hidden" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden /> {phase || 'Retomando…'}
            </p>
            <Elapsed since={since} />
          </div>
          <Progress value={Math.round((steps / totalSteps) * 100)} className="mt-3 h-2" aria-label="Progresso da análise" />
          <p className="mt-2 text-sm text-muted-foreground">
            {steps} de {totalSteps} etapas concluídas. Você pode ler as seções prontas enquanto as demais são escritas.
          </p>
        </div>
      )}

      {!busy && (a.status === 'failed' || a.status === 'interrupted') && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm print:hidden">
          <p className="flex items-start gap-2 text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {a.error ?? 'A análise não foi concluída.'}</p>
          <Button size="sm" onClick={() => void retry()}><RefreshCw aria-hidden /> {a.status === 'interrupted' ? 'Retomar' : 'Tentar novamente'}</Button>
        </div>
      )}

      {!busy && a.status === 'completed' && failedAgents.length > 0 && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm print:hidden">
          <p>{failedAgents.length} especialista(s) não concluíram. O relatório está parcial.</p>
          <Button size="sm" variant="outline" onClick={() => void retry()}><RefreshCw aria-hidden /> Reexecutar {failedAgents.length}</Button>
        </div>
      )}

      {/* Sumário (mobile: faixa rolável) */}
      <nav aria-label="Seções do relatório" className="sticky top-16 z-30 -mx-4 mb-6 border-y bg-background/90 px-4 py-2 backdrop-blur lg:hidden print:hidden">
        <ul className="flex gap-1.5 overflow-x-auto pb-0.5 nice-scrollbar">
          {sections.map((s) => (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                onClick={() => setOpen(s.id, true)}
                aria-current={activeSection === s.id ? 'true' : undefined}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors', activeSection === s.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}
              >
                <StateIcon state={s.state} className={activeSection === s.id ? 'text-current' : undefined} /> {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="hidden lg:block print:hidden">
          <nav aria-label="Seções do relatório" className="sticky top-24">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Neste relatório</p>
            <ul className="space-y-0.5">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={() => setOpen(s.id, true)}
                    aria-current={activeSection === s.id ? 'true' : undefined}
                    className={cn('flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors', activeSection === s.id ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                  >
                    <StateIcon state={s.state} /> {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          <SectionCard
            id="sintese"
            title={CURATOR_META.name}
            subtitle="Síntese integrada das oito análises"
            icon={CURATOR_META.icon}
            color={CURATOR_META.color}
            state={sections[0].state}
            content={a.synthesis}
            error={a.synthesisStatus === 'failed' ? a.error : null}
            durationMs={null}
            open={isOpen('sintese')}
            onToggle={() => setOpen('sintese', !isOpen('sintese'))}
            actionLabel="Gerar síntese"
            onAction={() => void retry({ synthesis: true })}
            emptyHint={sections[0].state === 'pending' ? 'A síntese é escrita depois que os especialistas terminam.' : 'Esta análise não tem síntese (foi gerada antes dela existir).'}
            highlight
          />

          <SectionCard
            id="dossie"
            title="Dossiê de pesquisa"
            subtitle="Agente Pesquisador · base factual de todas as análises"
            icon={BookOpenText}
            color={RESEARCHER_META.color}
            state={sections[1].state}
            content={a.research}
            error={a.researchStatus === 'failed' ? a.error : null}
            durationMs={null}
            open={isOpen('dossie')}
            onToggle={() => setOpen('dossie', !isOpen('dossie'))}
            actionLabel="Refazer a pesquisa"
            onAction={() => void retry({ research: true })}
            footer={
              a.sources.length > 0 ? (
                <div className="mt-6 border-t pt-4">
                  <h3 className="mb-2 text-sm font-semibold">Fontes consultadas</h3>
                  <ul className="space-y-1 text-sm">
                    {a.sources.map((s) => (
                      <li key={s.id}>
                        <span className="text-muted-foreground">[{s.id}]</span>{' '}
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">{s.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            }
          />

          {AGENTS.map((agent, i) => {
            const r = a.results.find((x) => x.agentKey === agent.key);
            return (
              <SectionCard
                key={agent.key}
                id={agent.key}
                title={agent.name}
                subtitle={agent.role}
                icon={agent.icon}
                color={agent.color}
                state={sections[i + 2].state}
                content={r?.content ?? null}
                error={r?.error ?? null}
                durationMs={r?.durationMs ?? null}
                open={isOpen(agent.key)}
                onToggle={() => setOpen(agent.key, !isOpen(agent.key))}
                emptyHint={r?.status === 'skipped' ? 'Este especialista foi adicionado depois que esta análise foi gerada.' : undefined}
                {...agentAction(agent.key)}
              />
            );
          })}

          <p className="pb-4 text-center text-sm text-muted-foreground">
            Conteúdo gerado por IA. Afirmações marcadas com † vêm do conhecimento prévio do modelo e merecem checagem.
          </p>
        </div>
      </div>
    </main>
  );
}
