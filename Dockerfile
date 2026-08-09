# ─────────────────────────────────────────────────────────────────
# LOCAL DEVELOPMENT ONLY — NOT used in VPS production
#
# The VPS runs a bare Node.js process via PM2 (see ecosystem.config.js).
# This Dockerfile exists so contributors who prefer containers can
# develop locally without touching the VPS deployment path.
#
# Usage:
#   docker build -t alphapack-dev .
#   docker run --env-file .env alphapack-dev
# ─────────────────────────────────────────────────────────────────

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline

# ── Build stage ───────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=development

# Copy only what's needed to run
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src/i18n ./dist/i18n
COPY --from=builder /app/src/config/defaults.yaml ./dist/config/defaults.yaml
COPY package.json .

# NOTE: Redis is expected to be provided externally (host Redis or a
# redis container linked via --network or docker-compose in local dev).
# Set REDIS_URL in your .env accordingly.

CMD ["node", "--max-old-space-size=256", "dist/index.js"]
