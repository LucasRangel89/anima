// ANIMA — estado do sistema para a UI: configuração do LLM + fontes disponíveis + fila.
// Fica separado de `llm.ts` para evitar ciclo de imports (search → llm).

import { getSystemStatus as baseStatus, type BaseSystemStatus } from './llm';
import { activeRunCount, maxActiveRuns, queueLength } from './orchestrator';
import { availableSources } from './search';
import type { SystemStatusDTO } from './types';

export function getSystemStatus(env: NodeJS.ProcessEnv = process.env): SystemStatusDTO {
  const base: BaseSystemStatus = baseStatus(env);
  return {
    ...base,
    sources: availableSources(env),
    queue: { active: activeRunCount(), max: maxActiveRuns(), waiting: queueLength() },
  };
}
