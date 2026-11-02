// ANIMA — fontes fornecidas pelo usuário (links e trechos colados).
//
// Duas preocupações centrais:
//  1) SSRF: o servidor busca URLs arbitrárias. Só aceitamos http(s) públicos, validando
//     também cada redirecionamento, e limitamos tamanho/tempo.
//  2) Injeção de prompt: o texto extraído é DADO. Ele é sanitizado e delimitado em <fonte>,
//     e o prompt de sistema diz explicitamente para nunca obedecer instruções vindas de fontes.

import { withTimeout } from './async-utils';
import type { RawSource } from './raw-source';

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 800_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'ANIMA/0.4 (analisador narrativo; https://github.com/LucasRangel89/anima)';

export interface UserSourceInput {
  type: 'url' | 'text';
  value: string;
}

/** Limpa o valor: remove controles, normaliza espaços e corta excesso. */
export function normalizeUserSourceValue(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PRIVATE_HOST_SUFFIXES = ['.local', '.internal', '.localdomain', '.home', '.lan'];
const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
]);

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Aceita apenas http(s) públicos: bloqueia loopback, redes privadas, mDNS e IPs literais internos. */
export function isSafePublicUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host.length > 253) return false;
  if (BLOCKED_HOSTS.has(host)) return false;
  if (PRIVATE_HOST_SUFFIXES.some((s) => host.endsWith(s))) return false;

  // IPv6 literal (contém ':') — só endereços globais são aceitos, o que na prática exclui
  // loopback (::1), link-local (fe80::/10), ULA (fc00::/7) e os mapeados ::ffff:*.
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return false;
    if (/^(fe80|fc|fd|::ffff:)/i.test(host)) return false;
    return true;
  }
  if (isPrivateIPv4(host)) return false;
  // Nome sem ponto (ex.: "intranet", "wiki") não é um domínio público.
  if (!host.includes('.') && !/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
  return true;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, code: string) => {
    if (code.startsWith('#')) {
      const num = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(num) && num > 0 && num < 0x10ffff ? String.fromCodePoint(num) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** Converte HTML em texto legível, descartando navegação, scripts, estilos e comentários. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|head|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractHtmlTitle(html: string): string | null {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{3,200})["']/i.exec(html);
  if (og) return decodeEntities(og[1]).trim();
  const title = /<title[^>]*>([\s\S]{3,300}?)<\/title>/i.exec(html);
  return title ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() : null;
}

/** Lê no máximo `MAX_BYTES` do corpo (evita páginas gigantes). */
async function readLimited(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (bytes >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.slice(0, MAX_BYTES);
}

/** Segue redirecionamentos manualmente, validando cada destino (um redirect pode apontar para a rede interna). */
async function safeFetch(startUrl: string, signal: AbortSignal): Promise<{ res: Response; url: string }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new Error('redirecionamento sem destino');
      const next = new URL(location, current).toString();
      if (!isSafePublicUrl(next)) throw new Error('redirecionamento para endereço não permitido');
      current = next;
      continue;
    }
    return { res, url: current };
  }
  throw new Error('redirecionamentos demais');
}

/**
 * Busca e prepara as fontes do usuário. Falhas individuais não derrubam a análise:
 * viram uma fonte com nota de erro, para o pesquisador saber que o material não veio.
 */
export async function fetchUserSources(inputs: UserSourceInput[]): Promise<RawSource[]> {
  const out: RawSource[] = [];
  for (const [index, input] of inputs.entries()) {
    const value = normalizeUserSourceValue(input.value);
    if (!value) continue;

    if (input.type === 'text') {
      out.push({
        title: `Trecho fornecido por você (${index + 1})`,
        url: 'about:blank',
        text: value.slice(0, 6000),
        origin: 'user',
        kind: 'user',
        reliability: 'alta',
        note: 'trecho colado pelo usuário',
      });
      continue;
    }

    try {
      const { res, url } = await withTimeout((signal) => safeFetch(value, signal), FETCH_TIMEOUT_MS, 'Fonte do usuário');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      if (contentType && !/text\/html|text\/plain|application\/(xhtml\+xml|xml)/.test(contentType)) {
        throw new Error(`tipo de conteúdo não suportado (${contentType.split(';')[0]})`);
      }
      const raw = await readLimited(res);
      const text = /html|xml/.test(contentType) ? htmlToText(raw) : raw;
      if (text.length < 200) throw new Error('a página não tem texto suficiente');

      const title = (contentType.includes('html') ? extractHtmlTitle(raw) : null) ?? new URL(url).hostname;
      out.push({
        title: title.slice(0, 160),
        url,
        text: text.slice(0, 12_000),
        origin: 'user',
        kind: 'user',
        reliability: 'alta',
        note: 'link enviado pelo usuário',
      });
    } catch (error) {
      out.push({
        title: `Link não lido: ${value.slice(0, 120)}`,
        url: value,
        text: `[O ANIMA não conseguiu ler esta página: ${error instanceof Error ? error.message : String(error)}]`,
        origin: 'user',
        kind: 'user',
        reliability: 'baixa',
        note: 'falha ao ler o link',
      });
    }
  }
  return out;
}
