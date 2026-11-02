#!/usr/bin/env node
// ANIMA — `npm run doctor`
//
// Verifica, em segundos, as quatro coisas que fazem o app parecer "quebrado":
//   1. o banco (client do Prisma gerado + arquivo SQLite gravável);
//   2. o modelo (provedor configurado, chave presente, uma chamada real de 1 token);
//   3. as fontes abertas (Wikipédia, Open Library, OpenAlex respondem?);
//   4. a porta 3000 (já há algo rodando?).
//
// Nada é alterado. Cada checagem imprime OK / AVISO / FALHA e a próxima ação para corrigir.
// `--offline` pula as checagens de rede (útil para testar a configuração sem gastar tokens).

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = process.argv.includes('--offline');

// carrega .env como o Next faz (sem depender do modo experimental do Node)
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch {
  /* sem .env: seguimos com o ambiente atual */
}

const results = [];
const add = (status, area, message, action) => results.push({ status, area, message, action });
const OK = 'OK   ';
const WARN = 'AVISO';
const FAIL = 'FALHA';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: sem resposta em ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── 1. banco ─────────────────────────── */

async function checkDatabase() {
  if ((process.env.ANIMA_STORE ?? '').toLowerCase() === 'memory') {
    add(WARN, 'banco', 'ANIMA_STORE=memory: nada é gravado em disco', 'remova ANIMA_STORE para persistir no SQLite');
    return;
  }

  const url = process.env.DATABASE_URL ?? '';
  const match = /^file:(.+)$/.exec(url);
  if (!match) {
    add(FAIL, 'banco', `DATABASE_URL ausente ou não é SQLite ("${url || 'vazia'}")`, 'copie .env.example para .env');
    return;
  }

  const file = resolve(ROOT, 'prisma', match[1]);
  const dir = dirname(file);
  if (existsSync(file)) {
    const size = statSync(file).size;
    add(OK, 'banco', `SQLite encontrado (${(size / 1024).toFixed(0)} KB) em ${file}`, null);
  } else if (existsSync(dir)) {
    add(WARN, 'banco', `arquivo ainda não existe (${file})`, 'rode `npm run db:push` para criá-lo');
  } else {
    add(FAIL, 'banco', `pasta do banco não existe (${dir})`, 'crie a pasta ou ajuste DATABASE_URL');
  }

  // client do Prisma gerado?
  const clientPath = resolve(ROOT, 'node_modules', '.prisma', 'client');
  if (!existsSync(clientPath)) {
    add(FAIL, 'prisma', 'client do Prisma não gerado (node_modules/.prisma/client ausente)', 'rode `npx prisma generate`');
    return;
  }

  try {
    const { PrismaClient } = await import('@prisma/client');
    const db = new PrismaClient({ log: [] });
    const [{ n }] = await withTimeout(db.$queryRawUnsafe('SELECT COUNT(*) AS n FROM "Analysis"'), 8000, 'SELECT');
    const analyses = Number(n);
    add(OK, 'prisma', `client operante; ${analyses} análise(s) no banco`, null);
    const engines = await db.$queryRawUnsafe('SELECT sqlite_version() AS v').catch(() => null);
    if (engines) add(OK, 'prisma', `SQLite ${engines[0]?.v ?? '?'}`, null);
    await db.$disconnect();
  } catch (error) {
    const raw = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ');
    const hint = /must start with the protocol `prisma:\/\/`|Query engine library|engine is not/i.test(raw)
      ? 'client gerado sem engine — rode `npx prisma generate` (e `npm run db:push`)'
      : /does not exist|no such table/i.test(raw)
        ? 'rode `npm run db:push` (o schema do banco está desatualizado)'
        : /Cannot find module|did not initialize|ENOENT/i.test(raw)
          ? 'rode `npx prisma generate`'
          : 'verifique DATABASE_URL e as permissões da pasta do banco';
    add(FAIL, 'prisma', `falha ao consultar: ${raw.slice(0, 160)}`, hint);
  }
}

/* ─────────────────────────── 2. modelo ─────────────────────────── */

function resolvedProvider() {
  const explicit = (process.env.LLM_PROVIDER ?? '').trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.LLM_API_KEY ? 'openai' : 'zai';
}

async function checkLLM() {
  const provider = resolvedProvider();
  const model = process.env.LLM_MODEL || '(padrão do código)';
  const baseUrl = process.env.LLM_BASE_URL || '(padrão do provedor)';

  if (provider === 'mock') {
    add(WARN, 'modelo', 'LLM_PROVIDER=mock: os textos são fictícios', 'preencha LLM_* no .env para análise real');
    return;
  }
  if (provider === 'zai') {
    add(WARN, 'modelo', 'provedor zai (só funciona dentro do ambiente Z.ai)', 'use LLM_PROVIDER=openai com um provedor compatível');
    return;
  }
  if (!process.env.LLM_API_KEY && !/localhost|127\.0\.0\.1/.test(baseUrl)) {
    add(FAIL, 'modelo', 'LLM_API_KEY vazia', 'preencha a chave do provedor ou use LLM_PROVIDER=mock');
    return;
  }
  const contextTokens = Number(process.env.LLM_CONTEXT_TOKENS) || 32_768;
  const fallback = process.env.LLM_FALLBACK_MODEL?.trim();
  add(
    OK,
    'modelo',
    `${provider} · modelo ${model} · contexto ${contextTokens.toLocaleString('pt-BR')} tokens${fallback ? ` · fallback ${fallback}` : ''}`,
    fallback ? null : 'sem LLM_FALLBACK_MODEL: um 429 persistente encerra a análise (com mensagem clara)'
  );

  if (OFFLINE) return;

  const body = {
    model: process.env.LLM_MODEL || undefined,
    messages: [{ role: 'user', content: 'Responda apenas: ok' }],
    max_tokens: 8,
    temperature: 0,
  };
  const started = Date.now();
  try {
    const res = await withTimeout(
      fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.LLM_API_KEY ?? ''}`,
        },
        body: JSON.stringify(body),
      }),
      45_000,
      'chamada ao modelo'
    );
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        detail = JSON.parse(text)?.error?.message ?? detail;
      } catch {
        /* corpo não-JSON */
      }
      const action =
        res.status === 401
          ? 'chave inválida ou sem permissão — confira LLM_API_KEY'
          : res.status === 404
            ? 'endpoint/modelo inexistente — confira LLM_BASE_URL e LLM_MODEL'
            : res.status === 429
              ? 'limite de uso — tente mais tarde ou reduza LLM_CONCURRENCY'
              : 'veja a mensagem acima';
      add(FAIL, 'modelo', `HTTP ${res.status}: ${String(detail).replace(/\s+/g, ' ').slice(0, 160)}`, action);
      return;
    }
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content ?? '';
    const usage = json?.usage ? ` · tokens ${json.usage.total_tokens ?? '?'}` : ' · sem bloco usage';
    add(OK, 'modelo', `respondeu em ${Date.now() - started}ms ("${String(content).trim().slice(0, 40)}")${usage}`, null);
  } catch (error) {
    add(
      FAIL,
      'modelo',
      (error instanceof Error ? error.message : String(error)).slice(0, 160),
      'sem rede até o provedor? teste `curl` na LLM_BASE_URL'
    );
  }
}

/* ─────────────────────────── 3. fontes abertas ─────────────────────────── */

const SOURCES = [
  ['Wikipédia (pt)', 'https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=Dom%20Casmurro&format=json&srlimit=1'],
  ['Open Library', 'https://openlibrary.org/search.json?q=Dom+Casmurro&limit=1&fields=title'],
  ['OpenAlex', 'https://api.openalex.org/works?search=Dom%20Casmurro&per-page=1&select=id,display_name'],
];

async function checkSources() {
  if (OFFLINE) return;
  for (const [label, url] of SOURCES) {
    const started = Date.now();
    try {
      const res = await withTimeout(fetch(url, { headers: { accept: 'application/json' } }), 15_000, label);
      if (res.ok) {
        add(OK, 'fontes', `${label} respondeu (${Date.now() - started}ms)`, null);
      } else {
        add(WARN, 'fontes', `${label} respondeu HTTP ${res.status}`, 'a análise segue, mas com menos contexto');
      }
    } catch (error) {
      add(
        WARN,
        'fontes',
        `${label} inacessível (${(error instanceof Error ? error.message : String(error)).slice(0, 80)})`,
        'rede/proxy bloqueando? a análise funciona sem ela, usando as fontes que responderem'
      );
    }
    await sleep(150);
  }
}

/* ─────────────────────────── 4. porta e arquivos ─────────────────────────── */

async function checkPort(port = 3000) {
  const free = await new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(700);
    socket.on('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(true));
  });
  if (free) add(OK, 'porta', `127.0.0.1:${port} livre`, null);
  else add(WARN, 'porta', `127.0.0.1:${port} já está em uso`, 'o `npm run dev` vai falhar; pare o outro processo');
}

function checkFiles() {
  if (!existsSync(resolve(ROOT, '.env'))) {
    add(WARN, 'config', '.env ausente', 'rode `cp .env.example .env`');
  } else {
    add(OK, 'config', '.env presente', null);
  }
  const missing = ['prisma/schema.prisma', 'src/app/page.tsx', 'src/lib/anima/orchestrator.ts'].filter(
    (p) => !existsSync(resolve(ROOT, p))
  );
  if (missing.length) add(FAIL, 'config', `arquivos essenciais ausentes: ${missing.join(', ')}`, 'reclone o repositório');
  else add(OK, 'config', 'estrutura do projeto íntegra', null);
}

/* ─────────────────────────── execução ─────────────────────────── */

async function main() {
  console.log(`\nANIMA doctor — ${new Date().toLocaleString('pt-BR')}${OFFLINE ? ' (offline)' : ''}\n`);
  checkFiles();
  await checkDatabase();
  await checkLLM();
  await checkSources();
  await checkPort();

  const width = Math.max(...results.map((r) => r.area.length));
  for (const { status, area, message, action } of results) {
    console.log(`  ${status.padEnd(5)} ${area.padEnd(width)}  ${message}`);
    if (action) console.log(`        ${' '.repeat(width)}  → ${action}`);
  }

  const failures = results.filter((r) => r.status === FAIL).length;
  const warnings = results.filter((r) => r.status === WARN).length;
  console.log(`\n${failures ? '✗' : '✓'} ${failures} falha(s), ${warnings} aviso(s).`);
  if (!failures) {
    console.log('  Tudo pronto: `npm run dev` e abra http://localhost:3000\n');
  }
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error('doctor falhou inesperadamente:', error);
  process.exit(2);
});
