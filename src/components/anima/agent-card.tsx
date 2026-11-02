import type { AgentMeta } from '@/lib/anima/agent-meta';
import { cn } from '@/lib/utils';

/** Cartão de vitrine de um especialista (home e página Método). */
export function AgentShowcaseCard({ agent, detailed = false }: { agent: AgentMeta; detailed?: boolean }) {
  const Icon = agent.icon;
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border', agent.color.bg, agent.color.border, agent.color.text)} aria-hidden>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold leading-tight">{agent.name}</h3>
          <p className={cn('text-xs font-medium uppercase tracking-wider', agent.color.text)}>{agent.role}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{agent.tagline}</p>
      {detailed && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm marker:text-primary">
          {agent.questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Referenciais teóricos">
        {agent.frameworks.slice(0, detailed ? undefined : 4).map((f) => (
          <li key={f} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {f}
          </li>
        ))}
        {!detailed && agent.frameworks.length > 4 && (
          <li className="px-1 py-1 text-xs text-muted-foreground">+{agent.frameworks.length - 4}</li>
        )}
      </ul>
    </article>
  );
}
