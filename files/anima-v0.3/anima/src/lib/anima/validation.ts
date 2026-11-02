// ANIMA — validação de entrada da API (zod).

import { z } from 'zod';
import { AGENT_KEYS, DEPTHS, WORK_KINDS } from './types';

/** Normaliza texto livre: remove controles, colapsa espaços e troca aspas duplas (delimitam o prompt). */
export function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/["“”]/g, "'")
    .trim();
}

export const createAnalysisSchema = z.object({
  title: z
    .string({ error: 'Informe o título da obra.' })
    .transform(cleanText)
    .pipe(z.string().min(2, 'O título precisa ter pelo menos 2 caracteres.').max(160, 'O título pode ter no máximo 160 caracteres.')),
  hint: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v ? cleanText(v).slice(0, 120) : ''))
    .transform((v) => v || null),
  kind: z.enum(WORK_KINDS).default('auto'),
  depth: z.enum(DEPTHS).default('standard'),
  /** true = ignora uma análise equivalente já concluída e gera uma nova */
  force: z.boolean().default(false),
});

export const retrySchema = z.object({
  agentKeys: z.array(z.enum(AGENT_KEYS)).max(AGENT_KEYS.length).optional(),
  research: z.boolean().optional(),
  synthesis: z.boolean().optional(),
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Requisição inválida.';
}
