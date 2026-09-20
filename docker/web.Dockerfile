# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# MyAIHub Web — multi-stage: dev (Vite HMR) e runner (nginx servindo o build)
# Contexto de build = raiz do monorepo.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV npm_config_update_notifier=false

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

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "@myaihub/web", "--", "--host", "0.0.0.0"]

FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build -w @myaihub/shared && npm run build -w @myaihub/web

FROM nginx:1.27-alpine AS runner
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
