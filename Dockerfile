# syntax=docker/dockerfile:1

# ---- Builder ----
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# Coolify supplies NODE_ENV=production as a build argument. Explicitly retain
# the TypeScript/Vite toolchain in this builder stage; runtime stays prod-only.
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:24-alpine AS production-dependencies
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    MANGA_TRACKER_DATA_DIR=/app/data

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./package.json

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3001
CMD ["node", "dist/src/server/index.js"]
