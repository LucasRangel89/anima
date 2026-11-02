// ANIMA — proteção opcional para quando o app sai do localhost.
//
// O projeto foi desenhado para uso pessoal em localhost: sem login, sem multiusuário. Isso está certo
// enquanto ninguém além de você alcança a porta. No instante em que o app vai para a internet, qualquer
// pessoa que descubra o endereço pode:
//   • gastar a sua cota de LLM (dinheiro/limite diário);
//   • ler, cancelar e apagar as suas análises (não há dono por linha).
//
// Solução mínima e honesta — sem cadastro, sem banco de usuários: um segredo compartilhado.
// Com ANIMA_ACCESS_TOKEN definido, todo acesso (páginas e API) exige o token, que fica em cookie
// httpOnly. Sem a variável, nada muda: localhost continua sem atrito.
//
// O arquivo se chama `proxy.ts` porque o Next 16 descontinuou a convenção `middleware.ts`;
// a função equivalente agora é `proxy`.

import { NextResponse, type NextRequest } from 'next/server';

export const config = {
  // Tudo, menos os arquivos estáticos do Next e os ícones.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)'],
};

const COOKIE = 'anima_token';
const HEADER = 'x-anima-token';
const QUERY = 'token';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Comparação em tempo constante sobre o digest: evita vazar o token por diferença de tempo. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = va.length ^ vb.length;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function isApi(pathname: string): boolean {
  return pathname.startsWith('/api');
}

function cookieOptions(url: URL) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: url.protocol === 'https:',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}

export async function proxy(request: NextRequest) {
  const expected = process.env.ANIMA_ACCESS_TOKEN?.trim();

  // Sem token configurado: uso pessoal em localhost, sem atrito.
  if (!expected) return NextResponse.next();

  const url = request.nextUrl;
  const provided = url.searchParams.get(QUERY) ?? request.headers.get(HEADER) ?? request.cookies.get(COOKIE)?.value;

  if (provided && (await sameSecret(provided, expected))) {
    const fromLink = url.searchParams.has(QUERY);

    // URL de API com ?token= é chamada de script/curl: segue direto, só guardando o cookie.
    if (isApi(url.pathname)) {
      const response = NextResponse.next();
      if (fromLink) response.cookies.set(COOKIE, expected, cookieOptions(url));
      return response;
    }

    // Página aberta por link: guarda o acesso e limpa a URL, para o segredo não ficar no histórico
    // nem em links compartilhados por engano.
    if (fromLink) {
      const clean = new URL(url);
      clean.searchParams.delete(QUERY);
      const response = NextResponse.redirect(clean);
      response.cookies.set(COOKIE, expected, cookieOptions(url));
      return response;
    }
    return NextResponse.next();
  }

  if (isApi(url.pathname)) {
    return NextResponse.json(
      { error: 'Acesso restrito. Envie o token em ?token=… ou no cabeçalho x-anima-token.' },
      { status: 401 }
    );
  }

  return new NextResponse(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>ANIMA — acesso restrito</title>
     <style>
       body{font-family:ui-sans-serif,system-ui,sans-serif;background:#fbf9f5;color:#2a221d;
            display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem}
       main{max-width:34rem}
       h1{font-size:1.5rem;margin:0 0 .5rem}
       p{line-height:1.6;color:#6c6158}
       code{background:#f3f0ea;padding:.15rem .35rem;border-radius:.25rem}
       @media (prefers-color-scheme:dark){
         body{background:#13100d;color:#ebe7e2}p{color:#9e978f}code{background:#29231f}
       }
     </style></head>
     <body><main>
       <h1>Acesso restrito</h1>
       <p>Este ANIMA está publicado e protegido por um token. Abra o endereço com
          <code>?token=SEU_TOKEN</code> uma única vez — o navegador guarda o acesso por 30 dias.</p>
       <p>O token é o valor de <code>ANIMA_ACCESS_TOKEN</code> no servidor.</p>
     </main></body></html>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
