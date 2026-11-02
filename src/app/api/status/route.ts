// ANIMA — API: estado de configuração (provedor de LLM, busca) para a UI avisar o usuário.

import { NextResponse } from 'next/server';
import { getSystemStatus } from '@/lib/anima/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: getSystemStatus() });
}
