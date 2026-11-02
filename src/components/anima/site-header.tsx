import Link from 'next/link';
import { AGENTS } from '@/lib/anima/agent-meta';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur print:hidden">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring" aria-label="ANIMA — página inicial">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 font-serif text-lg font-bold text-white shadow-sm"
            aria-hidden
          >
            A
          </span>
          <span>
            <span className="block font-serif text-lg font-semibold leading-none tracking-wide">ANIMA</span>
            <span className="mt-1 hidden text-xs leading-none text-muted-foreground sm:block">
              Analisador Narrativo Inteligente Multiagente
            </span>
          </span>
        </Link>
        <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
          <span className="hidden rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary md:inline-flex">
            {AGENTS.length} especialistas + síntese
          </span>
          <Link
            href="/comparar"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Comparar
          </Link>
          <Link
            href="/metodo"
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            Método
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-background/60 print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-5 text-center text-sm text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
        <p>
          <span className="font-serif font-semibold text-foreground/80">ANIMA</span> · análise narrativa multiagente
        </p>
        <p>Conteúdo gerado por IA. Confira fatos e referências antes de citar.</p>
      </div>
    </footer>
  );
}
