'use client';

// ANIMA — perguntas de acompanhamento no fim do relatório.
//
// Regra de ouro desta caixa: ela não é um chat. É uma continuação da leitura, com o mesmo material — por isso
// as sugestões vêm do que a análise realmente cobriu, e a resposta é guardada junto do relatório.

import { useMemo, useRef, useState } from 'react';
import { CornerDownLeft, MessageCircleQuestion, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { suggestedQuestions } from '@/lib/anima/follow-up-suggestions';
import { formatDate } from '@/lib/anima/format';
import type { AnalysisDTO, FollowUpDTO } from '@/lib/anima/types';
import { cn } from '@/lib/utils';

const MAX_QUESTION_CHARS = 500;

export function FollowUps({ analysis }: { analysis: AnalysisDTO }) {
  const [items, setItems] = useState<FollowUpDTO[]>(analysis.followUps);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = useMemo(() => suggestedQuestions(analysis), [analysis]);
  const unusedSuggestions = suggestions.filter((s) => !items.some((item) => item.question === s));
  const remaining = MAX_QUESTION_CHARS - question.length;

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 3 || busy) return;

    setBusy(true);
    setPending(trimmed);
    setQuestion('');
    try {
      const res = await fetch(`/api/analyses/${analysis.id}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as { followUp?: FollowUpDTO; error?: string };
      if (!res.ok || !data.followUp) {
        toast.error(data.error ?? 'Não foi possível responder agora.');
        setQuestion(trimmed); // preserva o que a pessoa escreveu
        return;
      }
      setItems((current) => [...current, data.followUp as FollowUpDTO]);
    } catch {
      toast.error('Falha de conexão. A pergunta não foi enviada.');
      setQuestion(trimmed);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/analyses/${analysis.id}/questions?questionId=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? 'Não foi possível remover.');
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
    } catch {
      toast.error('Falha de conexão ao remover.');
    }
  };

  return (
    <section className="mb-4 rounded-xl border bg-card/60 px-4 py-4 print:hidden" aria-labelledby="perguntas-titulo">
      <h2 id="perguntas-titulo" className="flex items-center gap-2 font-serif text-lg font-semibold">
        <MessageCircleQuestion className="size-5 text-primary" aria-hidden />
        Perguntas de acompanhamento
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Respondidas com o dossiê e as lentes desta análise — sem nova pesquisa. O que estiver fora do material
        vem marcado com †.
      </p>

      {items.length > 0 && (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border bg-background/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium">{item.question}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 text-muted-foreground"
                  onClick={() => void remove(item.id)}
                  aria-label={`Remover a pergunta “${item.question}”`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{item.answer}</div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDate(item.createdAt)}
                {item.model && item.model !== 'mock' ? ` · ${item.model}` : ''}
                {item.durationMs ? ` · ${(item.durationMs / 1000).toFixed(0)}s` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <div className="mt-3 rounded-lg border border-dashed bg-background/40 p-3" aria-live="polite">
          <p className="text-sm font-medium">{pending}</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-3 animate-pulse rounded-full bg-primary" aria-hidden />
            Relendo o dossiê e as análises para responder…
          </p>
        </div>
      )}

      {unusedSuggestions.length > 0 && !busy && (
        <div className="mt-4 flex flex-wrap gap-2">
          {unusedSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void ask(suggestion)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors',
                'hover:border-primary/40 hover:bg-primary/5 hover:text-foreground'
              )}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="pergunta-acompanhamento" className="sr-only">
          Escreva sua pergunta sobre a obra
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="pergunta-acompanhamento"
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value.slice(0, MAX_QUESTION_CHARS))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void ask(question);
              }
            }}
            rows={2}
            disabled={busy}
            placeholder="Ex.: o que a lente de Contexto deixa de fora nesta obra?"
            className={cn(
              'min-h-11 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-60'
            )}
          />
          <Button type="submit" size="sm" disabled={busy || question.trim().length < 3} className="shrink-0">
            <CornerDownLeft aria-hidden />
            Perguntar
          </Button>
        </div>
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {remaining < 80 ? `${remaining} caracteres restantes` : 'Enter envia · Shift+Enter quebra linha'}
        </p>
      </form>
    </section>
  );
}
