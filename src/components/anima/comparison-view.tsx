'use client';

// ANIMA — leitura cruzada de duas obras já analisadas.
//
// A tela existe para uma decisão simples: escolher dois relatórios e ver o que um faz o outro dizer. O
// histórico fica abaixo, porque comparação boa é aquela que se relê — e ruim é aquela que some ao recarregar.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, GitCompareArrows, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Prose } from '@/components/anima/markdown';
import { formatDate } from '@/lib/anima/format';
import type { AnalysisSummaryDTO, ComparisonDTO } from '@/lib/anima/types';

const label = (item: { title: string; hint: string | null }) => (item.hint ? `${item.title} — ${item.hint}` : item.title);

function download(comparison: ComparisonDTO) {
  if (!comparison.content) return;
  const markdown = [
    `# ${comparison.left.title} × ${comparison.right.title}`,
    '',
    `> Comparação gerada pelo ANIMA em ${formatDate(comparison.createdAt)}.`,
    '> Conteúdo gerado por IA: confira fatos e referências marcados com † antes de citar.',
    '',
    comparison.content,
    '',
    '---',
    '',
    `Análises de origem: ${comparison.left.title} · ${comparison.right.title}`,
  ].join('\n');

  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `anima-comparacao-${comparison.left.id.slice(0, 6)}-${comparison.right.id.slice(0, 6)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ComparisonView() {
  const [analyses, setAnalyses] = useState<AnalysisSummaryDTO[]>([]);
  const [comparisons, setComparisons] = useState<ComparisonDTO[]>([]);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  // Carrega uma vez e a cada "Tentar de novo". Sem polling: comparação não muda sozinha.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [analysesRes, comparisonsRes] = await Promise.all([
          fetch('/api/analyses?status=completed&limit=100', { cache: 'no-store' }),
          fetch('/api/comparisons?limit=30', { cache: 'no-store' }),
        ]);
        const analysesData = (await analysesRes.json().catch(() => ({}))) as { analyses?: AnalysisSummaryDTO[] };
        const comparisonsData = (await comparisonsRes.json().catch(() => ({}))) as { comparisons?: ComparisonDTO[] };
        if (!analysesRes.ok || !comparisonsRes.ok) throw new Error('resposta inválida');
        if (cancelled) return;
        setAnalyses(analysesData.analyses ?? []);
        setComparisons(comparisonsData.comparisons ?? []);
        setError(null);
      } catch {
        if (!cancelled) setError('Não foi possível carregar as análises agora.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const ready = analyses.length >= 2;
  const chosen = useMemo(() => analyses.filter((item) => item.id === leftId || item.id === rightId), [analyses, leftId, rightId]);
  const canCompare = Boolean(leftId && rightId && leftId !== rightId && !busy);

  const compare = async () => {
    if (!canCompare) return;
    setBusy(true);
    try {
      const res = await fetch('/api/comparisons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leftId, rightId }),
      });
      const data = (await res.json().catch(() => ({}))) as { comparison?: ComparisonDTO; error?: string };
      if (!res.ok || !data.comparison) {
        toast.error(data.error ?? 'Não foi possível comparar agora.');
        return;
      }
      setComparisons((current) => [data.comparison as ComparisonDTO, ...current]);
      toast.success('Comparação pronta.');
    } catch {
      toast.error('Falha de conexão. A comparação não foi concluída.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/comparisons/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Não foi possível remover.');
        return;
      }
      setComparisons((current) => current.filter((item) => item.id !== id));
    } catch {
      toast.error('Falha de conexão ao remover.');
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-3 text-muted-foreground print:hidden">
        <Link href="/">
          <ArrowLeft aria-hidden /> Início
        </Link>
      </Button>

      <header className="mb-6">
        <h1 className="flex items-center gap-3 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          <GitCompareArrows className="size-7 text-primary" aria-hidden />
          Comparar duas obras
        </h1>
        <p className="mt-2 text-muted-foreground">
          Uma leitura cruzada de dois relatórios já prontos: o que aproxima, o que separa, o que uma ilumina na
          outra e qual leitura viaja melhor. Usa o dossiê e a síntese de cada análise — não refaz o pipeline nem
          gasta oito lentes por obra.
        </p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border bg-card/60 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando análises…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">{error}</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
            Tentar de novo
          </Button>
        </div>
      ) : !ready ? (
        <div className="rounded-xl border bg-card/60 p-6 text-sm">
          <p className="font-medium">São necessárias duas análises concluídas.</p>
          <p className="mt-1 text-muted-foreground">
            Você tem {analyses.length}. Abra uma obra nova, conclua a análise e volte aqui — a comparação não
            consegue inventar o que ainda não foi lido.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href="/">
              <Sparkles aria-hidden /> Analisar uma obra
            </Link>
          </Button>
        </div>
      ) : (
        <section className="rounded-xl border bg-card/60 p-4 sm:p-5" aria-labelledby="escolher-titulo">
          <h2 id="escolher-titulo" className="font-serif text-lg font-semibold">
            Escolha as duas obras
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              [
                { id: 'comparar-a', label: 'Primeira obra', value: leftId, set: setLeftId, other: rightId },
                { id: 'comparar-b', label: 'Segunda obra', value: rightId, set: setRightId, other: leftId },
              ] as const
            ).map((field) => (
              <div key={field.id}>
                <label htmlFor={field.id} className="text-sm font-medium">
                  {field.label}
                </label>
                <select
                  id={field.id}
                  value={field.value}
                  disabled={busy}
                  onChange={(event) => field.set(event.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <option value="">Selecione…</option>
                  {analyses.map((item) => (
                    <option key={item.id} value={item.id} disabled={item.id === field.other}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void compare()} disabled={!canCompare}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <GitCompareArrows aria-hidden />}
              {busy ? 'Comparando…' : 'Comparar'}
            </Button>
            {chosen.length === 2 && !busy && (
              <p className="text-sm text-muted-foreground">
                {chosen[0].title} × {chosen[1].title}
              </p>
            )}
            {busy && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Uma chamada ao modelo, lendo os dois dossiês. Costuma levar meio minuto.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="mt-8" aria-labelledby="historico-titulo">
        <h2 id="historico-titulo" className="font-serif text-xl font-semibold">
          Comparações salvas
        </h2>
        {comparisons.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhuma ainda. A primeira aparece aqui.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {comparisons.map((comparison) => (
              <li key={comparison.id} className="rounded-xl border bg-card/60">
                <details open={comparison.status === 'completed' && comparison.id === comparisons[0].id}>
                  <summary className="cursor-pointer list-none p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {comparison.left.title} × {comparison.right.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(comparison.createdAt)}
                          {comparison.model ? ` · ${comparison.model}` : ''}
                          {comparison.durationMs ? ` · ${Math.round(comparison.durationMs / 1000)}s` : ''}
                          {comparison.status === 'failed' ? ' · falhou' : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 print:hidden">
                        {comparison.content && (
                          <Button size="sm" variant="outline" onClick={() => download(comparison)}>
                            Baixar .md
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8 text-muted-foreground"
                          onClick={() => void remove(comparison.id)}
                          aria-label={`Remover comparação entre ${comparison.left.title} e ${comparison.right.title}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  </summary>
                  <div className="border-t px-4 py-4">
                    {comparison.status === 'failed' ? (
                      <p className="text-sm text-destructive">
                        {comparison.error ?? 'A comparação falhou. Tente gerar de novo.'}
                      </p>
                    ) : comparison.content ? (
                      <Prose content={comparison.content} />
                    ) : (
                      <p className="text-sm text-muted-foreground">Sem conteúdo gravado.</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
