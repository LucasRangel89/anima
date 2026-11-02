#!/usr/bin/env node
// ANIMA — auditoria de UI verificável sem navegador.
//
// 1. Contraste WCAG 2.1 dos pares de cor reais do tema (globals.css, oklch) — claro e escuro.
// 2. Estrutura/HTML servido nas rotas: landmarks, hierarquia de títulos, nomes acessíveis de
//    botões e links, rótulos de campos, lang, viewport.
//
// O que NÃO faz: layout, espaçamento, sobreposição, quebras de linha. Isso exige navegador.
//
// Uso:  node scripts/audit-ui.mjs [http://127.0.0.1:3000]

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';

/* ─────────────── cor: oklch → sRGB → luminância relativa ─────────────── */

function oklchToSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => Math.min(1, Math.max(0, v)));
}

/** #rrggbb → componentes lineares (o espaço em que a luminância relativa é definida). */
function hexToLinear(hex) {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

function luminance(linear) {
  const [r, g, b] = linear;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(hex1, hex2) {
  const [a, b] = [hex1, hex2].map((hex) => luminance(hexToLinear(hex))).sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/** Converte "oklch(L C H)" (ou "oklch(L C H / alpha)" sobre um fundo) em #rrggbb aproximado. */
function parseColor(value, over) {
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)/i.exec(value);
  if (!m) {
    if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
    throw new Error(`cor não suportada: ${value}`);
  }
  const [, L, C, H, alphaRaw, pct] = m;
  let rgb = oklchToSrgb(Number(L), Number(C), Number(H));
  if (alphaRaw !== undefined && over) {
    const alpha = pct ? Number(alphaRaw) / 100 : Number(alphaRaw);
    const base = over;
    rgb = rgb.map((v, i) => v * alpha + base[i] * (1 - alpha));
  }
  const toHex = (v) => {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${rgb.map(toHex).join('')}`;
}

const THEMES = {
  claro: {
    background: 'oklch(0.982 0.005 85)',
    foreground: 'oklch(0.26 0.015 55)',
    card: 'oklch(0.998 0.002 85)',
    primary: 'oklch(0.55 0.125 50)',
    'primary-foreground': 'oklch(0.985 0.005 85)',
    muted: 'oklch(0.955 0.008 78)',
    'muted-foreground': 'oklch(0.5 0.02 60)',
    destructive: 'oklch(0.577 0.215 27)',
    accent: 'oklch(0.945 0.035 80)',
    'accent-foreground': 'oklch(0.38 0.08 50)',
  },
  escuro: {
    background: 'oklch(0.175 0.008 55)',
    foreground: 'oklch(0.93 0.008 80)',
    card: 'oklch(0.215 0.01 55)',
    primary: 'oklch(0.78 0.135 70)',
    'primary-foreground': 'oklch(0.2 0.02 55)',
    muted: 'oklch(0.26 0.012 55)',
    'muted-foreground': 'oklch(0.68 0.015 70)',
    destructive: 'oklch(0.68 0.19 25)',
    accent: 'oklch(0.3 0.04 60)',
    'accent-foreground': 'oklch(0.88 0.06 75)',
  },
};

const PAIRS = [
  ['foreground', 'background', 4.5, 'texto principal'],
  ['foreground', 'card', 4.5, 'texto em cartão'],
  ['muted-foreground', 'background', 4.5, 'texto secundário'],
  ['muted-foreground', 'card', 4.5, 'texto secundário em cartão'],
  ['muted-foreground', 'muted', 4.5, 'texto secundário sobre faixa muted'],
  ['primary', 'background', 4.5, 'link/realce sobre fundo'],
  ['primary-foreground', 'primary', 4.5, 'texto do botão primário'],
  ['accent-foreground', 'accent', 4.5, 'chip de acento'],
  ['destructive', 'background', 4.5, 'mensagem de erro'],
  ['destructive', 'card', 4.5, 'erro em cartão'],
];

function auditContrast() {
  const rows = [];
  for (const [theme, palette] of Object.entries(THEMES)) {
    const bgFor = (key) => palette[key];
    for (const [fgKey, bgKey, min, label] of PAIRS) {
      const over = bgKey === 'muted' || bgKey === 'accent' ? oklchToSrgb(0.982, 0.005, 85) : undefined;
      const fg = parseColor(palette[fgKey], over);
      const bg = parseColor(palette[bgKey], over);
      const ratio = contrast(fg, bg);
      rows.push({ theme, label, fgKey, bgKey, fg, bg, ratio, min, ok: ratio >= min });
    }
    void bgFor;
  }
  return rows;
}

/* ─────────────── estrutura do HTML servido ─────────────── */

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function auditHtml(route, html) {
  const issues = [];
  const info = {};

  if (!/<html[^>]+lang="pt-BR"/.test(html)) issues.push('html sem lang="pt-BR"');
  if (!/name="viewport"/.test(html)) issues.push('sem meta viewport (quebra no mobile)');

  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => stripTags(m[1]));
  info.h1 = h1;
  if (h1.length === 0) issues.push('nenhum <h1>');
  if (h1.length > 1) issues.push(`${h1.length} elementos <h1> (deveria ser 1)`);

  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/g)].map((m) => Number(m[1]));
  let previous = 0;
  for (const level of headings) {
    if (previous && level > previous + 1) issues.push(`salto de título h${previous} → h${level}`);
    previous = level;
  }
  info.headings = headings;

  if (!/<main\b/.test(html)) issues.push('sem <main>');
  if (!/<header\b/.test(html)) issues.push('sem <header>');
  if (!/<footer\b/.test(html)) issues.push('sem <footer>');

  // links/botões sem nome acessível
  const emptyLinks = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter((m) => {
    const hasAria = /aria-label="[^"]+"/.test(m[1]) || /aria-labelledby/.test(m[1]);
    const text = stripTags(m[2]);
    const hasImgAlt = /alt="[^"]+"/.test(m[2]);
    return !hasAria && !text && !hasImgAlt;
  });
  if (emptyLinks.length) issues.push(`${emptyLinks.length} link(s) sem texto ou aria-label`);

  const buttonTags = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  const emptyButtons = buttonTags.filter((m) => {
    const hasAria = /aria-label="[^"]+"/.test(m[1]) || /aria-labelledby/.test(m[1]);
    return !hasAria && !stripTags(m[2]);
  });
  if (emptyButtons.length) issues.push(`${emptyButtons.length} botão(ões) sem texto ou aria-label`);
  info.buttons = buttonTags.length;

  // campos de formulário sem rótulo
  const inputs = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].filter(
    (m) => !/type="(hidden|checkbox|radio)"/.test(m[2]) || /aria-label|id=/.test(m[2])
  );
  const ids = new Set([...html.matchAll(/<label\b[^>]*for="([^"]+)"/g)].map((m) => m[1]));
  const unlabeled = inputs.filter((m) => {
    const attrs = m[2];
    if (/aria-label="[^"]+"/.test(attrs) || /aria-labelledby/.test(attrs)) return false;
    const id = /id="([^"]+)"/.exec(attrs)?.[1];
    return !id || !ids.has(id);
  });
  if (unlabeled.length) issues.push(`${unlabeled.length} campo(s) sem rótulo associado`);

  // imagens sem alt
  const imgs = [...html.matchAll(/<img\b([^>]*)>/g)];
  const noAlt = imgs.filter((m) => !/\balt=/.test(m[1]));
  if (noAlt.length) issues.push(`${noAlt.length} imagem(ns) sem alt`);

  info.title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '(sem título)';
  info.textLength = stripTags(html.split('<main')[1]?.split('</main>')[0] ?? html).length;
  return { route, issues, info };
}

async function main() {
  console.log('\n=== Contraste WCAG (pares usados na interface) ===\n');
  const rows = auditContrast();
  let failures = 0;
  for (const theme of ['claro', 'escuro']) {
    console.log(`  tema ${theme}:`);
    for (const row of rows.filter((r) => r.theme === theme)) {
      const flag = row.ok ? '✓' : '✗';
      if (!row.ok) failures++;
      console.log(
        `    ${flag} ${row.ratio.toFixed(2).padStart(5)}:1  ${row.label.padEnd(34)} ${row.fg} sobre ${row.bg}` +
          (row.ok ? '' : `  (mínimo ${row.min}:1)`)
      );
    }
    console.log('');
  }

  console.log('=== Estrutura das rotas ===\n');
  const routes = process.argv.length > 3 ? process.argv.slice(3) : ['/', '/metodo'];
  const htmlIssues = [];
  for (const route of routes) {
    const res = await fetch(`${BASE}${route}`);
    const html = await res.text();
    const { issues, info } = auditHtml(route, html);
    console.log(`  ${route} → HTTP ${res.status}`);
    console.log(`    título: ${info.title}`);
    console.log(`    h1: ${JSON.stringify(info.h1)}`);
    console.log(`    títulos: [${info.headings.join(',')}] · botões: ${info.buttons} · conteúdo: ${info.textLength} chars`);
    for (const issue of issues) {
      console.log(`    ✗ ${issue}`);
      htmlIssues.push(`${route}: ${issue}`);
    }
    if (!issues.length) console.log('    ✓ sem problemas estruturais');
    console.log('');
  }

  const problems = failures + htmlIssues.length;
  console.log(`Resultado: ${failures} problema(s) de contraste, ${htmlIssues.length} problema(s) de estrutura.`);
  process.exitCode = problems > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error('Falha na auditoria:', error);
  process.exit(2);
});
