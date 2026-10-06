# Pillage First! game server: runs game worlds on the server so saves follow you to any device.
# See docs/SELF_HOSTING.md

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY . .
RUN npm ci

# Graphics, same steps as netlify.toml
RUN npm run inject-graphics \
  && mkdir -p apps/web/public/graphic-packs/default/buildings/village \
  && cp -r custom-graphics/buildings/village/. apps/web/public/graphic-packs/default/buildings/village/ \
  && mkdir -p apps/web/public/graphic-packs/default/backgrounds \
  && cp custom-graphics/backgrounds/village-*.jpg apps/web/public/graphic-packs/default/backgrounds/

# Build the web app in game server mode, and the server itself
ENV VITE_GAME_SERVER=true
RUN npx turbo run build --filter=@pillage-first/web --filter=@pillage-first/server

# The server bundle needs only the SQLite package at runtime
RUN mkdir -p /out/node_modules/@sqlite.org \
  && cp -r "$(dirname "$(node -p "require.resolve('@sqlite.org/sqlite-wasm/package.json', { paths: ['apps/server'] })")")" /out/node_modules/@sqlite.org/sqlite-wasm \
  && cp -r apps/server/build /out/server \
  && cp -r apps/web/build/client /out/web

FROM node:24-bookworm-slim
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web

COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/server ./server
COPY --from=build /out/web ./web

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/main.js"]
