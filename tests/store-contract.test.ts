// ANIMA — teste de contrato da persistência.
//
// A MESMA suíte roda contra todas as implementações de `AnalysisStore` disponíveis:
//   • memória  — sempre;
//   • Prisma   — quando o client estiver gerado e o banco acessível.
//
// Assim, na máquina do usuário (onde `prisma generate` e `db:push` funcionam), o `npm test`
// valida de verdade o `store-prisma.ts`. Num ambiente sem os engines do Prisma, a suíte do banco
// é PULADA com motivo explícito — nunca passa em silêncio usando a memória no lugar.

import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';

process.env.ANIMA_STORE = 'memory';
process.env.LLM_PROVIDER = 'mock';

import { createMemoryStore } from '../src/lib/anima/store-memory';
import type { AnalysisStore } from '../src/lib/anima/store';
import type { AgentKey } from '../src/lib/anima/types';

const AGENTS: AgentKey[] = ['structural', 'thematic', 'critical'];

interface Candidate {
  name: string;
  store: AnalysisStore;
  cleanup: (id: string) => Promise<void>;
  skip?: string;
}

async function discoverCandidates(): Promise<Candidate[]> {
  const list: Candidate[] = [
    { name: 'memória', store: createMemoryStore(), cleanup: async () => undefined },
  ];

  try {
    // Só tentamos o Prisma se houver URL de banco real; sem ela, o client gerado aponta para um
    // stub e a suíte cairia num erro confuso em vez de um skip claro.
    const url = process.env.DATABASE_URL ?? '';
    if (!/^(file:|postgres|mysql|sqlserver|mongodb)/.test(url)) {
      throw new Error(`DATABASE_URL ausente ou inválida (${url ? url.slice(0, 20) : 'vazia'})`);
    }
    const [{ db }, { prismaStore }] = await Promise.all([
      import('../src/lib/db'),
      import('../src/lib/anima/store-prisma'),
    ]);
    await db.$queryRawUnsafe('SELECT 1');
    list.push({
      name: 'prisma',
      store: prismaStore,
      cleanup: async (id) => {
        await db.agentResult.deleteMany({ where: { analysisId: id } });
        await db.analysis.deleteMany({ where: { id } });
      },
    });
  } catch (error) {
    const reason =
      (error instanceof Error ? error.message : String(error))
        .split('\n')
        .map((line) => line.replace(/^#\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(' ') || 'erro desconhecido';
    list.push({
      name: 'prisma',
      store: createMemoryStore(),
      cleanup: async () => undefined,
      skip: `Prisma indisponível neste ambiente: ${reason}`,
    });
  }

  return list;
}

type Case = {
  name: string;
  run: (store: AnalysisStore, cleanup: (id: string) => Promise<void>) => Promise<void>;
};

const input = (title: string, extra: Partial<Parameters<AnalysisStore['create']>[0]> = {}) => ({
  title,
  hint: null,
  focus: null,
  kind: 'book' as const,
  depth: 'standard' as const,
  agentKeys: AGENTS,
  userSources: null,
  model: 'mock',
  ...extra,
});

const CASES: Case[] = [
  {
    name: 'create + get trazem as lentes na ordem canônica',
    run: async (store, cleanup) => {
      const row = await store.create(input('Contrato — create'));
      try {
        assert.equal(row.status, 'researching');
        assert.equal(row.researchStatus, 'running');
        assert.deepEqual(
          row.results.map((r) => r.agentKey),
          AGENTS
        );
        const fetched = await store.get(row.id);
        assert.ok(fetched);
        assert.equal(fetched.title, 'Contrato — create');
        assert.equal(fetched.results.length, AGENTS.length);
        assert.equal(fetched.createdAt instanceof Date, true);
      } finally {
        await cleanup(row.id);
      }
    },
  },
  {
    name: 'update faz patch parcial sem apagar os outros campos',
    run: async (store, cleanup) => {
      const row = await store.create(input('Contrato — update'));
      try {
        await store.update(row.id, { status: 'analyzing', research: '## dossiê', researchStatus: 'done' });
        await store.update(row.id, { synthesisStatus: 'running' });
        const after = (await store.get(row.id))!;
        assert.equal(after.status, 'analyzing');
        assert.equal(after.research, '## dossiê');
        assert.equal(after.researchStatus, 'done');
        assert.equal(after.synthesisStatus, 'running');
        assert.equal(after.hint, null);
      } finally {
        await cleanup(row.id);
      }
    },
  },
  {
    name: 'updateAgent cria a linha ausente e atualiza a existente sem duplicar',
    run: async (store, cleanup) => {
      const row = await store.create(input('Contrato — agente', { agentKeys: ['structural'] }));
      try {
        await store.updateAgent(row.id, 'structural', { status: 'running' });
        await store.updateAgent(row.id, 'structural', { status: 'done', content: 'texto', durationMs: 42 });
        await store.updateAgent(row.id, 'cultural', { status: 'done', content: 'extra' }); // lente nova

        const after = (await store.get(row.id))!;
        const structural = after.results.find((r) => r.agentKey === 'structural')!;
        assert.equal(structural.status, 'done');
        assert.equal(structural.content, 'texto');
        assert.equal(structural.durationMs, 42);
        assert.equal(after.results.find((r) => r.agentKey === 'cultural')!.content, 'extra');
        assert.equal(after.results.filter((r) => r.agentKey === 'structural').length, 1);
      } finally {
        await cleanup(row.id);
      }
    },
  },
  {
    name: 'list filtra por status e por meio, com contagem de lentes',
    run: async (store, cleanup) => {
      const done = await store.create(input('Contrato — list realizada', { kind: 'film' }));
      const active = await store.create(input('Contrato — list ativa'));
      try {
        await store.updateAgent(done.id, 'structural', { status: 'done' });
        await store.updateAgent(done.id, 'thematic', { status: 'done' });
        await store.update(done.id, { status: 'completed', researchStatus: 'done', synthesisStatus: 'done' });

        const completed = await store.list({ limit: 50, status: 'completed' });
        const found = completed.find((r) => r.id === done.id);
        assert.ok(found, 'a análise concluída deveria aparecer no filtro');
        assert.equal(found.doneAgents, 2);
        assert.equal(found.totalAgents, AGENTS.length);

        const onlyFilms = await store.list({ limit: 50, status: 'completed', kind: 'film' });
        assert.equal(
          onlyFilms.every((r) => r.kind === 'film'),
          true
        );

        const activeList = await store.list({ limit: 50, status: 'active' });
        assert.ok(activeList.some((r) => r.id === active.id));
        assert.equal(
          activeList.some((r) => r.id === done.id),
          false
        );
      } finally {
        await cleanup(done.id);
        await cleanup(active.id);
      }
    },
  },
  {
    name: 'listActive inclui a fila (queued)',
    run: async (store, cleanup) => {
      const row = await store.create(input('Contrato — fila'));
      try {
        await store.update(row.id, { status: 'queued', researchStatus: 'pending' });
        const active = await store.listActive();
        assert.ok(active.some((a) => a.id === row.id));
        assert.equal(
          active.every((a) => a.updatedAt instanceof Date),
          true
        );
      } finally {
        await cleanup(row.id);
      }
    },
  },
  {
    name: 'findLatestCompleted ignora acento/caixa e exige kind, depth, hint e focus',
    run: async (store, cleanup) => {
      const row = await store.create(
        input('Cem Anos de Solidão — contrato', { depth: 'deep', hint: 'García Márquez', focus: 'o fim' })
      );
      try {
        await store.update(row.id, { status: 'completed', researchStatus: 'done', synthesisStatus: 'done' });

        const hit = await store.findLatestCompleted(
          'cem anos de solidao — CONTRATO',
          'book',
          'deep',
          'García Márquez',
          'o fim'
        );
        assert.equal(hit?.id, row.id);

        const miss = async (kind: 'book' | 'film', depth: 'deep' | 'standard', hint: string | null, focus: string | null) =>
          (await store.findLatestCompleted('Cem Anos de Solidão — contrato', kind, depth, hint, focus)) === null;
        assert.equal(await miss('film', 'deep', 'García Márquez', 'o fim'), true);
        assert.equal(await miss('book', 'standard', 'García Márquez', 'o fim'), true);
        assert.equal(await miss('book', 'deep', null, 'o fim'), true);
        assert.equal(await miss('book', 'deep', 'García Márquez', null), true);
        assert.equal(await miss('book', 'deep', 'Outro Autor', 'o fim'), true);
      } finally {
        await cleanup(row.id);
      }
    },
  },
  {
    name: 'delete remove a análise e as lentes, e devolve false na segunda vez',
    run: async (store) => {
      const row = await store.create(input('Contrato — delete'));
      assert.equal(await store.delete(row.id), true);
      assert.equal(await store.get(row.id), null);
      assert.equal(await store.delete(row.id), false);
    },
  },
  {
    name: 'update em id inexistente não lança',
    run: async (store) => {
      await store.update('id-que-nao-existe', { status: 'completed' });
      await store.updateAgent('id-que-nao-existe', 'thematic', { status: 'done' });
      assert.equal(await store.get('id-que-nao-existe'), null);
    },
  },
];

test('contrato de persistência (memória + Prisma quando disponível)', async (t: TestContext) => {
  const candidates = await discoverCandidates();
  const exercised: string[] = [];

  for (const candidate of candidates) {
    if (candidate.skip) {
      await t.test(`[${candidate.name}] (pulado)`, { skip: candidate.skip }, async () => undefined);
      continue;
    }
    exercised.push(candidate.name);
    for (const testCase of CASES) {
      await t.test(`[${candidate.name}] ${testCase.name}`, async () => {
        await testCase.run(candidate.store, candidate.cleanup);
      });
    }
  }

  assert.ok(exercised.includes('memória'), 'a implementação de memória precisa ser exercitada');
  t.diagnostic(`implementações exercitadas: ${exercised.join(', ')}`);
  if (!exercised.includes('prisma')) {
    t.diagnostic('PRISMA NÃO EXERCITADO — rode `npm test` com DATABASE_URL e o client gerado para validar o banco.');
  }
});
