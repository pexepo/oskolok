# ==============================================================================
# Multi-stage Dockerfile for Oskolok
# ==============================================================================

# Stage 1: Build Frontend and Server
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
RUN npm install

# Copy project source files
COPY . .

# Build frontend (dist) and server (dist-server)
RUN npm run build:client
RUN npm run build:server

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime utilities: Python3 and ffmpeg (for audio stream resolution)
RUN apk add --no-cache python3 ffmpeg py3-pip

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "dist-server/server.js"]
