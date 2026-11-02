// ANIMA — validação de entrada da API (zod).

import { z } from 'zod';
import { AGENT_KEYS, DEPTHS, WORK_KINDS } from './types';
import { isSafePublicUrl, normalizeUserSourceValue } from './user-sources';

/** Normaliza texto livre: remove controles, colapsa espaços e troca aspas duplas (delimitam o prompt). */
export function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/["“”]/g, "'")
    .trim();
}

/** Recorte: texto curto, sem quebras de linha, usado como instrução adicional nos prompts. */
const focusSchema = z
  .string()
  .max(240)
  .optional()
  .transform((v) => (v ? cleanText(v).slice(0, 200) : ''))
  .transform((v) => v || null);

/** Fontes enviadas pelo usuário: links (lidos pelo servidor) ou trechos colados. */
export const userSourceSchema = z.object({
  type: z.enum(['url', 'text']),
  value: z.string().min(1).max(8000),
});

export const MAX_USER_SOURCES = 5;

export const createAnalysisSchema = z.object({
  title: z
    .string({ error: 'Informe o título da obra.' })
    .transform(cleanText)
    .pipe(
      z
        .string()
        .min(2, 'O título precisa ter pelo menos 2 caracteres.')
        .max(160, 'O título pode ter no máximo 160 caracteres.')
    ),
  hint: z
    .string()
    .max(200)
    .optional()
    .transform((v) => (v ? cleanText(v).slice(0, 120) : ''))
    .transform((v) => v || null),
  focus: focusSchema,
  kind: z.enum(WORK_KINDS).default('auto'),
  depth: z.enum(DEPTHS).default('standard'),
  /** Subconjunto de lentes; ausente/vazio = todas. */
  agents: z
    .array(z.enum(AGENT_KEYS))
    .max(AGENT_KEYS.length)
    .optional()
    .transform((v) => (v && v.length > 0 ? [...new Set(v)] : AGENT_KEYS)),
  /** Até 5 fontes extras fornecidas pelo usuário */
  sources: z.array(userSourceSchema).max(MAX_USER_SOURCES).optional().default([]),
  /** true = ignora uma análise equivalente já concluída e gera uma nova */
  force: z.boolean().default(false),
});

export type CreateAnalysisPayload = z.infer<typeof createAnalysisSchema>;

/**
 * Valida e normaliza as fontes do usuário: URLs precisam ser públicas e http(s);
 * textos viram trechos. Entradas inválidas são rejeitadas com mensagem clara.
 */
export function validateUserSources(
  sources: Array<{ type: 'url' | 'text'; value: string }>
): { ok: true; sources: Array<{ type: 'url' | 'text'; value: string }> } | { ok: false; error: string } {
  const out: Array<{ type: 'url' | 'text'; value: string }> = [];
  for (const source of sources) {
    const value = normalizeUserSourceValue(source.value);
    if (!value) continue;
    if (source.type === 'url') {
      if (!isSafePublicUrl(value)) {
        return {
          ok: false,
          error: `Link inválido ou não permitido: ${value.slice(0, 80)}. Use endereços http(s) públicos.`,
        };
      }
      out.push({ type: 'url', value });
    } else {
      if (value.length < 40) {
        return { ok: false, error: 'Cada trecho colado precisa ter pelo menos 40 caracteres.' };
      }
      out.push({ type: 'text', value: value.slice(0, 6000) });
    }
  }
  return { ok: true, sources: out };
}

/** Pergunta de acompanhamento: curta, sem quebras de linha, sem aspas que delimitam o prompt. */
export const followUpSchema = z.object({
  question: z
    .string({ error: 'Escreva uma pergunta.' })
    .transform(cleanText)
    .refine((v) => v.length >= 3, { message: 'A pergunta precisa de pelo menos 3 caracteres.' })
    .refine((v) => v.length <= 500, { message: 'A pergunta é longa demais (máximo 500 caracteres).' }),
});

/** Comparação: duas análises diferentes, por id. */
export const comparisonSchema = z
  .object({
    leftId: z.string({ error: 'Escolha a primeira análise.' }).min(1, 'Escolha a primeira análise.').max(64),
    rightId: z.string({ error: 'Escolha a segunda análise.' }).min(1, 'Escolha a segunda análise.').max(64),
  })
  .refine((data) => data.leftId !== data.rightId, {
    message: 'Escolha duas análises diferentes.',
    path: ['rightId'],
  });

export const retrySchema = z.object({
  agentKeys: z.array(z.enum(AGENT_KEYS)).max(AGENT_KEYS.length).optional(),
  research: z.boolean().optional(),
  synthesis: z.boolean().optional(),
});

export const listQuerySchema = z.object({
  status: z.enum(['all', 'active', 'completed', 'failed', 'interrupted']).default('all'),
  kind: z.enum(['all', ...WORK_KINDS]).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Requisição inválida.';
}
