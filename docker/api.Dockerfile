# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# MyAIHub API — multi-stage: dev (hot reload) e runner (produção)
# Contexto de build = raiz do monorepo.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV npm_config_update_notifier=false

# --- deps: instala o workspace inteiro a partir do lockfile ------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# ECONNRESET com o registry do npm derrubava o build inteiro sem retentativa
# nenhuma — retries/timeout mais folgados fazem uma falha transitória virar
# um retry automático em vez de build quebrado.
RUN npm config set fetch-retries 5 \
  && npm config set fetch-retry-mintimeout 5000 \
  && npm config set fetch-retry-maxtimeout 60000 \
  && npm ci

# --- dev: código montado por bind mount, hot reload --------------------------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate -w @myaihub/api
EXPOSE 3333
CMD ["npm", "run", "dev", "-w", "@myaihub/api"]

# --- build -------------------------------------------------------------------
FROM base AS build
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate -w @myaihub/api \
  && npm run build -w @myaihub/shared \
  && npm run build -w @myaihub/api

# --- runner: produção --------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
USER node
EXPOSE 3333
CMD ["node", "apps/api/dist/main.js"]
