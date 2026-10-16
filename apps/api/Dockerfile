FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/apps/api
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
WORKDIR /app/apps/api
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3300
COPY --from=dependencies /app/apps/api/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY config ./config
COPY skills ./skills
COPY migrations ./migrations
COPY scripts/migrate.js scripts/codex-cloud-fixture.js ./scripts/
COPY data/knowledge-graph-skeleton.json ./data/knowledge-graph-skeleton.json
# Runtime documents and the run journal live on the Railway /data volume.
RUN mkdir -p /data && ln -s /data /app/data
EXPOSE 3300
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "src/start.js"]
