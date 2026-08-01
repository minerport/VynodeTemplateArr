FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
RUN pnpm --filter @vynode/control-plane deploy --prod --legacy /deploy \
    && rm -rf /deploy/src /deploy/.vynode-dev \
    && find /deploy/dist -type f \( -name 'dev.js' -o -name 'dev.js.map' -o -name '*.test.js' -o -name '*.test.js.map' \) -delete \
    && find /deploy/node_modules/.pnpm -path '*/node_modules/@vynode/*/src' -type d -prune -exec rm -rf '{}' + \
    && find /deploy/node_modules/.pnpm -path '*/node_modules/@vynode/*/scripts' -type d -prune -exec rm -rf '{}' + \
    && find /deploy/node_modules/.pnpm -path '*/node_modules/@vynode/*/dist/*.test.js' -type f -delete \
    && find /deploy/node_modules/.pnpm -path '*/node_modules/@vynode/*/dist/*.test.js.map' -type f -delete

FROM node:24-alpine AS runtime
ARG VYNODE_BUILD=github-actions
ARG VYNODE_COMMIT=unknown
LABEL org.opencontainers.image.title="Vynode" \
    org.opencontainers.image.version="0.1.0-rc.4" \
    org.opencontainers.image.licenses="GPL-3.0-only" \
    org.opencontainers.image.description="Self-hosted Plex collections, posters, overlays, watchlists, and missing-media management"
ENV NODE_ENV=production \
    VYNODE_VERSION=0.1.0-rc.4 \
    VYNODE_BUILD=$VYNODE_BUILD \
    VYNODE_COMMIT=$VYNODE_COMMIT \
    VYNODE_DOCUMENTATION_URL=https://github.com/minerport/VynodeTemplateArr/blob/main/README.md \
    VYNODE_ISSUE_URL=https://github.com/minerport/VynodeTemplateArr/issues \
    VYNODE_SOURCE_URL=https://github.com/minerport/VynodeTemplateArr \
    VYNODE_RELEASE_API_URL=https://api.github.com/repos/minerport/VynodeTemplateArr/releases?per_page=10 \
    VYNODE_DATA_DIR=/var/lib/vynode \
    VYNODE_HOST=0.0.0.0 \
    VYNODE_PORT=7171 \
    VYNODE_WEB_ROOT=/app/web-dist \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    HOME=/tmp/vynode-home \
    XDG_CONFIG_HOME=/tmp/vynode-home/.config \
    XDG_CACHE_HOME=/tmp/vynode-home/.cache \
    PUID=99 \
    PGID=100
WORKDIR /app
RUN apk add --no-cache chromium ffmpeg fontconfig font-dejavu font-noto-emoji freetype shadow su-exec yt-dlp \
    && addgroup -S vynode \
    && adduser -S -D -H -G vynode vynode \
    && mkdir -p /var/lib/vynode /media /tmp/vynode-home/.config /tmp/vynode-home/.cache \
    && chown -R vynode:vynode /var/lib/vynode /media /tmp/vynode-home
COPY --from=build --chown=vynode:vynode /deploy /app
COPY --from=build --chown=vynode:vynode /app/apps/web/dist /app/web-dist
COPY --chown=root:root scripts/docker-entrypoint.sh /usr/local/bin/vynode-entrypoint
RUN chmod 755 /usr/local/bin/vynode-entrypoint
EXPOSE 7171
VOLUME ["/var/lib/vynode"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O - http://127.0.0.1:7171/health >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/vynode-entrypoint"]
CMD ["node", "dist/server.js"]
