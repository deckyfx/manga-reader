# ============================================
# Stage 1: Builder
# ============================================
FROM oven/bun:1.3.8 AS builder

WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build single executable binary
RUN bun run build

# ============================================
# Stage 2: Runtime (Minimal Bun image)
# ============================================
FROM oven/bun:1.3.8

WORKDIR /app

# Copy compiled binary from builder
COPY --from=builder /app/app /app/app

# Copy dist folder (static assets needed by binary)
# Exclude source maps to reduce image size (~5.7MB saved)
COPY --from=builder /app/dist /app/dist
RUN find /app/dist -name "*.map" -delete

# Copy migration files (needed for database initialization)
COPY --from=builder /app/drizzle /app/drizzle

# Copy migration script for database initialization
COPY --from=builder /app/src/db/migrate.ts /app/migrate.ts

# Copy healthcheck script
COPY healthcheck.ts /usr/local/bin/healthcheck.ts
RUN chmod +x /usr/local/bin/healthcheck.ts

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Set environment to production
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Use entrypoint script for directory setup and migrations
ENTRYPOINT ["docker-entrypoint.sh"]
