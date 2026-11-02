# Publicar o ANIMA e usar de qualquer aparelho

Este guia responde a uma pergunta só: **como abrir o ANIMA no celular, no tablet e no computador**, sem
virar especialista em servidor.

Antes das opções, uma verdade que evita frustração:

> **O ANIMA não é um site estático.** Ele tem um servidor que conversa com o modelo de linguagem, guarda
> o andamento das análises e continua trabalhando depois que você fecha a página. Por isso **GitHub Pages
> não serve** — ele só publica arquivos parados. E serviços que "hibernam" o processo (como funções
> serverless) interrompem análises no meio.

Existem três caminhos realistas. Escolha pelo seu caso:

| Opção | Funciona em qualquer lugar? | Precisa de computador ligado? | Custo | Dificuldade |
| --- | --- | --- | --- | --- |
| **1. Mesma rede Wi-Fi** | Não — só em casa | Sim | Zero | Muito baixa |
| **2. Túnel do seu PC** | Sim | Sim | Zero | Baixa |
| **3. Servidor na nuvem** | Sim | Não | De zero a ~US$5/mês | Média |

---

## Opção 1 — Celular na mesma rede Wi-Fi (comece por aqui)

No computador onde o ANIMA roda:

```bash
npm run dev -- -H 0.0.0.0
```

Descubra o IP da máquina:

- **Linux/macOS:** `hostname -I | awk '{print $1}'` ou `ipconfig getifaddr en0`
- **Windows:** `ipconfig` → "Endereço IPv4" (algo como `192.168.0.12`)

No celular, abra `http://192.168.0.12:3000`. Pronto: mesma casa, mesmo Wi-Fi, telas do tamanho do celular.

> Se não abrir, o firewall do computador provavelmente bloqueia a porta 3000. No Windows, permita o Node
> na primeira vez que ele perguntar.

**Limite honesto:** fora de casa, não funciona.

---

## Opção 2 — Túnel: acesso de qualquer lugar com o PC ligado

Um túnel cria um endereço público que aponta para o ANIMA na sua máquina. Não precisa de servidor nem de
conta paga. Duas escolhas comuns:

**Cloudflare Tunnel** (gratuito, sem abrir porta no roteador):

```bash
# instale uma vez: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:3000
# ele imprime um endereço https://algo-aleatorio.trycloudflare.com — abra no celular
```

**ngrok** (parecido, exige conta gratuita): `ngrok http 3000`.

> **Antes de expor, defina um token.** Qualquer pessoa com o endereço poderia gastar sua cota de LLM e ler
> suas análises. Com `ANIMA_ACCESS_TOKEN` no `.env` (veja abaixo), o ANIMA pede o token uma única vez e
> guarda o acesso no navegador.

**Limite honesto:** se o computador desliga, o endereço cai. O endereço do `trycloudflare` muda a cada vez.

---

## Opção 3 — Servidor na nuvem (funciona com o PC desligado)

Aqui o ANIMA mora num servidor e você abre de qualquer aparelho, sempre. O requisito é um serviço que
mantenha um **processo Node rodando** e, de preferência, um **disco que não apague** (o histórico fica num
arquivo SQLite).

O repositório já traz um `Dockerfile`, então qualquer host que aceite Docker funciona. Passo a passo
resumido (Render, Railway ou Fly.io — os três têm plano gratuito ou barato):

1. Crie conta no host e conecte o GitHub; escolha este repositório.
2. Deixe o host construir pelo `Dockerfile` (ele já roda `prisma generate` e `next build`).
3. Configure as variáveis de ambiente:

   | Variável | Valor |
   | --- | --- |
   | `LLM_PROVIDER` | `openai` |
   | `LLM_BASE_URL` | endpoint do provedor (veja `.env.example`) |
   | `LLM_API_KEY` | sua chave |
   | `LLM_MODEL` | o modelo escolhido |
   | `LLM_CONTEXT_TOKENS` | `32768` (ou o que seu modelo suportar) |
   | `ANIMA_ACCESS_TOKEN` | **uma senha longa que você inventa** |
   | `NEXT_PUBLIC_SITE_URL` | o endereço público que o host te der |
   | `DATABASE_URL` | `file:/data/anima.db` — **só se** você montar um disco em `/data` |
   | `ANIMA_STORE` | `memory` — **só se** não houver disco persistente |

4. Monte um **volume** em `/data` (ou o caminho que o host indicar) para o histórico sobreviver a reinícios.
   Sem volume, use `ANIMA_STORE=memory`: o app funciona, mas **cada reinício apaga o histórico**.
5. Abra o endereço fornecido com `?token=SEU_TOKEN` uma vez, no computador e em cada aparelho.

### O que conferir depois de publicar

```bash
curl -s https://SEU-ENDERECO/api/status?token=SEU_TOKEN   # deve responder JSON de status
curl -s -o /dev/null -w "%{http_code}\n" https://SEU-ENDERECO/   # deve responder 401 (protegido)
```

Depois, no navegador: faça uma análise **Panorama** (4 lentes) — é a mais barata — e confirme que as seções
aparecem e que o bloco "Recursos desta análise" mostra chamadas e tokens.

> **Atenção ao provedor:** se o modelo estiver configurado para `localhost:11434` (Ollama), ele **não existe**
> no servidor da nuvem. Nesse caso use Gemini, Groq ou OpenRouter.

---

## O token de acesso (`ANIMA_ACCESS_TOKEN`)

Sem essa variável, o ANIMA é aberto — comportamento correto para `localhost`, arriscado na internet.
Com ela definida:

- toda página e toda rota de API exigem o token;
- o token vai na URL **uma única vez** (`?token=…`), é guardado num cookie `HttpOnly` por 30 dias e
  removido da barra de endereços;
- scripts e `curl` podem usar o cabeçalho `x-anima-token: …`;
- o token é comparado em tempo constante (o tempo de resposta não revela o segredo).

Gere um token forte:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Para revogar, troque o valor no servidor: todos os aparelhos precisam do novo link.

---

## O que este projeto ainda **não** tem

Nada abaixo está prometido para uma versão futura — é o retrato honesto do que falta para uso multiusuário:

- **Contas separadas.** Há um token único: quem tem o token vê todas as análises.
- **Rate limit por pessoa.** A proteção é o token e a fila (`ANIMA_MAX_ACTIVE`/`ANIMA_MAX_QUEUE`), não uma
  cota por usuário.
- **HTTPS próprio.** Na opção 2, o túnel fornece. Na opção 3, o host fornece. Rodando direto, não há.

Se um dia o ANIMA receber mais gente, estes três itens vêm antes de qualquer divulgação pública.
