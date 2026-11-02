// ANIMA — descoberta da API: o que existe, em que versão e quais limites valem.

import { NextResponse } from 'next/server';
import { availableSources } from '@/lib/anima/search';
import { activeRunCount, maxActiveRuns, maxQueuedRuns, queueLength } from '@/lib/anima/orchestrator';
import { AGENT_KEYS, DEPTHS, WORK_KINDS } from '@/lib/anima/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    name: 'ANIMA',
    description: 'Analisador Narrativo Inteligente Multiagente',
    version: '0.4.0',
    endpoints: {
      'POST /api/analyses': 'cria (ou enfileira) uma análise',
      'GET /api/analyses': 'histórico filtrado (?status=&kind=&limit=)',
      'GET /api/analyses/:id': 'análise com progresso, fontes e resultados',
      'DELETE /api/analyses/:id': 'exclui uma análise',
      'POST /api/analyses/:id/retry': 'reexecuta pesquisa, lentes e/ou síntese',
      'POST /api/analyses/:id/cancel': 'cancela preservando o que já foi escrito',
      'GET /api/status': 'provedor, fontes e fila',
    },
    lenses: AGENT_KEYS,
    kinds: WORK_KINDS,
    depths: DEPTHS,
    sources: availableSources(),
    queue: { active: activeRunCount(), max: maxActiveRuns(), waiting: queueLength(), queueMax: maxQueuedRuns() },
  });
}
