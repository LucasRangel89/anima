import type { Metadata } from 'next';
import { AnalysisView } from '@/components/anima/analysis-view';
import { getStore } from '@/lib/anima/store-index';

type Params = { params: Promise<{ id: string }> };

/** Metadados para compartilhar o link: título da obra, lentes usadas e recorte. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  try {
    const { id } = await params;
    const row = await (await getStore()).get(id);
    if (!row) return { title: 'Análise não encontrada', robots: { index: false, follow: false } };

    const lenses = row.results.filter((r) => r.status !== 'skipped').length;
    const description = [
      `Análise de “${row.title}”`,
      row.focus ? `recorte: ${row.focus}` : null,
      `${lenses} lente(s)`,
      'dossiê factual, especialistas independentes e síntese crítica.',
    ]
      .filter(Boolean)
      .join(' · ');

    return {
      title: `${row.title} — análise`,
      description,
      openGraph: { title: `${row.title} — análise ANIMA`, description, type: 'article' },
    };
  } catch {
    return {};
  }
}

export default async function AnalysisPage({ params }: Params) {
  const { id } = await params;
  return <AnalysisView id={id} />;
}
