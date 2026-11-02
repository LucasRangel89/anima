# ANIMA — imagem para hospedar num processo Node persistente (VPS, Render, Railway, Fly.io).
#
# Por que existe: o ANIMA roda o pipeline em background no próprio processo (ver README). Funções
# serverless interrompem as análises no meio; um container com processo longo não.
#
# Sem `output: standalone` de propósito: `next start` mantém o servidor Node normal, que é o que o
# orquestrador espera (fila e execuções vivem na memória do processo).

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# `openssl` é exigido pelos engines do Prisma no Debian slim.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL de fábrica só para o `prisma generate` do build; o valor real vem do ambiente em runtime.
ENV DATABASE_URL="file:/data/anima.db"
RUN npx prisma generate && npx next build

FROM base AS runner
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/anima.db"
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
# Histórico: monte um volume em /data para sobreviver a reinícios (ou use ANIMA_STORE=memory).
RUN mkdir -p /data
EXPOSE 3000
# O banco é criado/atualizado no start: uma instalação nova funciona sem passo manual.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start -H 0.0.0.0 -p ${PORT}"]
