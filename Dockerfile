FROM node:20-alpine

WORKDIR /app

# Install production dependencies first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy source
COPY src ./src

# Run as non-root, ensure uploads dir is owned correctly
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "src/index.js"]
