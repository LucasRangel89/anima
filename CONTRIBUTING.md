# Contribuindo

## Ambiente

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

Sem chave de LLM: `ANIMA_STORE=memory LLM_PROVIDER=mock npm run dev`.

## Antes de abrir um PR

```bash
npm run check   # typecheck + lint + testes
```

- `npm test` usa `node:test` e roda com o provedor `mock`: nada é enviado a APIs externas.
- Se você mexeu em prompts, rode também `npx tsx --test tests/prompts.test.ts` — há verificação das seções obrigatórias e da calibragem por profundidade.

## Convenções

- **Português do Brasil** na interface, nos prompts e nos comentários de domínio; inglês apenas em nomes de API externas.
- **Sem dependências novas** sem necessidade clara: o projeto evita SDKs grandes no cliente.
- **Prompts são código.** Mudou a teoria? Explique no PR o que muda na saída e por quê.
- **Privacidade e segurança:** qualquer nova fonte precisa tratar texto externo como dado e passar por sanitização.
- **Tudo que é persistido** entra no schema de forma aditiva (campo opcional ou com default), para não quebrar bancos existentes.

## Estrutura de um bom PR

1. O problema (com exemplo de saída ruim, se for de prompt).
2. A mudança (arquivos e decisões).
3. Como verificou (testes, capturas, análise de exemplo).
4. Riscos e custo (chamadas extras de LLM? mais tempo?).
