FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY config.example.json ./config.example.json
COPY README.md ./README.md
COPY LICENSE ./LICENSE

RUN mkdir -p /app/data && chmod +x /app/scripts/*.sh

ENV PORT=18317 \
    CPA_BASE_URL=http://host.docker.internal:8317 \
    DB_PATH=/app/data/health-dashboard.sqlite \
    POLL_INTERVAL_MS=1000 \
    QUEUE_BATCH_SIZE=100 \
    MAPPING_REFRESH_MS=300000 \
    RECENT_WINDOW_MINUTES=15

EXPOSE 18317

CMD ["node", "src/server.mjs"]
