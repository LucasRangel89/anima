'use client';

// ANIMA — relatório final consolidado: dossiê + 6 análises especializadas

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { Prose } from './markdown';
import { AGENTS } from '@/lib/anima/agent-meta';
import type { AnalysisDTO } from '@/lib/anima/types';
import { cn } from '@/lib/utils';

function formatDuration(ms: number | null): string | null {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function buildMarkdown(analysis: AnalysisDTO): string {
  const parts: string[] = [
    `# Relatório ANIMA — ${analysis.title}`,
    '',
    `> Gerado em ${format(new Date(analysis.createdAt), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: ptBR })} · sistema multiagente (1 pesquisador + 6 especialistas).`,
    '',
    `## Dossiê de Pesquisa — Agente Pesquisador`,
    '',
    analysis.research ?? '_(dossiê indisponível)_',
    '',
  ];
  for (const agent of AGENTS) {
    const r = analysis.results.find((x) => x.agentKey === agent.key);
    parts.push('---', '', `## ${agent.name} — ${agent.role}`, '');
    parts.push(r?.content ?? '_(este agente não concluiu a análise)_', '');
  }
  return parts.join('\n');
}

export function ReportView({
  analysis,
  onRetry,
  onNew,
}: {
  analysis: AnalysisDTO;
  onRetry: (agentKeys?: string[]) => void;
  onNew: () => void;
}) {
  const [activeSection, setActiveSection] = useState<string>('dossie');
  const failedAgents = analysis.results.filter((r) => r.status === 'failed');
  const runningAgents = analysis.results.filter((r) => r.status === 'running');
  const doneCount = analysis.results.filter((r) => r.status === 'done').length;
  const markdown = useMemo(() => buildMarkdown(analysis), [analysis]);

  // Scrollspy determinístico: ativa a última seção cujo topo cruzou a faixa de leitura
  useEffect(() => {
    const ids = ['dossie', ...AGENTS.map((a) => a.key)];
    const onScroll = () => {
      const band = window.innerHeight * 0.3;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= band) current = id;
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [analysis.id]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success('Relatório copiado para a área de transferência.');
    } catch {
      toast.error('Não foi possível copiar. Tente baixar o arquivo .md.');
    }
  }

  function handleDownload() {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = analysis.title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .slice(0, 60);
    a.href = url;
    a.download = `anima-relatorio-${safe || 'obra'}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Download iniciado.');
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      {/* Cabeçalho do relatório */}
      <motion.header
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="mb-8"
      >
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-primary">
          <FileText className="h-3.5 w-3.5" aria-hidden /> Relatório ANIMA
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-balance sm:text-4xl">
          {analysis.title}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          <span>{format(new Date(analysis.createdAt), "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}</span>
          <span aria-hidden>·</span>
          <span>
            {doneCount}/{AGENTS.length} especialistas
          </span>
          {formatDuration(analysis.durationMs) && (
            <>
              <span aria-hidden>·</span>
              <span>{formatDuration(analysis.durationMs)} de análise</span>
            </>
          )}
          {failedAgents.length > 0 && runningAgents.length === 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {failedAgents.length} com falha
            </Badge>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={onNew} className="font-semibold">
            <Plus className="h-4 w-4" /> Nova análise
          </Button>
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4" /> Baixar .md
          </Button>
          <Button size="sm" variant="outline" onClick={handleCopy}>
            <Copy className="h-4 w-4" /> Copiar relatório
          </Button>
          {failedAgents.length > 0 && runningAgents.length === 0 && (
            <Button size="sm" variant="outline" onClick={() => onRetry()} className="text-destructive">
              <RefreshCw className="h-4 w-4" /> Reexecutar {failedAgents.length} agente(s)
            </Button>
          )}
        </div>
      </motion.header>

      {/* Navegação fixa por seção */}
      <nav
        aria-label="Seções do relatório"
        className="sticky top-16 z-30 -mx-4 mb-10 border-y bg-background/90 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6"
      >
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 nice-scrollbar">
          <SectionChip
            id="dossie"
            active={activeSection === 'dossie'}
            label="Dossiê"
            icon={Search}
          />
          {AGENTS.map((agent) => {
            const r = analysis.results.find((x) => x.agentKey === agent.key);
            return (
              <SectionChip
                key={agent.key}
                id={agent.key}
                active={activeSection === agent.key}
                label={agent.name.replace('Agente ', '')}
                icon={agent.icon}
                failed={r?.status === 'failed'}
                running={r?.status === 'running'}
              />
            );
          })}
        </div>
      </nav>

      {/* Dossiê da pesquisa */}
      <section id="dossie" className="mb-10 scroll-mt-32">
        <CardShell
          icon={<Search className="h-5 w-5" />}
          iconClassName="border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400"
          title="Dossiê de Pesquisa"
          subtitle="Agente Pesquisador · base factual para os especialistas"
          right={
            analysis.researchStatus === 'done' ? (
              <Badge className="gap-1 bg-emerald-600/15 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
                <CheckCircle2 className="h-3 w-3" /> Pronto
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> Indisponível
              </Badge>
            )
          }
        >
          {analysis.research ? (
            <Prose content={analysis.research} />
          ) : (
            <p className="text-sm text-muted-foreground">
              O dossiê não pôde ser compilado.{' '}
              <button className="text-primary underline" onClick={() => onRetry()}>
                Reexecutar a pesquisa
              </button>
            </p>
          )}
        </CardShell>
      </section>

      {/* Seções dos especialistas */}
      {AGENTS.map((agent) => {
        const result = analysis.results.find((x) => x.agentKey === agent.key);
        return (
          <section key={agent.key} id={agent.key} className="mb-10 scroll-mt-32">
            <CardShell
              icon={<agent.icon className="h-5 w-5" />}
              iconClassName={cn(agent.color.bg, agent.color.border, agent.color.text)}
              title={agent.name}
              subtitle={agent.role}
              right={
                result?.status === 'done' ? (
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(result.durationMs) ?? 'Concluído'}
                  </span>
                ) : result?.status === 'running' ? (
                  <Badge variant="outline" className="gap-1.5 animate-pulse border-primary/40 text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" /> Reexecutando…
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> Falhou
                  </Badge>
                )
              }
            >
              {result?.status === 'done' && result.content ? (
                <Prose content={result.content} />
              ) : result?.status === 'running' ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Este especialista está redigindo a nova análise…
                </p>
              ) : (
                <div className="text-sm">
                  <p className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{result?.error || 'Este agente não concluiu a análise.'}</span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => onRetry([agent.key])}
                  >
                    <RefreshCw className="h-4 w-4" /> Reexecutar este agente
                  </Button>
                </div>
              )}
            </CardShell>
          </section>
        );
      })}

      <Separator className="mb-6" />
      <p className="flex items-center justify-center gap-2 pb-4 text-center text-xs text-muted-foreground">
        <BookOpenCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Relatório gerado pelo sistema multiagente ANIMA · 1 pesquisador + 6 especialistas independentes · conteúdo produzido por IA, sujeito a imprecisões.
      </p>
    </main>
  );
}

function SectionChip({
  id,
  active,
  label,
  icon: Icon,
  failed,
  running,
}: {
  id: string;
  active: boolean;
  label: string;
  icon: typeof Search;
  failed?: boolean;
  running?: boolean;
}) {
  return (
    <a
      href={`#${id}`}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary/50 bg-primary text-primary-foreground shadow-sm'
          : 'bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground',
        failed && !active && 'border-destructive/40 text-destructive',
        running && 'animate-pulse border-primary/40 text-primary'
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </a>
  );
}

function CardShell({
  icon,
  iconClassName,
  title,
  subtitle,
  right,
  children,
}: {
  icon: React.ReactNode;
  iconClassName: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.45 }}
      className="overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
              iconClassName
            )}
            aria-hidden
          >
            {icon}
          </span>
          <div>
            <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {right}
      </header>
      <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
    </motion.article>
  );
}
