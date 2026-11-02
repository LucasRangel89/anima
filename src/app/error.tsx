'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Erro inesperado em uma rota: oferece recuperação sem perder o histórico (que está no servidor). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[anima] erro de interface:', error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-24 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
      <h1 className="mt-4 font-serif text-3xl font-semibold tracking-tight">Algo falhou nesta tela</h1>
      <p className="mt-3 text-muted-foreground">
        O trabalho em andamento continua salvo no servidor. Tente recarregar; se persistir, volte ao início e abra a
        análise pelo histórico.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button onClick={reset}>
          <RefreshCw aria-hidden /> Tentar de novo
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Ir para o início</Link>
        </Button>
      </div>
    </main>
  );
}
