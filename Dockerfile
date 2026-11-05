# RealityTest — single image used for both the web app and the job worker.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec prisma generate && pnpm exec next build

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL=file:/data/realitytest.db \
    STORAGE_DIR=/data/storage \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
# Schema is applied on start (SQLite MVP). Override CMD for the worker.
CMD ["sh", "-c", "node_modules/.bin/prisma db push --skip-generate && node_modules/.bin/next start -p ${PORT}"]
