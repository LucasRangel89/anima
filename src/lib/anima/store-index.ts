// ANIMA — seleciona a implementação de persistência.
// ANIMA_STORE=memory usa memória (sem banco); caso contrário, Prisma/SQLite.

import type { AnalysisStore } from './store';
import { createMemoryStore } from './store-memory';

const g = globalThis as unknown as { __animaStore?: AnalysisStore };

export async function getStore(): Promise<AnalysisStore> {
  if (g.__animaStore) return g.__animaStore;
  if (process.env.ANIMA_STORE === 'memory') {
    g.__animaStore = createMemoryStore();
  } else {
    // import dinâmico: o cliente Prisma só é carregado quando realmente usado
    g.__animaStore = (await import('./store-prisma')).prismaStore;
  }
  return g.__animaStore;
}

/** Apenas para testes: injeta uma implementação. */
export function setStore(store: AnalysisStore | undefined): void {
  g.__animaStore = store;
}
