'use client';

// ANIMA — renderizador de Markdown com tipografia editorial (ver .anima-prose em globals.css)

import ReactMarkdown from 'react-markdown';

export function Prose({ content }: { content: string }) {
  return (
    <div className="anima-prose">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
