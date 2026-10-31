# Backend image. Build from the REPO ROOT, since the pnpm lockfile and
# workspace config live there:
#   docker build -f apps/backend/Dockerfile -t phsarkhmer-backend .
#
# Node 22 (>= 22.12) is required, not just preferred: `effect` v4 and several
# other deps are ESM-only, and the CommonJS build loads them through Node's
# native require(esm).

FROM node:22-slim AS base
# Matches the root package.json `packageManager`. Installed through npm rather
# than corepack, whose signature checks have broken builds on older images.
RUN npm install -g pnpm@9.0.0
WORKDIR /repo

FROM base AS build
# Toolchain only for a native addon (bcrypt) that has to compile from source
# when its prebuilt binary can't be downloaded. Never reaches the final image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Download every package from the lockfile alone first, so this layer stays
# cached until pnpm-lock.yaml changes rather than on every source edit.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter backend... \
  && pnpm --filter backend build

# `deploy` writes a self-contained copy of the backend with production
# dependencies only. Whether it carries dist/ depends on pack rules, so the
# build output is replaced explicitly.
RUN pnpm --filter backend deploy --prod /out \
  && rm -rf /out/dist \
  && cp -r apps/backend/dist /out/dist

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node

EXPOSE 3000
CMD ["node", "dist/src/main.js"]
