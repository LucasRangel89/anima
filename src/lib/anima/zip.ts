// ANIMA — escritor de ZIP mínimo (sem dependência).
//
// Por que existe: exportar para o Obsidian só é útil como **cofre** (uma nota por lente), e um cofre precisa
// de vários arquivos. A alternativa seria uma biblioteca de zip só para isso; o formato "store" (sem
// compressão) cabe em ~100 linhas, é determinístico e testável. Textos de análise são pequenos: não comprimir
// custa alguns KB e economiza uma dependência.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Caminho dentro do zip (use `/` como separador). */
  path: string;
  data: Uint8Array;
}

/** Data/hora fixas (1980-01-01 00:00) para o arquivo sair idêntico em execuções diferentes. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const FLAG_UTF8 = 0x0800;

class ByteWriter {
  private buffer = new Uint8Array(1024);
  private written = 0;

  get length() {
    return this.written;
  }

  private ensure(extra: number) {
    if (this.written + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.written + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.written));
    this.buffer = next;
  }

  bytes(data: Uint8Array) {
    this.ensure(data.length);
    this.buffer.set(data, this.written);
    this.written += data.length;
  }

  u16(value: number) {
    this.ensure(2);
    this.buffer[this.written++] = value & 0xff;
    this.buffer[this.written++] = (value >>> 8) & 0xff;
  }

  u32(value: number) {
    this.ensure(4);
    this.buffer[this.written++] = value & 0xff;
    this.buffer[this.written++] = (value >>> 8) & 0xff;
    this.buffer[this.written++] = (value >>> 16) & 0xff;
    this.buffer[this.written++] = (value >>> 24) & 0xff;
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    return this.buffer.slice(0, this.written);
  }
}

const encoder = new TextEncoder();

/**
 * Monta um zip com método "store". Sem diretórios explícitos: os caminhos com `/` já criam a estrutura
 * ao extrair. Limite de 65535 entradas e 4 GB — muito acima do que o ANIMA produz, e falha alto se passar.
 */
export function createZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error('ZIP com entradas demais.');

  const out = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    if (name.length > 0xffff) throw new Error(`Caminho longo demais no zip: ${entry.path}`);
    if (entry.data.length > 0xffffffff) throw new Error(`Arquivo grande demais no zip: ${entry.path}`);
    if (entry.path.includes('\\')) throw new Error(`Use "/" como separador no zip: ${entry.path}`);

    const start = out.length;

    const crc = crc32(entry.data);
    out.u32(0x04034b50); // assinatura do cabeçalho local
    out.u16(20); // versão necessária
    out.u16(FLAG_UTF8);
    out.u16(0); // método: store
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(crc);
    out.u32(entry.data.length);
    out.u32(entry.data.length);
    out.u16(name.length);
    out.u16(0); // sem campo extra
    out.bytes(name);
    out.bytes(entry.data);

    central.push({ name, crc, size: entry.data.length, offset: start });
  }

  const centralStart = out.length;
  for (const item of central) {
    out.u32(0x02014b50); // assinatura do diretório central
    out.u16(20); // versão que criou
    out.u16(20); // versão necessária
    out.u16(FLAG_UTF8);
    out.u16(0); // store
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(item.crc);
    out.u32(item.size);
    out.u32(item.size);
    out.u16(item.name.length);
    out.u16(0); // extra
    out.u16(0); // comentário
    out.u16(0); // disco
    out.u16(0); // atributos internos
    out.u32(0); // atributos externos
    out.u32(item.offset);
    out.bytes(item.name);
  }
  const centralSize = out.length - centralStart;

  out.u32(0x06054b50); // fim do diretório central
  out.u16(0); // disco
  out.u16(0); // disco do diretório central
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // sem comentário

  return out.toUint8Array();
}
