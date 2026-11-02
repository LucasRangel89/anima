'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DEPTHS, DEPTH_LABELS, WORK_KINDS, WORK_KIND_LABELS, type Depth, type WorkKind } from '@/lib/anima/types';
import { cn } from '@/lib/utils';

const EXAMPLES: { title: string; kind: WorkKind; hint: string }[] = [
  { title: 'Dom Casmurro', kind: 'book', hint: 'Machado de Assis, 1899' },
  { title: 'Grande Sertão: Veredas', kind: 'book', hint: 'Guimarães Rosa, 1956' },
  { title: 'Cem Anos de Solidão', kind: 'book', hint: 'Gabriel García Márquez, 1967' },
  { title: 'Cidade de Deus', kind: 'film', hint: 'Fernando Meirelles, 2002' },
  { title: 'Interestelar', kind: 'film', hint: 'Christopher Nolan, 2014' },
  { title: 'Breaking Bad', kind: 'series', hint: '2008' },
];

const fieldLabel = 'mb-1.5 block text-sm font-medium text-foreground';
const selectClass =
  'h-11 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function NewAnalysisForm() {
  const router = useRouter();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [hint, setHint] = useState('');
  const [kind, setKind] = useState<WorkKind>('auto');
  const [depth, setDepth] = useState<Depth>('standard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(force = false) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, hint, kind, depth, force }),
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
      className="mx-auto max-w-xl space-y-4 text-left"
      aria-describedby={error ? 'form-error' : undefined}
    >
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
          className="h-12 rounded-xl bg-card text-base"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dica" className={fieldLabel}>
            Autor / ano <span className="font-normal text-muted-foreground">(opcional, evita ambiguidade)</span>
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
              <span>
                <span className="block font-medium">{DEPTH_LABELS[d].label}</span>
                <span className="text-muted-foreground">{DEPTH_LABELS[d].description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p id="form-error" role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" disabled={loading || title.trim().length < 2} size="lg" className="h-12 w-full rounded-xl text-base font-semibold">
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
            onClick={() => {
              setTitle(ex.title);
              setKind(ex.kind);
              setHint(ex.hint);
              titleRef.current?.focus();
            }}
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
