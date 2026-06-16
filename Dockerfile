# syntax=docker/dockerfile:1

# ---- Builder: compile native deps (better-sqlite3) ----
FROM node:22-alpine AS builder
WORKDIR /app
# Build toolchain required to compile better-sqlite3 on musl/alpine.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    BASE_PATH=/manga-tracker \
    MANGA_TRACKER_DATA_DIR=/app/data

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Persistent SQLite database lives here. Coolify bind-mounts a host directory
# over /app/data so the tracker state survives redeploys.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3001
CMD ["node", "server.js"]
