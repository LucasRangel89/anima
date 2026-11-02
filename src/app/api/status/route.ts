// ANIMA — API: estado de configuração (provedor de LLM, fontes) e ocupação da fila.

import { NextResponse } from 'next/server';
import { getSystemStatus } from '@/lib/anima/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: getSystemStatus() });
}
