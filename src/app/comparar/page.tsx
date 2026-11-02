import type { Metadata } from 'next';
import { ComparisonView } from '@/components/anima/comparison-view';

export const metadata: Metadata = {
  title: 'Comparar duas obras · ANIMA',
  description: 'Leitura cruzada de dois relatórios do ANIMA: o que aproxima, o que separa e o que uma obra ilumina na outra.',
};

export default function CompararPage() {
  return <ComparisonView />;
}
