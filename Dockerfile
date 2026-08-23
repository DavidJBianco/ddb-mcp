FROM node:20-bookworm-slim AS build

WORKDIR /app

# Install the exact dependency graph before copying source so dependency layers
# remain cacheable when only application code changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev


FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/home/mcp

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules

# Mysterium launches a headed Chromium instance. Playwright installs the matching
# browser and its Linux dependencies; Xvfb supplies the virtual display.
RUN npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install --yes --no-install-recommends tini xauth \
    && test -x /usr/bin/tini \
    && test -x /usr/bin/xvfb-run \
    && test -x /usr/bin/xauth \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin mcp \
    && mkdir -p /home/mcp/.config/mysterium \
    && chown -R mcp:mcp /home/mcp

# Application output changes much more often than the browser runtime. Keep it
# after the expensive Playwright layer so normal source edits retain the cache.
COPY --from=build /app/dist ./dist

USER mcp

# Keep authenticated browser state outside the container's writable layer.
VOLUME ["/home/mcp/.config/mysterium"]

ENTRYPOINT ["tini", "--", "xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "node", "dist/index.js"]
