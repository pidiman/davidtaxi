# syntax=docker/dockerfile:1.7
#
# Rýchly rebuild: závislosti sa inštalujú len pri zmene package.json / pnpm-lock.yaml
# a balíčky sa berú z cache (pnpm store), nie z internetu. Pri bežnej zmene kódu
# sa spustí len TypeScript + Vite build (~20–40 s).

FROM node:22.22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# ---------- všetky závislosti (na build) ----------
FROM base AS deps
RUN --mount=type=cache,id=davidtaxi-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ---------- len produkčné závislosti API (do výsledného image) ----------
FROM base AS prod-deps
RUN --mount=type=cache,id=davidtaxi-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter api --store-dir /pnpm/store

# ---------- build (jediná vrstva, ktorá sa mení pri zmene kódu) ----------
FROM deps AS build
COPY apps ./apps
RUN pnpm --filter web build && pnpm --filter api build

# ---------- runtime ----------
FROM node:22.22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/apps/api/drizzle
WORKDIR /app

COPY --from=prod-deps /src/node_modules ./node_modules
COPY --from=prod-deps /src/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /src/apps/api/package.json ./apps/api/package.json
COPY --from=build /src/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /src/apps/api/dist ./apps/api/dist
COPY --from=build /src/apps/web/dist ./web

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/api/dist/index.js"]
