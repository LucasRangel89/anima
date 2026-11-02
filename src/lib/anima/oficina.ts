// ANIMA — oficina: o modo manual, sem servidor e sem chave.
//
// O app "de verdade" chama o modelo por API. Aqui o modelo é o chat que você já usa: a oficina monta os
// MESMOS prompts do ANIMA, você cola no chat e traz as respostas de volta. Ela então monta a leitura
// integrada, confere a forma (mesma régua do `eval`) e exporta.
//
// Nada neste arquivo faz rede: ele é seguro para rodar no navegador e é o que o teste de unidade cobre.

import { AGENT_LABELS, AGENT_LABEL_LIST } from './agent-labels';
import { checkSection, countDaggers, countWords, type SectionCheck } from './eval';
import { buildObsidianVault, buildReportMarkdown } from './export';
import {
  DEPTH_CONFIG,
  RESEARCHER_PROMPT,
  buildResearcherUserMessage,
  buildSpecialistUserMessage,
  buildSynthesisUserMessage,
  getSpecialistPrompt,
  getSynthesisPrompt,
} from './prompts';
import {
  AGENT_KEYS,
  DEPTH_LABELS,
  WORK_KIND_LABELS,
  type AgentKey,
  type AnalysisDTO,
  type Depth,
  type WorkKind,
} from './types';

/** O que o formulário pergunta — e o que os prompts precisam saber. */
export interface OficinaInput {
  title: string;
  hint: string | null;
  focus: string | null;
  kind: WorkKind;
  depth: Depth;
}

/** Como o usuário prefere conversar com o chat: uma conversa só ou uma por lente. */
export type OficinaMode = 'single' | 'perLens';

/** Texto que o usuário cola de volta do chat. */
export interface OficinaParts {
  dossier: string;
  lenses: Partial<Record<AgentKey, string>>;
  synthesis: string;
}

export interface OficinaLensPrompt {
  key: AgentKey;
  name: string;
  short: string;
  prompt: string;
}

const MANUAL_SOURCES = [
  '(modo manual: o ANIMA não coletou fontes nesta etapa.)',
  'Se você tem acesso à web, pesquise e cite as fontes com link.',
  'Se não tem, use seu conhecimento e marque cada afirmação factual com "(conhecimento do modelo)".',
].join(' ');

const OUTPUT_NOTE =
  'Responda apenas com a análise, em markdown, sem comentários sobre a tarefa. Não repita estas instruções.';

function workLine(input: OficinaInput): string {
  const parts = [
    `**Obra:** ${input.title}`,
    input.hint ? `**Dica:** ${input.hint}` : null,
    `**Meio:** ${WORK_KIND_LABELS[input.kind]}`,
    `**Profundidade:** ${DEPTH_LABELS[input.depth].label}`,
    input.focus ? `**Recorte:** ${input.focus}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/* ───────────────────────── Prompts ───────────────────────── */

/** Etapa 1: o dossiê factual. É o mesmo pesquisador do app, sem fontes coletadas. */
export function buildDossierPrompt(input: OficinaInput): string {
  return [
    `# Oficina ANIMA — etapa 1 de 3: dossiê`,
    workLine(input),
    '',
    'Você vai receber duas partes: as instruções do Agente Pesquisador do ANIMA e a tarefa.',
    'Cole o bloco inteiro numa conversa nova. Se o chat tiver busca na web, peça que ele use.',
    '',
    '---',
    '',
    RESEARCHER_PROMPT,
    '',
    '---',
    '',
    buildResearcherUserMessage(input.title, input.hint, input.kind, MANUAL_SOURCES, input.focus),
    '',
    OUTPUT_NOTE,
  ].join('\n');
}

/** Etapa 2a: uma conversa por lente — o modo fiel ao app (cada especialista recebe o dossiê inteiro). */
export function buildLensPrompts(input: OficinaInput, dossier: string): OficinaLensPrompt[] {
  return AGENT_KEYS.map((key) => {
    const label = AGENT_LABELS[key];
    return {
      key,
      name: label.name,
      short: label.short,
      prompt: [
        `# Oficina ANIMA — etapa 2: ${label.name}`,
        workLine(input),
        '',
        getSpecialistPrompt(key, { depth: input.depth, kind: input.kind }),
        '',
        '---',
        '',
        buildSpecialistUserMessage(input.title, input.hint, input.kind, dossier, input.focus),
        '',
        OUTPUT_NOTE,
      ].join('\n'),
    };
  });
}

/** Etapa 2b: uma conversa só, com as oito lentes de uma vez — menos colagem, mais exigência no formato. */
export function buildPackPrompt(input: OficinaInput, dossier: string): string {
  const { minWords, maxWords } = DEPTH_CONFIG[input.depth];
  const lenses = AGENT_LABEL_LIST.map((label, index) =>
    [
      `## ${index + 1}. ${label.name} — ${label.role}`,
      label.tagline,
      `Perguntas que esta lente responde: ${label.questions.join(' ')}`,
    ].join('\n')
  ).join('\n\n');

  return [
    '# Oficina ANIMA — as oito lentes numa conversa',
    workLine(input),
    '',
    'Você é o consórcio de oito especialistas do ANIMA. Vai produzir uma análise por lente, na ordem',
    'abaixo, cada uma com voz própria e sem repetir as outras.',
    '',
    '## Regras',
    `- Cada lente tem de ${minWords} a ${maxWords} palavras.`,
    '- Toda lente termina com a seção `### Limites e verificações`: o que a leitura não alcança, que',
    '  evidência faltaria e onde você está extrapolando.',
    '- Marque com † o que vier do seu conhecimento e não do dossiê.',
    '- Nomeie a teoria usada (autor, conceito) e diga o que ela ilumina e o que ela distorce.',
    '- Nada de elogio vago: toda afirmação precisa de evidência na obra.',
    '- Se o dossiê não bastar para uma lente, diga o que faltaria em vez de inventar.',
    '',
    '## Formato de saída (obrigatório)',
    'Use exatamente estes títulos de nível 2, um por lente, nesta ordem, e nada fora deles:',
    ...AGENT_LABEL_LIST.map((label) => `- \`## ${label.name}\``),
    '',
    '<dossie>',
    dossier,
    '</dossie>',
    '',
    '## As oito lentes',
    lenses,
    '',
    OUTPUT_NOTE,
  ].join('\n');
}

/** Etapa 3: a síntese integrada, com o dossiê e as análises que voltaram. */
export function buildOficinaSynthesisPrompt(input: OficinaInput, parts: OficinaParts): string {
  const analyses = AGENT_KEYS.filter((key) => parts.lenses[key]).map((key) => ({
    agent: AGENT_LABELS[key].name,
    content: parts.lenses[key] as string,
  }));
  const missing = AGENT_KEYS.filter((key) => !parts.lenses[key]).map((key) => AGENT_LABELS[key].name);

  return [
    '# Oficina ANIMA — etapa 3 de 3: síntese integrada',
    workLine(input),
    '',
    getSynthesisPrompt(input.depth, input.kind),
    '',
    '---',
    '',
    buildSynthesisUserMessage(input.title, input.hint, input.kind, parts.dossier, analyses, missing, input.focus),
    '',
    OUTPUT_NOTE,
  ].join('\n');
}

/* ───────────────────────── Leitura da resposta ───────────────────────── */

/** Minúsculas, sem acento e sem pontuação — para casar títulos escritos de jeitos diferentes. */
export function normalizeHeading(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADING = /^#{1,4}\s+(.+?)\s*#*\s*$/;

/**
 * Quebra a resposta do chat em uma seção por lente. Casa pelo nome ("Agente Estrutural"), pelo rótulo
 * curto ("Estrutura") ou pela chave em inglês ("structural"), com ou sem numeração na frente.
 */
export function parseLensSections(text: string): Partial<Record<AgentKey, string>> {
  const found: Partial<Record<AgentKey, string>> = {};
  if (!text.trim()) return found;

  const lines = text.split(/\r?\n/);
  const targets = AGENT_KEYS.map((key) => ({
    id: key,
    name: normalizeHeading(AGENT_LABELS[key].name),
    short: normalizeHeading(AGENT_LABELS[key].short),
    english: normalizeHeading(key),
  }));

  const match = (heading: string): AgentKey | null => {
    const clean = normalizeHeading(heading.replace(/^\d+[.)]\s*/, ''));
    if (!clean) return null;
    const byName = targets.find((t) => clean === t.name || clean.includes(t.name));
    if (byName) return byName.id;
    const byShort = targets.find((t) => clean === t.short || clean.startsWith(`${t.short} `));
    if (byShort) return byShort.id;
    const byKey = targets.find((t) => clean === t.english);
    return byKey?.id ?? null;
  };

  const buckets = new Map<AgentKey, string[]>();
  let current: AgentKey | null = null;

  for (const line of lines) {
    const heading = HEADING.exec(line.trim());
    if (heading) {
      const hit = match(heading[1]);
      if (hit) {
        current = hit;
        if (!buckets.has(hit)) buckets.set(hit, []);
        continue;
      }
      // Título de nível 1–2 desconhecido fecha a lente: o que vem depois não é dela. Já os subtítulos
      // internos (###) fazem parte do texto da própria lente e continuam no bloco.
      const level = (/^#+/.exec(line.trim()) ?? [''])[0].length;
      if (level <= 2) current = null;
    }
    if (current) buckets.get(current)?.push(line);
  }

  for (const [key, chunk] of buckets) {
    const content = chunk.join('\n').trim();
    if (content) found[key] = content;
  }
  return found;
}

/** Junta o que voltou (dossiê, lentes, síntese) numa análise no formato do app. */
export function assembleAnalysis(
  input: OficinaInput,
  parts: OficinaParts,
  options: { id?: string; now?: Date } = {}
): AnalysisDTO {
  const now = (options.now ?? new Date()).toISOString();
  const usable = AGENT_KEYS.filter((key) => (parts.lenses[key] ?? '').trim().length > 0);

  return {
    id: options.id ?? 'oficina',
    title: input.title,
    hint: input.hint,
    focus: input.focus,
    kind: input.kind,
    depth: input.depth,
    status: 'completed',
    research: parts.dossier.trim() || null,
    researchStatus: parts.dossier.trim() ? 'done' : 'skipped',
    sources: [],
    synthesis: parts.synthesis.trim() || null,
    synthesisStatus: parts.synthesis.trim() ? 'done' : 'skipped',
    error: null,
    durationMs: null,
    model: null,
    usage: null,
    createdAt: now,
    updatedAt: now,
    results: AGENT_KEYS.map((key) => ({
      agentKey: key,
      status: usable.includes(key) ? 'done' : 'skipped',
      content: usable.includes(key) ? (parts.lenses[key] as string) : null,
      error: null,
      durationMs: null,
    })),
    progress: 100,
    queuePosition: null,
    followUps: [],
  };
}

/* ───────────────────────── Conferência e exportação ───────────────────────── */

export interface OficinaReport {
  dto: AnalysisDTO;
  checks: SectionCheck[];
  words: number;
  daggers: number;
  withLimits: number;
  inRange: number;
  missing: AgentKey[];
  /** Frases curtas para o topo do resultado. Vazio quando está tudo no lugar. */
  warnings: string[];
}

/** A mesma régua do `npm run eval`, aplicada na hora — informa, não bloqueia. */
export function officeReport(dto: AnalysisDTO): OficinaReport {
  const present = dto.results.filter((r) => r.status === 'done' && r.content);
  const checks = present.map((r) => checkSection(r.agentKey, r.content as string, dto.depth));
  const missing = AGENT_KEYS.filter((key) => !present.some((r) => r.agentKey === key));
  const warnings: string[] = [];

  const outOfRange = checks.filter((c) => !c.withinRange && c.words > 0);
  if (outOfRange.length > 0) {
    warnings.push(
      `${outOfRange.length} lente(s) fora da faixa de ${DEPTH_CONFIG[dto.depth].minWords}–${DEPTH_CONFIG[dto.depth].maxWords} palavras.`
    );
  }
  const withoutLimits = checks.filter((c) => !c.hasLimits);
  if (withoutLimits.length > 0) {
    warnings.push(`${withoutLimits.length} lente(s) sem a seção "Limites e verificações".`);
  }
  if (missing.length > 0) {
    warnings.push(`${missing.length} lente(s) não voltaram: ${missing.map((k) => AGENT_LABELS[k].short).join(', ')}.`);
  }
  if (!dto.synthesis) warnings.push('A síntese integrada ficou de fora.');
  if (!dto.research) warnings.push('O dossiê ficou de fora — as lentes podem ter inventado contexto.');

  return {
    dto,
    checks,
    words: checks.reduce((sum, c) => sum + c.words, 0),
    daggers: checks.reduce((sum, c) => sum + c.daggers, 0),
    withLimits: checks.filter((c) => c.hasLimits).length,
    inRange: checks.filter((c) => c.withinRange).length,
    missing,
    warnings,
  };
}

export function officeMarkdown(dto: AnalysisDTO): string {
  return buildReportMarkdown(dto);
}

export function officeVault(dto: AnalysisDTO): { filename: string; bytes: Uint8Array<ArrayBuffer> } {
  const vault = buildObsidianVault(dto);
  return { filename: vault.filename, bytes: vault.bytes };
}

/** Nome de arquivo seguro, sem acento e sem espaço. */
export function officeFileName(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'anima'}-oficina.md`;
}

/** Contagem simples para a interface mostrar progresso de colagem. */
export function pastedWords(text: string): number {
  return countWords(text);
}

export function daggersIn(text: string): number {
  return countDaggers(text);
}
