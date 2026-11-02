'use client';

// ANIMA — renderizador de Markdown com tipografia editorial (.anima-prose em globals.css).
// GFM habilitado (tabelas, listas de tarefas); links externos abrem em nova aba com rel seguro.

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Prose({ content }: { content: string }) {
  return (
    <div className="anima-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
