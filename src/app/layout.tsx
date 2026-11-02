import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { SiteFooter, SiteHeader } from '@/components/anima/site-header';
import './globals.css';

const fraunces = Fraunces({ variable: '--font-fraunces', subsets: ['latin'], display: 'swap' });
const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'ANIMA — Analisador Narrativo Inteligente Multiagente', template: '%s · ANIMA' },
  description:
    'Um pesquisador, oito especialistas e um curador analisam estrutura, discurso, personagens, temas, estilo, psique, contexto e ideologia de qualquer obra narrativa, com fontes tipadas e recorte à sua escolha.',
  keywords: [
    'análise narrativa',
    'narratologia',
    'crítica literária',
    'análise de filmes',
    'agentes de IA',
    'ANIMA',
  ],
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'ANIMA',
    title: 'ANIMA — Analisador Narrativo Inteligente Multiagente',
    description:
      'Uma obra, oito lentes, uma leitura integrada: pesquisa factual, especialistas independentes e síntese crítica.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf7f2' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1917' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${fraunces.variable} ${inter.variable} paper-texture flex min-h-screen flex-col antialiased`}>
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Ir para o conteúdo
        </a>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <SiteHeader />
          <div id="conteudo" className="flex flex-1 flex-col">
            {children}
          </div>
          <SiteFooter />
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
