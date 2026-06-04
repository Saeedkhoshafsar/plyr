# ============================================================
# automation-backend — multi-stage Docker build (Node-base)
# Uses the official Playwright image (browsers + system deps bundled).
# ============================================================

# ---------- Stage 1: build ----------
FROM mcr.microsoft.com/playwright:v1.56.1-jammy AS build

WORKDIR /app

# Install dependencies first (better layer caching).
# Skip the browser download here; the runtime image already has browsers.
ENV SKIP_BROWSER_INSTALL=1
COPY package.json package-lock.json* ./
RUN npm install --ignore-scripts

# Copy source and compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune devDependencies for a slim runtime node_modules
RUN npm prune --omit=dev


# ---------- Stage 2: runtime ----------
FROM mcr.microsoft.com/playwright:v1.56.1-jammy AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    SKIP_BROWSER_INSTALL=1

WORKDIR /app

# Bring in only what we need to run
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Runtime data directories
RUN mkdir -p logs profiles uploads downloads

EXPOSE 3000

# Container-level healthcheck hitting the /health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Run the compiled server directly (single process; use PM2/compose scale for clustering)
CMD ["node", "dist/index.js"]
