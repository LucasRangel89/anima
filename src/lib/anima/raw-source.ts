// ANIMA — tipo intermediário de uma fonte coletada (compartilhado por busca e fontes do usuário).

import type { Reliability, SourceKind, SourceOrigin } from './types';

export interface RawSource {
  title: string;
  url: string;
  /** Texto já limpo, que será delimitado em <fonte> no prompt. */
  text: string;
  origin: SourceOrigin;
  kind?: SourceKind;
  lang?: string | null;
  year?: number | null;
  author?: string | null;
  publisher?: string | null;
  reliability?: Reliability;
  note?: string | null;
}
