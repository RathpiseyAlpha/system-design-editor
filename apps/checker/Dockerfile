# The checker service as one container (SPEC section 10). Build from the repository root, so the engine package is in reach:
#   docker build -f apps/checker/Dockerfile -t archboard-checker .
#   docker run --rm -e ARCHBOARD_KEYS="labsite:<a long random secret>" -p 127.0.0.1:8787:8787 archboard-checker
# On the instructor's server it joins labsite's Docker network and publishes no port: labsite calls http://checker:8787.

FROM node:22.21.1-alpine3.22 AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/editor/package.json apps/editor/
COPY apps/checker/package.json apps/checker/
COPY apps/cloud/package.json apps/cloud/
RUN npm ci --workspace @archboard/checker --ignore-scripts --no-audit --no-fund
COPY packages/engine packages/engine
COPY apps/checker apps/checker
RUN cd apps/checker && node build.mjs

# The service is two bundled files: no node_modules, no TypeScript, no source in the image.
FROM node:22.21.1-alpine3.22
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /src/apps/checker/dist/server.js /src/apps/checker/dist/worker.js ./dist/
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/v1/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
