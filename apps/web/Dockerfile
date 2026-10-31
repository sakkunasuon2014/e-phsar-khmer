# Web (Next.js) image. Build from the REPO ROOT, since the pnpm lockfile and
# workspace config live there:
#   docker build -f apps/web/Dockerfile -t phsarkhmer-web \
#     --build-arg SUPABASE_URL=https://<project>.supabase.co \
#     --build-arg NEXT_PUBLIC_WS_URL=wss://<backend-host> .
#
# Ships Next's standalone output (next.config.ts `output: "standalone"`).

FROM node:22-slim AS base
# Matches the root package.json `packageManager`.
RUN npm install -g pnpm@9.0.0
WORKDIR /repo

FROM base AS build
# Lockfile-only download first, so this layer survives source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile --filter web...

# Read at BUILD time, so they are build args, not runtime env:
# - SUPABASE_URL: next.config.ts turns it into an allowed next/image host.
# - NEXT_PUBLIC_*: Next inlines these into the browser bundle; changing one
#   means rebuilding the image.
ARG SUPABASE_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_E2E_V2
ARG NEXT_PUBLIC_E2E_ATTACHMENTS
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3001 \
  HOSTNAME=0.0.0.0
WORKDIR /app
# In a workspace, standalone mirrors the repo layout (apps/web/server.js).
# Static assets and public/ are not traced into it and are copied alongside.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node

EXPOSE 3001
# API_URL (the backend base the server calls) is read at runtime.
CMD ["node", "apps/web/server.js"]
