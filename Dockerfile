FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && DATABASE_URL=file:/app/bootstrap.db npx prisma db push --skip-generate && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/server/assets/bot ./server/assets/bot
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bootstrap.db ./bootstrap.db
COPY server/python-requirements.txt ./python-requirements.txt
COPY scripts/deploy/docker-entrypoint.sh ./docker-entrypoint.sh
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r python-requirements.txt && mkdir -p /var/lib/oskolok/private /var/lib/oskolok/user-content /app/server && ln -s /var/lib/oskolok /app/server/data && chown -R node:node /var/lib/oskolok && chmod 755 docker-entrypoint.sh
ENV NODE_ENV=production PORT=5000 DATABASE_URL=file:/var/lib/oskolok/oskolok.db PRIVATE_DIR=/var/lib/oskolok/private USER_CONTENT_DIR=/var/lib/oskolok/user-content PYTHON_PATH=/opt/venv/bin/python FFMPEG_PATH=/usr/bin/ffmpeg
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist-server/server.js"]
