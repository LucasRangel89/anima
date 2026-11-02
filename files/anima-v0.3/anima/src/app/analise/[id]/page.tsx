import { AnalysisView } from '@/components/anima/analysis-view';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisView id={id} />;
}
