# Shopfloor Sentinel – backend + dashboard in one image.
#   docker compose up -d            (see docker-compose.yml and docs/DEPLOYMENT.md)
# Build without the local embedding model (smaller image, keyword search):
#   docker build --build-arg WITH_EMBEDDINGS=false .

# ---- 1. build the React dashboard
FROM node:22-bookworm-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. backend production dependencies
FROM node:22-bookworm-slim AS deps
ARG WITH_EMBEDDINGS=true
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN if [ "$WITH_EMBEDDINGS" = "true" ]; then npm ci --omit=dev --no-audit --no-fund; \
    else npm ci --omit=dev --omit=optional --no-audit --no-fund; fi

# ---- 3. runtime
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=deps /app/backend/node_modules backend/node_modules
COPY backend/ backend/
COPY docs/ docs/
COPY --from=web /app/frontend/dist frontend/dist
# Without the optional embedding package the app falls back to keyword search by itself.
RUN mkdir -p backend/data backend/uploads && chown -R node:node backend/data backend/uploads
USER node
VOLUME ["/app/backend/data", "/app/backend/uploads"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "backend/src/server.js"]
