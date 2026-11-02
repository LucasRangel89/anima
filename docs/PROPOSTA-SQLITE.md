# Proposta: trocar Prisma por SQLite direto

> **Status: proposta, não execução.** Este documento existe para a decisão ser tomada com números na mesa, e
> não porque haja urgência. O Prisma hoje funciona: o contrato do store roda contra ele no CI, com banco de
> verdade. Nada aqui está quebrado.

## O problema que a troca resolveria

1. **Peso e atrito de instalação.** `prisma` + `@prisma/client` somam dezenas de MB; no primeiro `npm install`
   isso é o grosso do que se baixa. Engines de query são binários nativos — a origem dos problemas de
   plataforma (musl × glibc, Mac × Linux) e do `PRISMA_*_ENGINE` que aparece em guias improvisados.
2. **Uma ferramenta a mais para um banco que não muda de forma.** O schema tem duas tabelas e três colunas
   JSON; o app nunca faz migração destrutiva. `db push` é o caminho, e ele já é o suficiente.
3. **Superfície de erro em tempo de build.** `prisma generate` precisa rodar antes do build; em ambientes
   onde baixar binário é bloqueado, o build quebra por motivo que não é código.

## O que a troca custaria

| Área | Trabalho |
| --- | --- |
| `src/lib/anima/store-prisma.ts` | Reescrita quase completa (~200 linhas): hoje são chamadas tipadas do client; viraria SQL com `better-sqlite3` ou `node:sqlite`. |
| Dependências | Sai `prisma`/`@prisma/client`; entra **uma** (`better-sqlite3`, binário nativo) — ou nenhuma, usando `node:sqlite` (Node 22+ experimental, Node 24 estável). |
| Schema e `db push` | Some o `schema.prisma`; o DDL passa a viver num arquivo `.sql` com `CREATE TABLE IF NOT EXISTS` — simples, mas agora a responsabilidade de evoluir é nossa. |
| JSON | Hoje o Prisma aceita strings JSON; direto continua sendo `TEXT` com `JSON.stringify`/`parse` — sem diferença. |
| Datas | `Date` do SQLite vem como texto/número; cada leitura precisa de conversão explícita. |
| Contrato do store | Continua valendo: a mesma suíte roda contra memória e SQLite. Não muda. |
| Docker/CI | Build fica mais simples (sem `prisma generate`), mas `better-sqlite3` compila binário no `npm ci` — troca um atrito por outro, menor. |
| Migration de dados | Nenhuma: mesmo arquivo `.db`, mesmas tabelas. Reversível com o arquivo antigo em mãos. |

Estimativa: **meio dia de trabalho** com testes, se feito com calma; risco concentrado em conversão de datas e
na reescrita do SQL.

## Recomendação

**Não agora.** O ganho é de instalação e de uma dependência menos; o custo é reescrever a única camada que
guarda o histórico do usuário. O momento natural seria:

- quando `node:sqlite` estiver estável na versão de Node que o projeto exige (aí a troca remove dependência em
  vez de trocar uma por outra); **ou**
- se o Prisma passar a atrapalhar o build em máquinas reais (relatos concretos, não hipótese).

Nesse dia, o caminho é: escrever a implementação nova ao lado da atual, rodar a suíte de contrato contra as
duas, comparar byte a byte o conteúdo exportado e só então apagar a antiga.

## O que já foi feito para deixar a porta aberta

- Toda a persistência passa por uma interface (`AnalysisStore`) — o orquestrador e as rotas não importam Prisma.
- O contrato é testado contra duas implementações (memória e Prisma) com a mesma suíte.
- Nenhuma consulta usa recurso exclusivo do Prisma além de CRUD e `orderBy`/`where` simples.
