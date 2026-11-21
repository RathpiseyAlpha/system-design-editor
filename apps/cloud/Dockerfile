# The cloud service as one container (SPEC section 8.4): the editor's build and the accounts API from one address.
# Build from the repository root, so the engine and the editor are in reach:
#   docker build -f apps/cloud/Dockerfile -t archboard-cloud .
#   docker run --rm -p 127.0.0.1:8788:8788 -v archboard-data:/app/data \
#     -e PUBLIC_URL=https://archboard.example.org/ -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... archboard-cloud
# Put it behind the server's https proxy (docs/cloud-deploy.md). The database is /app/data/archboard.db: keep that volume.

FROM node:22.21.1-alpine3.22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/editor/package.json apps/editor/
COPY apps/checker/package.json apps/checker/
COPY apps/cloud/package.json apps/cloud/
RUN npm ci --workspace @archboard/cloud --workspace @archboard/editor --ignore-scripts --no-audit --no-fund
COPY design design
COPY packages/engine packages/engine
COPY apps/editor apps/editor
COPY apps/cloud apps/cloud
# Without design/icons/aws (fetched by tools/fetch_icons.py, not in the repository) the AWS pack shows the generic icons.
RUN cd apps/editor && node ../../node_modules/vite/bin/vite.js build && cd ../cloud && node build.mjs

FROM node:22.21.1-alpine3.22
WORKDIR /app
ENV NODE_ENV=production PORT=8788 ARCHBOARD_DB=/app/data/archboard.db ARCHBOARD_STATIC=/app/public
COPY --from=build /src/apps/cloud/dist/server.js ./dist/
COPY --from=build /src/apps/editor/dist ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8788/api/me >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
