import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-24 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="mt-3 text-muted-foreground">
        O endereço pode estar incorreto ou a análise pode ter sido excluída do histórico.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/">Voltar ao início</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/metodo">Ver o método</Link>
        </Button>
      </div>
    </main>
  );
}
