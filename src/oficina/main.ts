// ANIMA — oficina estática (modo manual).
//
// Roda 100% no navegador: nada de servidor, nada de chave de API. O modelo é o chat que a pessoa já usa.
// A oficina monta os mesmos prompts do app, recebe os textos de volta e monta a leitura integrada.

import { AGENT_LABELS, AGENT_LABEL_LIST } from '../lib/anima/agent-labels';
import {
  assembleAnalysis,
  buildDossierPrompt,
  buildLensPrompts,
  buildOficinaSynthesisPrompt,
  buildPackPrompt,
  officeFileName,
  officeMarkdown,
  officeReport,
  officeVault,
  parseLensSections,
  type OficinaInput,
  type OficinaMode,
  type OficinaParts,
} from '../lib/anima/oficina';
import {
  AGENT_KEYS,
  DEPTHS,
  DEPTH_LABELS,
  WORK_KINDS,
  WORK_KIND_LABELS,
  type AgentKey,
  type AnalysisDTO,
  type Depth,
  type WorkKind,
} from '../lib/anima/types';

/* ───────────────────────── Estado ───────────────────────── */

const DRAFT_KEY = 'anima-oficina-rascunho-v1';
const HISTORY_KEY = 'anima-oficina-historico-v1';

interface Draft {
  input: OficinaInput;
  mode: OficinaMode;
  parts: OficinaParts;
}

interface Stored extends Draft {
  id: string;
  savedAt: string;
  dto: AnalysisDTO;
}

const emptyInput = (): OficinaInput => ({
  title: '',
  hint: null,
  focus: null,
  kind: 'auto',
  depth: 'standard',
});

const emptyParts = (): OficinaParts => ({ dossier: '', lenses: {}, synthesis: '' });

const state: { draft: Draft; dto: AnalysisDTO | null; history: Stored[] } = {
  draft: { input: emptyInput(), mode: 'single', parts: emptyParts() },
  dto: null,
  history: [],
};

/* ───────────────────────── Utilidades ───────────────────────── */

function el<T extends HTMLElement>(selector: string, root: ParentNode = document): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`elemento ausente: ${selector}`);
  return found as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

/** Markdown mínimo — o suficiente para ler o relatório sem trazer um conversor inteiro. */
export function renderMarkdown(markdown: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const closeList = (): void => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const closeParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.join(' ')}</p>`);
      paragraph = [];
    }
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeParagraph();
      closeList();
      out.push('<hr>');
      continue;
    }
    if (line.startsWith('> ')) {
      closeParagraph();
      closeList();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      closeParagraph();
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }
    closeList();
    paragraph.push(inline(line));
  }
  closeParagraph();
  closeList();
  return out.join('\n');
}

function storage(): Storage | null {
  try {
    const probe = '__anima__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadDraft(): void {
  const store = storage();
  if (!store) return;
  const raw = store.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (parsed.input && parsed.parts) {
      state.draft = {
        input: { ...emptyInput(), ...parsed.input },
        mode: parsed.mode === 'perLens' ? 'perLens' : 'single',
        parts: { ...emptyParts(), ...parsed.parts },
      };
    }
  } catch {
    store.removeItem(DRAFT_KEY);
  }
}

function saveDraft(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(state.draft));
  } catch {
    /* sem espaço: seguir sem rascunho é melhor do que travar */
  }
}

function loadHistory(): void {
  const store = storage();
  if (!store) return;
  try {
    const parsed = JSON.parse(store.getItem(HISTORY_KEY) ?? '[]') as Stored[];
    state.history = Array.isArray(parsed) ? parsed : [];
  } catch {
    state.history = [];
  }
}

function saveHistory(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 30)));
  } catch {
    /* idem */
  }
}

function invalidateResult(): void {
  // Sempre redesenha: o botão "Montar a leitura" só aparece quando a etapa está pronta, e é justamente
  // ao colar o dossiê/lentes que ela fica pronta.
  state.dto = null;
  renderResult();
}

function notify(message: string): void {
  const target = document.getElementById('aviso');
  if (target) {
    target.textContent = message;
    target.classList.add('show');
    window.setTimeout(() => target.classList.remove('show'), 2600);
  }
}

async function copyText(selector: string, button: HTMLButtonElement): Promise<void> {
  const field = el<HTMLTextAreaElement>(selector);
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(field.value);
  } catch {
    field.select();
    document.execCommand('copy');
  }
  button.textContent = 'Copiado';
  window.setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `oficina-${Date.now()}`;
}

/* ───────────────────────── Cabeçalho de obra ───────────────────────── */

function workSummary(input: OficinaInput): string {
  return [
    input.title,
    WORK_KIND_LABELS[input.kind],
    DEPTH_LABELS[input.depth].label,
    input.focus ? `recorte: ${input.focus}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function currentPrompts(): { dossier: string; lenses: ReturnType<typeof buildLensPrompts>; pack: string } {
  const { input, parts } = state.draft;
  const dossier = parts.dossier.trim();
  const lenses = dossier ? buildLensPrompts(input, dossier) : [];
  const pack = dossier ? buildPackPrompt(input, dossier) : '';
  return { dossier: buildDossierPrompt(input), lenses, pack };
}

/* ───────────────────────── Renderização dos passos ───────────────────────── */

function renderDossier(): void {
  const { input, parts } = state.draft;
  const prompt = buildDossierPrompt(input);
  el('#corpo-dossie').innerHTML = `
    <p class="step-hint">
      Abra o chat, cole o bloco abaixo numa conversa <strong>nova</strong> e espere a resposta.
      Quanto melhor o dossiê, melhores as oito lentes — ele é a base de fatos de todas elas.
    </p>
    <div class="field">
      <label for="prompt-dossie">Prompt do dossiê — ${escapeHtml(workSummary(input))}</label>
      <textarea id="prompt-dossie" class="prompt" readonly rows="10">${escapeHtml(prompt)}</textarea>
      <div class="row">
        <button type="button" class="mini" data-copy="#prompt-dossie">Copiar prompt</button>
        <span class="fine">${prompt.length.toLocaleString('pt-BR')} caracteres</span>
      </div>
    </div>
    <div class="field">
      <label for="paste-dossie">Cole aqui o dossiê que voltou</label>
      <textarea id="paste-dossie" rows="8" placeholder="Cole a resposta do chat. Ela entra inteira nos prompts das lentes.">${escapeHtml(parts.dossier)}</textarea>
      <p class="fine" id="dossie-conta">${parts.dossier.trim() ? `${parts.dossier.trim().length.toLocaleString('pt-BR')} caracteres colados` : 'Ainda vazio'}</p>
    </div>`;

  el<HTMLButtonElement>('#corpo-dossie [data-copy]').addEventListener('click', (event) =>
    copyText('#prompt-dossie', event.currentTarget as HTMLButtonElement)
  );

  const paste = el<HTMLTextAreaElement>('#paste-dossie');
  paste.addEventListener('input', () => {
    state.draft.parts.dossier = paste.value;
    saveDraft();
    el('#dossie-conta').textContent = paste.value.trim()
      ? `${paste.value.trim().length.toLocaleString('pt-BR')} caracteres colados`
      : 'Ainda vazio';
    invalidateResult();
    renderLenses();
    renderSynthesis();
  });
}

function lensStatus(): { found: AgentKey[]; missing: AgentKey[] } {
  const found = AGENT_KEYS.filter((key) => (state.draft.parts.lenses[key] ?? '').trim().length > 0);
  return { found, missing: AGENT_KEYS.filter((key) => !found.includes(key)) };
}

function renderLenses(): void {
  const { input, mode, parts } = state.draft;
  const body = el('#corpo-lentes');
  const prompts = currentPrompts();

  if (!parts.dossier.trim()) {
    body.innerHTML = `<p class="step-empty">Cole o dossiê na etapa anterior para liberar os prompts das lentes.</p>`;
    return;
  }

  if (mode === 'single') {
    const { found, missing } = lensStatus();
    body.innerHTML = `
      <p class="step-hint">
        Uma conversa, oito lentes. Cole o bloco abaixo e devolva a resposta inteira no campo de baixo:
        a oficina separa as seções pelos títulos <code>## ${escapeHtml(AGENT_LABELS.structural.name)}</code>…
      </p>
      <div class="field">
        <label for="prompt-pacote">Prompt das oito lentes — ${escapeHtml(workSummary(input))}</label>
        <textarea id="prompt-pacote" class="prompt" readonly rows="10">${escapeHtml(prompts.pack)}</textarea>
        <div class="row">
          <button type="button" class="mini" data-copy="#prompt-pacote">Copiar prompt</button>
          <span class="fine">${prompts.pack.length.toLocaleString('pt-BR')} caracteres</span>
        </div>
      </div>
      <div class="field">
        <label for="paste-lentes">Cole aqui a resposta com as oito seções</label>
        <textarea id="paste-lentes" rows="10" placeholder="## ${escapeHtml(AGENT_LABELS.structural.name)}
…
## ${escapeHtml(AGENT_LABELS.critical.name)}">${escapeHtml(packPaste())}</textarea>
        <p class="fine" id="lentes-conta">${found.length} de 8 lentes reconhecidas${missing.length ? ` — faltam: ${missing.map((k) => AGENT_LABELS[k].short).join(', ')}` : ''}</p>
      </div>`;

    el<HTMLButtonElement>('#corpo-lentes [data-copy]').addEventListener('click', (event) =>
      copyText('#prompt-pacote', event.currentTarget as HTMLButtonElement)
    );
    const paste = el<HTMLTextAreaElement>('#paste-lentes');
    paste.addEventListener('input', () => {
      const parsed = parseLensSections(paste.value);
      state.draft.parts.lenses = parsed;
      saveDraft();
      const { found, missing } = lensStatus();
      el('#lentes-conta').textContent = `${found.length} de 8 lentes reconhecidas${
        missing.length ? ` — faltam: ${missing.map((k) => AGENT_LABELS[k].short).join(', ')}` : ''
      }`;
      invalidateResult();
      renderSynthesis();
    });
    return;
  }

  body.innerHTML = `
    <p class="step-hint">
      Uma conversa por lente. Faça na ordem que quiser — dá para voltar depois: o que você colar fica
      salvo neste navegador.
    </p>
    ${AGENT_LABEL_LIST.map((label, index) => {
      const prompt = prompts.lenses.find((item) => item.key === label.key)?.prompt ?? '';
      const content = parts.lenses[label.key] ?? '';
      return `
      <details class="lens-step" ${content ? '' : index === 0 ? 'open' : ''}>
        <summary>
          <span class="lens-step-index">${String(index + 1).padStart(2, '0')}</span>
          <span>${escapeHtml(label.name)}</span>
          <span class="lens-step-state ${content ? 'done' : ''}">${content ? 'colada' : 'pendente'}</span>
        </summary>
        <div class="field">
          <textarea id="prompt-${label.key}" class="prompt" readonly rows="8">${escapeHtml(prompt)}</textarea>
          <div class="row">
            <button type="button" class="mini" data-copy="#prompt-${label.key}">Copiar prompt</button>
            <span class="fine">${prompt.length.toLocaleString('pt-BR')} caracteres</span>
          </div>
        </div>
        <div class="field">
          <label for="paste-${label.key}">Cole aqui a resposta desta lente</label>
          <textarea id="paste-${label.key}" rows="6">${escapeHtml(content)}</textarea>
        </div>
      </details>`;
    }).join('')}`;

  for (const button of body.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
    button.addEventListener('click', () => copyText(button.dataset.copy ?? '#prompt-dossie', button));
  }
  for (const key of AGENT_KEYS) {
    const paste = body.querySelector<HTMLTextAreaElement>(`#paste-${key}`);
    if (!paste) continue;
    paste.addEventListener('input', () => {
      state.draft.parts.lenses[key] = paste.value;
      saveDraft();
      const details = paste.closest('details');
      const badge = details?.querySelector('.lens-step-state');
      if (badge) {
        badge.textContent = paste.value.trim() ? 'colada' : 'pendente';
        badge.classList.toggle('done', Boolean(paste.value.trim()));
      }
      invalidateResult();
      renderSynthesis();
    });
  }
}

function packPaste(): string {
  return AGENT_KEYS.map((key) => {
    const content = state.draft.parts.lenses[key];
    return content ? `## ${AGENT_LABELS[key].name}\n\n${content}` : '';
  })
    .filter(Boolean)
    .join('\n\n');
}

function renderSynthesis(): void {
  const { input, parts } = state.draft;
  const body = el('#corpo-sintese');
  const { found } = lensStatus();

  if (!parts.dossier.trim() || found.length === 0) {
    body.innerHTML = `<p class="step-empty">A síntese precisa do dossiê e de pelo menos uma lente colada.</p>`;
    return;
  }

  const prompt = buildOficinaSynthesisPrompt(input, parts);
  body.innerHTML = `
    <p class="step-hint">
      Agora o texto que integra as lentes. Se você mudou alguma resposta, use
      <strong>Atualizar prompt</strong> antes de copiar.
    </p>
    <div class="field">
      <label for="prompt-sintese">Prompt da síntese — ${escapeHtml(workSummary(input))}</label>
      <textarea id="prompt-sintese" class="prompt" readonly rows="10">${escapeHtml(prompt)}</textarea>
      <div class="row">
        <button type="button" class="mini" data-copy="#prompt-sintese">Copiar prompt</button>
        <button type="button" class="mini ghost" data-refresh>Atualizar prompt</button>
        <span class="fine">${prompt.length.toLocaleString('pt-BR')} caracteres</span>
      </div>
    </div>
    <div class="field">
      <label for="paste-sintese">Cole aqui a síntese integrada</label>
      <textarea id="paste-sintese" rows="8">${escapeHtml(parts.synthesis)}</textarea>
    </div>`;

  el<HTMLButtonElement>('#corpo-sintese [data-copy]').addEventListener('click', (event) =>
    copyText('#prompt-sintese', event.currentTarget as HTMLButtonElement)
  );
  el<HTMLButtonElement>('#corpo-sintese [data-refresh]').addEventListener('click', () => renderSynthesis());

  const paste = el<HTMLTextAreaElement>('#paste-sintese');
  paste.addEventListener('input', () => {
    state.draft.parts.synthesis = paste.value;
    saveDraft();
    invalidateResult();
  });
}

function renderResult(): void {
  const body = el('#corpo-resultado');
  const { input, parts } = state.draft;
  const { found } = lensStatus();
  const ready = Boolean(parts.dossier.trim()) && found.length > 0;

  if (!ready) {
    body.innerHTML = `<p class="step-empty">Volte às etapas anteriores: faltam o dossiê ou as lentes.</p>`;
    return;
  }

  if (!state.dto) {
    body.innerHTML = `
      <p class="step-hint">
        A leitura integrada junta dossiê, lentes e síntese num relatório só. A conferência abaixo segue a
        mesma régua do app — ela aponta o que está fraco, não impede você de usar.
      </p>
      <button type="button" class="button" id="btn-montar">Montar a leitura integrada</button>`;
    el<HTMLButtonElement>('#btn-montar').addEventListener('click', () => {
      state.dto = assembleAnalysis(input, parts, { now: new Date() });
      renderResult();
      el('#corpo-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }

  const report = officeReport(state.dto);
  const file = officeFileName(input.title);
  const checkRows = report.checks
    .map(
      (check) => `<tr>
        <td>${escapeHtml(AGENT_LABELS[check.agentKey].short)}</td>
        <td class="num">${check.words}</td>
        <td class="num">${check.min}–${check.max}</td>
        <td>${check.withinRange ? 'na faixa' : 'fora'}</td>
        <td>${check.hasLimits ? 'sim' : '—'}</td>
        <td class="num">${check.daggers}</td>
      </tr>`
    )
    .join('');

  body.innerHTML = `
    <div class="result-head">
      <div>
        <h3>${escapeHtml(input.title)}</h3>
        <p class="fine">${escapeHtml(workSummary(input))}</p>
      </div>
      <div class="row">
        <button type="button" class="mini" id="btn-md">Baixar .md</button>
        <button type="button" class="mini" id="btn-zip">Baixar .zip (Obsidian)</button>
        <button type="button" class="mini ghost" id="btn-salvar">Salvar no histórico</button>
      </div>
    </div>

    <ul class="warnings">
      ${
        report.warnings.length
          ? report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')
          : '<li class="ok">Nada a apontar na forma: todas as lentes na faixa, com limites e com †.</li>'
      }
    </ul>

    <div class="table-wrap">
      <table>
        <caption class="sr-only">Conferência de forma por lente</caption>
        <thead>
          <tr><th scope="col">Lente</th><th scope="col" class="num">Palavras</th><th scope="col" class="num">Faixa</th>
          <th scope="col">Faixa?</th><th scope="col">Limites</th><th scope="col" class="num">†</th></tr>
        </thead>
        <tbody>${checkRows}</tbody>
      </table>
    </div>

    <p class="fine">
      ${report.checks.length} lente(s) · ${report.words.toLocaleString('pt-BR')} palavras ·
      ${report.withLimits} com "Limites e verificações" · ${report.daggers} marca(s) †.
      Referências citadas nas lentes <strong>não</strong> foram conferidas automaticamente.
    </p>

    <div class="report-body">${renderMarkdown(officeMarkdown(state.dto))}</div>
    <p class="fine">
      Texto gerado por IA a partir do que você colou. Confira fatos e referências antes de citar.
    </p>`;

  el<HTMLButtonElement>('#btn-md').addEventListener('click', () => {
    download(file, new Blob([officeMarkdown(state.dto as AnalysisDTO)], { type: 'text/markdown;charset=utf-8' }));
  });
  el<HTMLButtonElement>('#btn-zip').addEventListener('click', () => {
    const vault = officeVault(state.dto as AnalysisDTO);
    download(vault.filename, new Blob([vault.bytes], { type: 'application/zip' }));
  });
  el<HTMLButtonElement>('#btn-salvar').addEventListener('click', () => {
    const stored: Stored = {
      ...state.draft,
      id: newId(),
      savedAt: new Date().toISOString(),
      dto: state.dto as AnalysisDTO,
    };
    state.history = [stored, ...state.history.filter((item) => item.dto.title !== stored.dto.title)].slice(0, 30);
    saveHistory();
    renderHistory();
    notify('Análise salva neste navegador.');
  });
}

function renderHistory(): void {
  const list = el('#lista-historico');
  if (state.history.length === 0) {
    list.innerHTML = `<li class="step-empty">Nada salvo ainda. Uma leitura salva fica disponível mesmo depois de fechar o navegador.</li>`;
    return;
  }
  list.innerHTML = state.history
    .map((item) => {
      const lenses = item.dto.results.filter((r) => r.status === 'done').length;
      const date = new Date(item.savedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
      return `<li class="history-item">
        <div>
          <strong>${escapeHtml(item.dto.title)}</strong>
          <span class="fine">${date} · ${lenses} lente(s)</span>
        </div>
        <div class="row">
          <button type="button" class="mini" data-open="${escapeHtml(item.id)}">Abrir</button>
          <button type="button" class="mini ghost" data-remove="${escapeHtml(item.id)}">Remover</button>
        </div>
      </li>`;
    })
    .join('');

  for (const button of list.querySelectorAll<HTMLButtonElement>('[data-open]')) {
    button.addEventListener('click', () => {
      const item = state.history.find((candidate) => candidate.id === button.dataset.open);
      if (!item) return;
      state.draft = { input: item.input, mode: item.mode, parts: item.parts };
      state.dto = item.dto;
      fillForm();
      showSteps();
      el('#corpo-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  for (const button of list.querySelectorAll<HTMLButtonElement>('[data-remove]')) {
    button.addEventListener('click', () => {
      state.history = state.history.filter((candidate) => candidate.id !== button.dataset.remove);
      saveHistory();
      renderHistory();
    });
  }
}

/* ───────────────────────── Formulário ───────────────────────── */

function fillForm(): void {
  const { input, mode } = state.draft;
  el<HTMLInputElement>('#obra-titulo').value = input.title;
  el<HTMLInputElement>('#obra-dica').value = input.hint ?? '';
  el<HTMLInputElement>('#obra-recorte').value = input.focus ?? '';
  el<HTMLSelectElement>('#obra-tipo').value = input.kind;
  el<HTMLSelectElement>('#obra-profundidade').value = input.depth;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="modo"]')) {
    radio.checked = radio.value === mode;
  }
}

function readForm(): OficinaInput {
  return {
    title: el<HTMLInputElement>('#obra-titulo').value.trim(),
    hint: el<HTMLInputElement>('#obra-dica').value.trim() || null,
    focus: el<HTMLInputElement>('#obra-recorte').value.trim() || null,
    kind: el<HTMLSelectElement>('#obra-tipo').value as WorkKind,
    depth: el<HTMLSelectElement>('#obra-profundidade').value as Depth,
  };
}

function showSteps(): void {
  el('#passos').hidden = false;
  renderDossier();
  renderLenses();
  renderSynthesis();
  renderResult();
}

function initForm(): void {
  const kindSelect = el<HTMLSelectElement>('#obra-tipo');
  kindSelect.innerHTML = WORK_KINDS.map(
    (kind) => `<option value="${kind}">${escapeHtml(WORK_KIND_LABELS[kind])}</option>`
  ).join('');

  const depthSelect = el<HTMLSelectElement>('#obra-profundidade');
  depthSelect.innerHTML = DEPTHS.map(
    (depth) =>
      `<option value="${depth}">${escapeHtml(DEPTH_LABELS[depth].label)} — ${DEPTH_LABELS[depth].words[0]}–${DEPTH_LABELS[depth].words[1]} palavras por lente</option>`
  ).join('');

  el<HTMLFormElement>('#form-obra').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = readForm();
    if (!input.title) {
      el('#obra-titulo').focus();
      notify('Escreva o nome da obra para começar.');
      return;
    }
    const changed = input.title !== state.draft.input.title || input.kind !== state.draft.input.kind;
    state.draft.input = input;
    if (changed) {
      state.dto = null;
      if (Object.keys(state.draft.parts.lenses).length > 0) {
        notify('Obra ou meio mudaram: as lentes coladas foram limpas.');
      }
      state.draft.parts = { ...state.draft.parts, lenses: {} };
    }
    state.draft.mode = (document.querySelector<HTMLInputElement>('input[name="modo"]:checked')?.value ?? 'single') as OficinaMode;
    saveDraft();
    showSteps();
    el('#passo-dossie').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ───────────────────────── Início ───────────────────────── */

export function start(): void {
  loadDraft();
  loadHistory();
  initForm();
  fillForm();
  renderHistory();
  if (state.draft.input.title) showSteps();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        /* offline é bônus: sem service worker a oficina continua funcionando */
      });
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
