'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Link2, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AGENTS } from '@/lib/anima/agent-meta';
import {
  DEPTHS,
  DEPTH_LABELS,
  WORK_KINDS,
  WORK_KIND_LABELS,
  type AgentKey,
  type Depth,
  type WorkKind,
} from '@/lib/anima/types';
import { cn } from '@/lib/utils';

const EXAMPLES: { title: string; kind: WorkKind; hint: string; focus?: string }[] = [
  { title: 'Dom Casmurro', kind: 'book', hint: 'Machado de Assis, 1899' },
  { title: 'Grande Sertão: Veredas', kind: 'book', hint: 'Guimarães Rosa, 1956' },
  { title: 'Cem Anos de Solidão', kind: 'book', hint: 'Gabriel García Márquez, 1967' },
  { title: 'Cidade de Deus', kind: 'film', hint: 'Fernando Meirelles, 2002' },
  { title: 'Interestelar', kind: 'film', hint: 'Christopher Nolan, 2014' },
  { title: 'Breaking Bad', kind: 'series', hint: '2008', focus: 'a temporada 4 e o arco de Gus Fring' },
];

const fieldLabel = 'mb-1.5 block text-sm font-medium text-foreground';
const help = 'mt-1 block text-xs text-muted-foreground';
const selectClass =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Separa o que o usuário colou em links (http/https) e trechos de texto. */
export function parseSourcesInput(links: string, excerpt: string): Array<{ type: 'url' | 'text'; value: string }> {
  const urls = links
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, 5);
  const sources: Array<{ type: 'url' | 'text'; value: string }> = urls.map((value) => ({ type: 'url', value }));
  const text = excerpt.trim();
  if (text.length >= 40 && sources.length < 5) sources.push({ type: 'text', value: text });
  return sources;
}

export interface InitialAnalysis {
  title: string;
  hint: string;
  focus: string;
  kind: WorkKind;
  depth: Depth;
  lenses?: AgentKey[];
}

export function NewAnalysisForm({ initial }: { initial?: InitialAnalysis }) {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [hint, setHint] = useState(initial?.hint ?? '');
  const [focus, setFocus] = useState(initial?.focus ?? '');
  const [kind, setKind] = useState<WorkKind>(initial?.kind ?? 'auto');
  const [depth, setDepth] = useState<Depth>(initial?.depth ?? 'standard');
  const [selected, setSelected] = useState<AgentKey[]>(initial?.lenses ?? AGENTS.map((a) => a.key));
  const [links, setLinks] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sources = useMemo(() => parseSourcesInput(links, excerpt), [links, excerpt]);
  const preloaded = Boolean(initial?.title);
  const allSelected = selected.length === AGENTS.length;
  const calls = selected.length + 2; // pesquisa + especialistas + síntese
  const estimate = DEPTH_LABELS[depth].minutes;

  function toggleAgent(key: AgentKey) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function applyExample(ex: (typeof EXAMPLES)[number]) {
    setTitle(ex.title);
    setKind(ex.kind);
    setHint(ex.hint);
    setFocus(ex.focus ?? '');
    titleRef.current?.focus();
  }

  async function submit(force = false) {
    setError(null);
    if (selected.length === 0) {
      setError('Escolha pelo menos uma lente de análise.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          hint,
          focus,
          kind,
          depth,
          agents: allSelected ? undefined : selected,
          sources,
          force,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Não foi possível iniciar a análise.');
        return;
      }
      if (data.reused) {
        toast('Você já analisou esta obra com essas opções.', {
          description: 'Abrimos o relatório existente, sem novo custo de API.',
          action: { label: 'Refazer do zero', onClick: () => void submit(true) },
          duration: 9000,
        });
      } else if (data.queued) {
        toast(`Na fila: posição ${data.queuePosition ?? '—'}.`, {
          description: 'A análise começa automaticamente quando abrir uma vaga.',
        });
      }
      router.push(`/analise/${data.id}`);
    } catch {
      setError('Falha de conexão. Verifique sua rede e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length >= 2 && !loading) void submit();
      }}
      className="mx-auto max-w-2xl space-y-5 text-left"
      aria-describedby={error ? 'form-error' : undefined}
    >
      {preloaded && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
          Ajustes carregados do relatório anterior. Mude o que quiser — nada é enviado até você clicar em “Analisar
          obra”.
        </p>
      )}
      <div>
        <label htmlFor="titulo" className={fieldLabel}>
          Obra
        </label>
        <Input
          ref={titleRef}
          id="titulo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex.: Dom Casmurro"
          maxLength={160}
          autoComplete="off"
          required
          className="h-12 rounded-xl bg-card text-base"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dica" className={fieldLabel}>
            Autor / ano <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <Input
            id="dica"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="Ex.: Machado de Assis, 1899"
            maxLength={120}
            autoComplete="off"
            className="h-11 bg-card"
          />
        </div>
        <div>
          <label htmlFor="meio" className={fieldLabel}>
            Meio
          </label>
          <select id="meio" value={kind} onChange={(e) => setKind(e.target.value as WorkKind)} className={selectClass}>
            {WORK_KINDS.map((k) => (
              <option key={k} value={k}>
                {WORK_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="recorte" className={fieldLabel}>
          Recorte <span className="font-normal text-muted-foreground">(opcional)</span>
        </label>
        <Input
          id="recorte"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder="Ex.: só a temporada 4; o capítulo final; a personagem Capitu"
          maxLength={200}
          autoComplete="off"
          className="h-11 bg-card"
          aria-describedby="recorte-ajuda"
        />
        <span id="recorte-ajuda" className={help}>
          Concentra a análise num capítulo, temporada, personagem ou aspecto — sem perder o contexto da obra.
        </span>
      </div>

      <fieldset>
        <legend className={fieldLabel}>Profundidade</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DEPTHS.map((d) => (
            <label
              key={d}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 text-sm transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                depth === d ? 'border-primary bg-primary/5' : 'hover:border-primary/40'
              )}
            >
              <input
                type="radio"
                name="profundidade"
                value={d}
                checked={depth === d}
                onChange={() => setDepth(d)}
                className="mt-1 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{DEPTH_LABELS[d].label}</span>
                  <span aria-hidden className="text-xs text-muted-foreground">
                    {'▮'.repeat(DEPTH_LABELS[d].cost)}
                    {'▯'.repeat(4 - DEPTH_LABELS[d].cost)}
                  </span>
                </span>
                <span className="mt-0.5 block text-muted-foreground">{DEPTH_LABELS[d].description}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  ≈ {DEPTH_LABELS[d].minutes[0]}–{DEPTH_LABELS[d].minutes[1]} min · {DEPTH_LABELS[d].words[0]}–
                  {DEPTH_LABELS[d].words[1]} palavras por lente
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className={fieldLabel}>
          Lentes <span className="font-normal text-muted-foreground">({selected.length} de {AGENTS.length})</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {AGENTS.map((agent) => {
            const active = selected.includes(agent.key);
            const Icon = agent.icon;
            return (
              <button
                key={agent.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleAgent(agent.key)}
                title={agent.tagline}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  active
                    ? cn('border-transparent', agent.color.bg, agent.color.text, 'ring-1', agent.color.border)
                    : 'border-border bg-card text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {agent.short}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setSelected(AGENTS.map((a) => a.key))}
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            Todas
          </button>
          <button
            type="button"
            onClick={() => setSelected([AGENTS[0].key])}
            className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Só uma (mais rápido)
          </button>
          <span className="text-muted-foreground">
            {calls} chamadas de LLM · ≈ {estimate[0]}–{estimate[1]} min
          </span>
        </div>
      </fieldset>

      <div className="rounded-lg border bg-card/60">
        <button
          type="button"
          onClick={() => setShowSources((v) => !v)}
          aria-expanded={showSources}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <span className="inline-flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Fontes adicionais <span className="font-normal text-muted-foreground">(opcional)</span>
            {sources.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {sources.length} {sources.length === 1 ? 'fonte' : 'fontes'}
              </span>
            )}
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showSources && 'rotate-180')} aria-hidden />
        </button>
        {showSources && (
          <div className="space-y-3 border-t px-3 py-3">
            <div>
              <label htmlFor="links" className={fieldLabel}>
                Links
              </label>
              <textarea
                id="links"
                value={links}
                onChange={(e) => setLinks(e.target.value)}
                rows={2}
                placeholder="https://exemplo.com/resenha (um por linha, até 5)"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <span className={help}>O servidor lê a página e usa o texto como fonte prioritária no dossiê.</span>
            </div>
            <div>
              <label htmlFor="trecho" className={fieldLabel}>
                Trecho colado
              </label>
              <textarea
                id="trecho"
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                rows={3}
                placeholder="Cole um trecho da obra, uma resenha ou uma ficha que você quer que seja considerada."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <span className={help}>
                {excerpt.trim().length > 0 && excerpt.trim().length < 40
                  ? `Faltam ${40 - excerpt.trim().length} caracteres para o trecho valer como fonte.`
                  : 'Mínimo de 40 caracteres. O trecho é tratado como dado, nunca como instrução.'}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p
          id="form-error"
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={loading || title.trim().length < 2 || selected.length === 0}
        size="lg"
        className="h-12 w-full rounded-xl text-base font-semibold"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden /> Iniciando…
          </>
        ) : (
          <>
            <Sparkles aria-hidden /> Analisar obra
          </>
        )}
      </Button>

      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        <span className="text-sm text-muted-foreground">Exemplos:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.title}
            type="button"
            onClick={() => applyExample(ex)}
            className="rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {ex.title}
          </button>
        ))}
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Os exemplos apenas preenchem o formulário: nada é enviado até você clicar em “Analisar obra”.
      </p>
    </form>
  );
}
