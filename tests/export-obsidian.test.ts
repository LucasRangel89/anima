// ANIMA — exportação para Obsidian.
//
// O que estes testes protegem: um cofre que abre sem erro, com notas ligadas de verdade, e um zip que
// qualquer descompactador aceita — inclusive o do Windows, que recusa nomes com `:`, `?` e `*`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildObsidianNotes,
  buildObsidianVault,
  obsidianNoteName,
  obsidianTag,
  obsidianVaultFilename,
} from '../src/lib/anima/export';
import { createZip, crc32 } from '../src/lib/anima/zip';
import { AGENT_KEYS, type AnalysisDTO } from '../src/lib/anima/types';

function dto(overrides: Partial<AnalysisDTO> = {}): AnalysisDTO {
  return {
    id: 'a1',
    title: 'Dom Casmurro',
    hint: 'Machado de Assis, 1899',
    focus: null,
    kind: 'book',
    depth: 'brief',
    status: 'completed',
    research: '# Dossiê\n\nCapitu e Bento, o narrador.',
    researchStatus: 'done',
    sources: [
      {
        id: 'F1',
        title: 'Dom Casmurro — Open Library',
        url: 'https://openlibrary.org/works/OL1W',
        origin: 'openlibrary',
        kind: 'bibliography',
        lang: 'pt',
        year: 1899,
        author: 'Machado de Assis',
        publisher: null,
        reliability: 'alta',
        note: null,
      },
    ],
    synthesis: '## Síntese\n\nA dúvida é o método.',
    synthesisStatus: 'done',
    error: null,
    durationMs: 1000,
    model: 'modelo-x',
    usage: null,
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:01.000Z',
    results: AGENT_KEYS.map((key) => ({
      agentKey: key,
      status: 'done' as const,
      content: `### Leitura\n\nConteúdo de ${key}.`,
      error: null,
      durationMs: 10,
    })),
    progress: 100,
    queuePosition: null,
    followUps: [],
    ...overrides,
  };
}

/* ───────────────────────── nomes e tags ───────────────────────── */

test('nome de nota remove o que quebra arquivo ou wikilink, mas preserva acentos', () => {
  assert.equal(obsidianNoteName('Cem Anos de Solidão'), 'Cem Anos de Solidão');
  assert.equal(obsidianNoteName('Dom/Casmurro: "edição" *especial*?'), 'Dom Casmurro edição especial');
  assert.equal(obsidianNoteName('  ...Obra...  '), 'Obra');
  assert.equal(obsidianNoteName('a[b]c#d^e|f'), 'a b c d e f');
  assert.equal(obsidianNoteName(''), 'Sem título');
  assert.equal(obsidianNoteName('x'.repeat(200)).length, 80);
});

test('tag é estável, sem acento e sem espaço', () => {
  assert.equal(obsidianTag('Cem Anos de Solidão'), 'cem-anos-de-solidao');
  assert.equal(obsidianTag('anima/lente/estrutura'), 'anima/lente/estrutura');
  assert.equal(obsidianTag('!!!'), 'obra');
});

test('o arquivo .zip tem prefixo, slug e extensão', () => {
  assert.equal(obsidianVaultFilename(dto()), 'anima-dom-casmurro-obsidian.zip');
  assert.equal(obsidianVaultFilename(dto({ title: 'Cem Anos de Solidão' })), 'anima-cem-anos-de-solidao-obsidian.zip');
  assert.equal(obsidianVaultFilename(dto({ title: '???' })), 'anima-obra-obsidian.zip');
});

/* ───────────────────────── estrutura do cofre ───────────────────────── */

test('o cofre tem índice, dossiê e uma nota por lente concluída', () => {
  const notes = buildObsidianNotes(dto());
  const paths = notes.map((n) => n.path);

  assert.equal(paths[0], 'Dom Casmurro.md', 'o índice leva o nome da obra');
  assert.ok(paths.includes('Dom Casmurro - Dossiê.md'));
  for (const key of AGENT_KEYS) {
    void key;
  }
  assert.equal(paths.length, 2 + 8, 'índice + dossiê + 8 lentes');
  assert.equal(new Set(paths).size, paths.length, 'sem nomes repetidos');
});

test('lentes não concluídas não viram nota nem link', () => {
  const partial = dto({
    results: AGENT_KEYS.map((key, index) => ({
      agentKey: key,
      status: index === 0 ? ('done' as const) : index === 1 ? ('failed' as const) : ('skipped' as const),
      content: index === 0 ? 'Texto.' : null,
      error: index === 1 ? 'falhou' : null,
      durationMs: 1,
    })),
  });
  const notes = buildObsidianNotes(partial);
  assert.equal(notes.length, 3, 'índice + dossiê + 1 lente');
  const index = notes[0].content;
  assert.equal((index.match(/^- \[\[/gm) ?? []).length, 2, 'dois links: dossiê e a única lente');
  assert.ok(!index.includes('Agente Narratológico') && !index.includes(' - Narrador'));
});

test('o índice liga todas as notas por wikilink, com alias legível', () => {
  const notes = buildObsidianNotes(dto());
  const index = notes.find((n) => n.path === 'Dom Casmurro.md')!;
  for (const note of notes.slice(1)) {
    const name = note.path.replace(/\.md$/, '');
    assert.ok(index.content.includes(`[[${name}`), `o índice deve ligar ${name}`);
  }
  assert.ok(index.content.includes('## Síntese') || index.content.includes('A dúvida é o método.'));
  assert.ok(index.content.includes('https://openlibrary.org/works/OL1W'), 'as fontes ficam no índice');
});

test('cada nota tem frontmatter com tags, obra e tipo', () => {
  const notes = buildObsidianNotes(dto());
  for (const note of notes) {
    assert.ok(note.content.startsWith('---\n'), `${note.path} precisa começar com frontmatter`);
    const end = note.content.indexOf('\n---\n', 3);
    assert.ok(end > 0, `${note.path} precisa fechar o frontmatter`);
    const yaml = note.content.slice(4, end);
    assert.match(yaml, /^tags: \[/m);
    assert.match(yaml, /^obra: "Dom Casmurro"$/m);
    assert.match(yaml, /^fonte: "ANIMA"$/m);
    assert.match(yaml, /^tipo: "/m);
  }
  const lens = notes.find((n) => n.path === 'Dom Casmurro - Estrutura.md')!;
  assert.match(lens.content, /^lente: "Agente Estrutural"$/m);
  assert.match(lens.content, /^papel: "/m);
  assert.ok(lens.content.includes('anima/lente/structural'));
});

test('títulos com aspas e dois-pontos não quebram o YAML', () => {
  const notes = buildObsidianNotes(dto({ title: 'Obra: "a grande" \\ teste' }));
  for (const note of notes) {
    const end = note.content.indexOf('\n---\n', 3);
    const yaml = note.content.slice(4, end);
    for (const line of yaml.split('\n')) {
      if (!line.includes(': ')) continue;
      const value = line.slice(line.indexOf(': ') + 2);
      if (value.startsWith('"')) assert.ok(value.endsWith('"'), `YAML mal fechado: ${line}`);
    }
  }
});

test('o modelo "mock" não é gravado como se fosse real; recorte e data entram quando existem', () => {
  const mock = buildObsidianNotes(dto({ model: 'mock' }))[0].content;
  assert.ok(!/^modelo:/m.test(mock), 'demonstração não deve constar como modelo');

  const focused = buildObsidianNotes(dto({ focus: 'a questão da traição', model: 'modelo-x' }))[0].content;
  assert.match(focused, /^recorte: "a questão da traição"$/m);
  assert.match(focused, /^data: "2026-11-02"$/m);
  assert.match(focused, /^modelo: "modelo-x"$/m);
});

/* ───────────────────────── zip ───────────────────────── */

test('crc32 confere com o valor de referência', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip tem assinaturas, contagem de entradas e conteúdo recuperável', () => {
  const entries = [
    { path: 'a.md', data: new TextEncoder().encode('# A\n') },
    { path: 'sub/b.md', data: new TextEncoder().encode('# B — ção\n') },
  ];
  const zip = createZip(entries);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // EOCD no fim: 22 bytes, assinatura 0x06054b50.
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50);
  assert.equal(view.getUint16(eocd + 10, true), 2, 'duas entradas');

  // Percorre o diretório central e recupera cada arquivo pelo offset do cabeçalho local.
  let cursor = view.getUint32(eocd + 16, true);
  for (const entry of entries) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    const flags = view.getUint16(cursor + 8, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));

    assert.equal(name, entry.path);
    assert.equal(flags & 0x0800, 0x0800, 'nomes em UTF-8');
    assert.equal(size, entry.data.length);

    assert.equal(view.getUint32(localOffset, true), 0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtra;
    assert.deepEqual([...zip.subarray(start, start + size)], [...entry.data]);

    cursor += 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
});

test('o zip da análise contém exatamente as notas, com o conteúdo intacto', () => {
  const vault = buildObsidianVault(dto());
  assert.equal(vault.bytes[0], 0x50);
  assert.equal(vault.bytes[1], 0x4b, 'assinatura ZIP');

  const view = new DataView(vault.bytes.buffer, vault.bytes.byteOffset, vault.bytes.byteLength);
  const eocd = vault.bytes.length - 22;
  assert.equal(view.getUint16(eocd + 10, true), vault.notes.length);

  let cursor = view.getUint32(eocd + 16, true);
  const seen = new Map<string, string>();
  for (let i = 0; i < vault.notes.length; i++) {
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(vault.bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const start = localOffset + 30 + localNameLength;
    seen.set(name, new TextDecoder().decode(vault.bytes.subarray(start, start + size)));
    cursor += 46 + nameLength;
  }

  for (const note of vault.notes) {
    assert.equal(seen.get(note.path), note.content, `${note.path} deve sair intacto`);
  }
});
