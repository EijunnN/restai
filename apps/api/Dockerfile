# ── Stage 1: install dependencies ─────────────────────────────────────
FROM oven/bun:1.3.8-alpine AS base
WORKDIR /app

# Copy workspace root files
COPY package.json bun.lock turbo.json ./

# Copy ALL workspace package.json files (bun.lock expects full workspace)
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validators/package.json packages/validators/package.json

RUN bun install --frozen-lockfile --production

# ── Stage 2: source ──────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

# Copy source code (workspace packages + api)
COPY packages/ packages/
COPY apps/api/ apps/api/

# ── Stage 3: production runner ────────────────────────────────────────
FROM oven/bun:1.3.8-alpine AS runner
WORKDIR /app

# Non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy node_modules + source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/turbo.json ./turbo.json

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["bun", "run", "apps/api/src/index.ts"]
