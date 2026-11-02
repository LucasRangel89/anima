// ANIMA — gera o site estático publicado no GitHub Pages.
//
// Por que existe: o ANIMA é um app com servidor (pipeline em background), então não roda em Pages.
// O que PODE ser publicado ali é a apresentação: o que o app faz, as oito lentes, o método, os limites
// e como rodar de verdade. Esta página é gerada a partir dos MESMOS dados do produto (AGENTS,
// DEPTH_LABELS, SOURCE_ORIGIN_LABELS), para não envelhecer em paralelo ao código.
//
// Uso: npm run site:build  → escreve em site/

import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENTS, CURATOR_META, RESEARCHER_META } from '../src/lib/anima/agent-meta';
import { DEPTH_LABELS, DEPTHS, SOURCE_ORIGIN_LABELS } from '../src/lib/anima/types';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site');

const SITE_URL = 'https://lucasrangel89.github.io/anima/';
const REPO_URL = 'https://github.com/LucasRangel89/anima';

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SECTIONS = [
  ['lentes', 'As oito lentes'],
  ['metodo', 'Como funciona'],
  ['profundidade', 'Profundidade'],
  ['fontes', 'Fontes'],
  ['limites', 'Limites'],
  ['rodar', 'Rodar o app'],
] as const;

const PIPELINE = [
  ['1 · Pesquisador', 'Cruza Wikipédia, Open Library, OpenAlex, TMDB (opcional) e o que você enviar. Separa o que é ficha, o que é crítica e o que é lacuna — sem preencher lacuna com invenção.'],
  ['2 · Dossiê', 'As fontes viram um dossiê factual, com tipo e confiabilidade explícitos. O que falta é declarado como lacuna.'],
  ['3 · Especialistas', 'As lentes escolhidas analisam em paralelo, com concorrência limitada. Uma lente que falha não derruba o relatório.'],
  ['4 · Curador', 'Confronta as análises: convergências, tensões, juízo crítico e controle de consistência.'],
] as const;

const LIMITS = [
  ['Conteúdo gerado por IA.', 'Os modelos não leram nem assistiram à obra nesta tarefa: trabalham com o dossiê e com conhecimento prévio. Toda afirmação que não vem do dossiê é marcada com †.'],
  ['Referências podem estar imprecisas.', 'Edição, ano e página merecem conferência antes de qualquer uso acadêmico.'],
  ['Interpretação, não veredito.', 'As lentes disputam entre si de propósito; o Curador avalia quem argumenta melhor, não quem está "certo".'],
  ['Obras obscuras rendem dossiês mais pobres.', 'Nesses casos o relatório declara a confiança e as lacunas, em vez de disfarçá-las.'],
  ['Seus links são lidos pelo servidor.', 'Envie apenas páginas públicas que você tem o direito de consultar.'],
  ['O custo é seu.', 'Cada lente é uma chamada ao provedor. O relatório mostra quantas chamadas e quantos tokens foram gastos.'],
] as const;

const RUN_OPTIONS = [
  {
    title: 'No mesmo Wi-Fi',
    steps: ['npm install', 'cp .env.example .env', 'npm run db:push', 'npm run dev -- -H 0.0.0.0'],
    note: 'Abra http://SEU-IP:3000 no celular. Só funciona dentro de casa.',
  },
  {
    title: 'Túnel (qualquer lugar, com o PC ligado)',
    steps: ['npm run build && npm start', 'cloudflared tunnel --url http://localhost:3000'],
    note: 'O endereço muda a cada execução. Defina ANIMA_ACCESS_TOKEN antes.',
  },
  {
    title: 'Servidor na nuvem (PC desligado)',
    steps: ['Dockerfile incluído no repositório', 'Configure LLM_* e ANIMA_ACCESS_TOKEN', 'Monte um volume para o histórico'],
    note: 'Funciona em Render, Railway e Fly.io. Guia completo em docs/PUBLICAR.md.',
  },
] as const;

function renderLensCard(agent: (typeof AGENTS)[number], index: number): string {
  return `
      <article class="lens">
        <div class="lens-head">
          <span class="lens-index">${String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>${esc(agent.name)}</h3>
            <p class="lens-role">${esc(agent.role)}</p>
          </div>
        </div>
        <p class="lens-tagline">${esc(agent.tagline)}</p>
        <ul class="lens-questions">
          ${agent.questions.slice(0, 3).map((q) => `<li>${esc(q)}</li>`).join('\n          ')}
        </ul>
        <p class="lens-frameworks"><span>Referenciais:</span> ${agent.frameworks.slice(0, 5).map(esc).join(' · ')}</p>
      </article>`;
}

export function renderSite(): string {
  const lenses = AGENTS.map(renderLensCard).join('\n');

  const depths = DEPTHS.map((depth) => {
    const info = DEPTH_LABELS[depth];
    return `
          <tr>
            <th scope="row">${esc(info.label)}</th>
            <td>${esc(info.description)}</td>
            <td class="num">${info.words[0]}–${info.words[1]}</td>
            <td class="num">${info.minutes[0]}–${info.minutes[1]} min</td>
            <td class="num">${info.cost}</td>
          </tr>`;
  }).join('');

  const sources = Object.entries(SOURCE_ORIGIN_LABELS)
    .map(([, label]) => `<li>${esc(label)}</li>`)
    .join('\n            ');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ANIMA — uma obra, oito lentes, uma leitura integrada</title>
  <meta name="description" content="Análise narrativa multiagente de obras literárias e audiovisuais: dossiê factual, oito especialistas independentes e uma síntese que confronta as leituras.">
  <meta property="og:title" content="ANIMA — análise narrativa multiagente">
  <meta property="og:description" content="Uma obra, oito lentes, uma leitura integrada. Dossiê ancorado em fontes, especialistas independentes e síntese crítica.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${SITE_URL}">
  <link rel="icon" href="logo.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="estilo.css">
</head>
<body>
  <a class="skip" href="#conteudo">Pular para o conteúdo</a>

  <header class="topbar">
    <div class="wrap">
      <a class="brand" href="./">
        <img src="logo.svg" alt="" width="28" height="28">
        <span>ANIMA</span>
      </a>
      <nav aria-label="Seções">
        ${SECTIONS.map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`).join('\n        ')}
      </nav>
      <button id="tema" class="theme" type="button" aria-label="Alternar tema claro e escuro">◐</button>
    </div>
  </header>

  <main id="conteudo">
    <section class="hero wrap">
      <p class="eyebrow">Análise narrativa multiagente</p>
      <h1>Uma obra, oito lentes,<br><em>uma leitura integrada</em></h1>
      <p class="lede">
        Estrutura, discurso, personagens, temas, estilo, psique, contexto e crítica ideológica.
        Cada análise é ancorada em teoria nomeada, em fontes verificáveis e nos próprios limites.
      </p>
      <p class="cta">
        <a class="button" href="#rodar">Como rodar o app</a>
        <a class="button ghost" href="${REPO_URL}" rel="noopener">Código no GitHub</a>
      </p>

      <aside class="notice">
        <strong>Esta página é a apresentação, não o aplicativo.</strong>
        O ANIMA que analisa obras roda num processo Node — ele fala com o modelo, mantém a fila e continua
        trabalhando depois que você fecha a página. GitHub Pages serve arquivos estáticos, então não executa
        esse servidor. Para analisar uma obra, siga <a href="#rodar">como rodar</a> ou o
        <a href="${REPO_URL}/blob/main/docs/PUBLICAR.md" rel="noopener">guia de publicação</a>.
      </aside>
    </section>

    <section id="lentes" class="wrap">
      <h2>As oito lentes</h2>
      <p class="section-lede">
        Cada lente é um prompt de sistema próprio, com roteiro, referenciais teóricos e a obrigação de dizer
        o que não alcança. Você pode rodar as oito ou só as que interessam.
      </p>
      <div class="lenses">${lenses}
      </div>
    </section>

    <section id="metodo" class="wrap">
      <h2>Como funciona</h2>
      <div class="pipeline">
        ${PIPELINE.map(
          ([title, text]) => `
        <article>
          <h3>${esc(title)}</h3>
          <p>${esc(text)}</p>
        </article>`
        ).join('')}
      </div>
      <p class="fine">
        ${esc(RESEARCHER_META.name)} compila o dossiê; ${esc(CURATOR_META.name)} escreve a síntese.
        O que fundamenta cada etapa está em <a href="${REPO_URL}/blob/main/docs/METODO.md" rel="noopener">docs/METODO.md</a>.
      </p>
    </section>

    <section id="profundidade" class="wrap">
      <h2>Profundidade</h2>
      <p class="section-lede">Quatro calibragens. O custo é o número relativo de chamadas ao modelo.</p>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">Profundidades, extensão por lente e custo relativo</caption>
          <thead>
            <tr><th scope="col">Nível</th><th scope="col">O que entrega</th><th scope="col" class="num">Palavras</th><th scope="col" class="num">Tempo</th><th scope="col" class="num">Custo</th></tr>
          </thead>
          <tbody>${depths}
          </tbody>
        </table>
      </div>
      <p class="fine">Cada análise faz <strong>lentes + 2</strong> chamadas: dossiê, uma por lente e síntese.</p>
    </section>

    <section id="fontes" class="wrap">
      <h2>Fontes</h2>
      <p class="section-lede">
        A hierarquia importa: ficha catalográfica vale mais que enciclopédia, que vale mais que crítica
        acadêmica, que vale mais que imprensa. Sem chave nenhuma, o ANIMA usa as fontes abertas.
      </p>
      <ul class="sources">
            ${sources}
      </ul>
      <p class="fine">
        Cada fonte entra no dossiê com <code>origem</code>, <code>confiabilidade</code> e <code>tipo</code>.
        Trechos são sanitizados antes de chegar ao modelo.
      </p>
    </section>

    <section id="limites" class="wrap">
      <h2>Limites e ética</h2>
      <ul class="limits">
        ${LIMITS.map(([title, text]) => `<li><strong>${esc(title)}</strong> ${esc(text)}</li>`).join('\n        ')}
      </ul>
    </section>

    <section id="rodar" class="wrap">
      <h2>Rodar o app</h2>
      <p class="section-lede">
        O ANIMA é gratuito e feito para uso pessoal. Escolha o caminho pela sua paciência:
      </p>
      <div class="run">
        ${RUN_OPTIONS.map(
          (option) => `
        <article class="run-card">
          <h3>${esc(option.title)}</h3>
          <ol>
            ${option.steps.map((step) => `<li><code>${esc(step)}</code></li>`).join('\n            ')}
          </ol>
          <p class="fine">${esc(option.note)}</p>
        </article>`
        ).join('')}
      </div>
      <p class="fine">
        Guia detalhado, com token de acesso e variáveis:
        <a href="${REPO_URL}/blob/main/docs/PUBLICAR.md" rel="noopener">docs/PUBLICAR.md</a> ·
        <a href="${REPO_URL}/blob/main/README.md" rel="noopener">README</a>.
      </p>
    </section>
  </main>

  <footer class="wrap">
    <p>
      ANIMA · projeto pessoal, código aberto.
      <a href="${REPO_URL}" rel="noopener">Repositório</a> ·
      <a href="${REPO_URL}/blob/main/CHANGELOG.md" rel="noopener">Alterações</a> ·
      <a href="${REPO_URL}/blob/main/docs/METODO.md" rel="noopener">Método</a>
    </p>
    <p class="fine">Conteúdo desta página gerado a partir do próprio código do projeto.</p>
  </footer>

  <script>
    // Tema: prefere o do sistema, permite alternar e lembra a escolha.
    (function () {
      var root = document.documentElement;
      var saved = null;
      try { saved = localStorage.getItem('anima-tema'); } catch (e) {}
      if (saved) root.dataset.tema = saved;
      var botao = document.getElementById('tema');
      if (botao) botao.addEventListener('click', function () {
        var atual = root.dataset.tema === 'escuro' ? 'claro' : root.dataset.tema === 'claro' ? 'escuro' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'claro' : 'escuro');
        root.dataset.tema = atual;
        try { localStorage.setItem('anima-tema', atual); } catch (e) {}
      });
    })();
  </script>
</body>
</html>
`;
}

const CSS = `/* ANIMA — página de apresentação. Paleta a mesma do app (papel quente + âmbar). */
:root {
  --papel: #fbf9f5;
  --papel-2: #f3f0ea;
  --tinta: #2a221d;
  --tinta-fraca: #6c6158;
  --linha: #e6ded3;
  --ambar: #aa5823;
  --ambar-claro: #f9ebd3;
  --raio: 14px;
  --serif: "Fraunces", ui-serif, Georgia, serif;
  --sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --largura: 68rem;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-tema="claro"]) {
    --papel: #13100d;
    --papel-2: #1d1815;
    --tinta: #ebe7e2;
    --tinta-fraca: #9e978f;
    --linha: #302a25;
    --ambar: #eea74c;
    --ambar-claro: #3d2919;
  }
}
:root[data-tema="escuro"] {
  --papel: #13100d;
  --papel-2: #1d1815;
  --tinta: #ebe7e2;
  --tinta-fraca: #9e978f;
  --linha: #302a25;
  --ambar: #eea74c;
  --ambar-claro: #3d2919;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 4.5rem; }
body {
  margin: 0;
  background: var(--papel);
  color: var(--tinta);
  font: 1rem/1.65 var(--sans);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--ambar); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { text-decoration-thickness: 2px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em;
  background: var(--papel-2); border: 1px solid var(--linha); border-radius: 6px; padding: .1rem .35rem; }
.wrap { width: 100%; max-width: var(--largura); margin-inline: auto; padding-inline: 1.25rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.skip { position: absolute; left: -999px; }
.skip:focus { left: 1rem; top: 1rem; background: var(--papel); padding: .5rem .75rem; border-radius: 8px; z-index: 10; }

.topbar { position: sticky; top: 0; z-index: 5; backdrop-filter: blur(8px);
  background: color-mix(in oklab, var(--papel) 85%, transparent); border-bottom: 1px solid var(--linha); }
.topbar .wrap { display: flex; align-items: center; gap: 1.25rem; min-height: 3.75rem; }
.brand { display: inline-flex; align-items: center; gap: .5rem; font-family: var(--serif);
  font-weight: 600; font-size: 1.0625rem; color: var(--tinta); text-decoration: none; }
.topbar nav { display: none; gap: 1.1rem; margin-left: auto; font-size: .9rem; }
.topbar nav a { color: var(--tinta-fraca); text-decoration: none; }
.topbar nav a:hover { color: var(--ambar); }
.theme { margin-left: auto; background: transparent; border: 1px solid var(--linha); color: var(--tinta);
  border-radius: 999px; width: 2.25rem; height: 2.25rem; cursor: pointer; font-size: 1rem; }
@media (min-width: 56rem) {
  .topbar nav { display: flex; margin-left: auto; }
  .theme { margin-left: 0; }
}

.hero { padding-block: 4rem 3rem; }
.eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: .75rem;
  color: var(--ambar); font-weight: 600; margin: 0 0 1rem; }
h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(2.1rem, 6vw, 3.6rem);
  line-height: 1.08; letter-spacing: -.02em; margin: 0 0 1.25rem; }
h1 em { font-style: italic; color: var(--ambar); }
.lede { font-size: clamp(1.05rem, 2.2vw, 1.25rem); color: var(--tinta-fraca); max-width: 46rem; margin: 0 0 2rem; }
.cta { display: flex; flex-wrap: wrap; gap: .75rem; margin: 0 0 2.5rem; }
.button { display: inline-block; padding: .7rem 1.2rem; border-radius: 999px; background: var(--ambar);
  color: var(--papel); font-weight: 600; text-decoration: none; border: 1px solid transparent; }
.button.ghost { background: transparent; color: var(--tinta); border-color: var(--linha); }
.notice { max-width: 46rem; border: 1px solid var(--linha); border-left: 3px solid var(--ambar);
  background: var(--papel-2); border-radius: var(--raio); padding: 1rem 1.15rem; font-size: .925rem; color: var(--tinta-fraca); }
.notice strong { color: var(--tinta); }

section { padding-block: 3rem; border-top: 1px solid var(--linha); }
h2 { font-family: var(--serif); font-weight: 600; font-size: clamp(1.6rem, 4vw, 2.15rem);
  letter-spacing: -.01em; margin: 0 0 .75rem; }
.section-lede { color: var(--tinta-fraca); max-width: 42rem; margin: 0 0 2rem; }
h3 { font-family: var(--serif); font-size: 1.15rem; font-weight: 600; margin: 0; }
p { margin: 0 0 .9rem; }
.fine { font-size: .875rem; color: var(--tinta-fraca); }

.lenses { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 44rem) { .lenses { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lenses { grid-template-columns: repeat(4, 1fr); } }
.lens { border: 1px solid var(--linha); border-radius: var(--raio); padding: 1.1rem;
  background: var(--papel); display: flex; flex-direction: column; gap: .6rem; }
.lens-head { display: flex; align-items: flex-start; gap: .6rem; }
.lens-index { font-family: var(--serif); font-size: .8rem; color: var(--ambar);
  background: var(--ambar-claro); border-radius: 999px; padding: .15rem .45rem; }
.lens-role { margin: .15rem 0 0; font-size: .8rem; color: var(--tinta-fraca); }
.lens-tagline { font-size: .9rem; margin: 0; }
.lens-questions { margin: 0; padding-left: 1rem; font-size: .85rem; color: var(--tinta-fraca); }
.lens-questions li { margin-bottom: .25rem; }
.lens-frameworks { margin: auto 0 0; font-size: .78rem; color: var(--tinta-fraca);
  border-top: 1px dashed var(--linha); padding-top: .5rem; }
.lens-frameworks span { color: var(--tinta); font-weight: 500; }

.pipeline { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 44rem) { .pipeline { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .pipeline { grid-template-columns: repeat(4, 1fr); } }
.pipeline article { border-top: 2px solid var(--ambar); padding-top: .75rem; }
.pipeline p { font-size: .9rem; color: var(--tinta-fraca); margin: .5rem 0 0; }

.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; min-width: 34rem; }
caption { text-align: left; }
th, td { text-align: left; padding: .65rem .6rem; border-bottom: 1px solid var(--linha); vertical-align: top; }
thead th { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; color: var(--tinta-fraca); }
tbody th { font-family: var(--serif); font-weight: 600; }
.num { text-align: right; white-space: nowrap; }

.sources { display: flex; flex-wrap: wrap; gap: .5rem; list-style: none; padding: 0; margin: 0 0 1.25rem; }
.sources li { border: 1px solid var(--linha); background: var(--papel-2); border-radius: 999px;
  padding: .3rem .75rem; font-size: .85rem; }

.limits { margin: 0; padding-left: 1.1rem; max-width: 52rem; }
.limits li { margin-bottom: .7rem; color: var(--tinta-fraca); }
.limits strong { color: var(--tinta); }

.run { display: grid; gap: 1rem; grid-template-columns: 1fr; margin-bottom: 1.5rem; }
@media (min-width: 52rem) { .run { grid-template-columns: repeat(3, 1fr); } }
.run-card { border: 1px solid var(--linha); border-radius: var(--raio); padding: 1.1rem; background: var(--papel-2); }
.run-card ol { margin: .75rem 0; padding-left: 1.1rem; font-size: .85rem; }
.run-card li { margin-bottom: .45rem; }
.run-card code { display: inline-block; word-break: break-word; }

footer { border-top: 1px solid var(--linha); padding-block: 2rem 3rem; color: var(--tinta-fraca); font-size: .9rem; }

@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
@media print { .topbar, .theme, .cta { display: none; } body { background: #fff; color: #000; } }
`;

export async function buildSite(): Promise<{ files: string[]; html: string }> {
  await mkdir(OUT, { recursive: true });
  const html = renderSite();
  await writeFile(join(OUT, 'index.html'), html, 'utf8');
  await writeFile(join(OUT, 'estilo.css'), CSS, 'utf8');
  await writeFile(join(OUT, '404.html'), html, 'utf8'); // Pages devolve o mesmo site em rotas desconhecidas
  await writeFile(join(OUT, '.nojekyll'), '', 'utf8');
  await copyFile(join(ROOT, 'public', 'logo.svg'), join(OUT, 'logo.svg'));
  return { files: ['index.html', 'estilo.css', '404.html', 'logo.svg', '.nojekyll'], html };
}

// Executado diretamente (`npm run site:build`), não quando importado em testes.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite()
    .then(({ files }) => {
      console.log(`site gerado em site/ → ${files.join(', ')}`);
    })
    .catch((error) => {
      console.error('falha ao gerar o site:', error);
      process.exit(1);
    });
}
