# The provider worker. It is a poller, not a server: it holds no port, it reads
# claimable jobs out of the rollup, answers them, and submits.
#
# The build context is the whole workspace because the worker imports
# `@inference-market/client` as a workspace package; installing worker/ alone
# would not resolve it.
FROM node:22-slim AS deps
WORKDIR /srv
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY worker/package.json worker/
COPY app/package.json app/
# Only the worker's tree and the workspace root it resolves through. `app` is a
# browser bundle that is never run here, so its dev tooling stays out of the
# image. `--ignore-scripts` skips two optional native builds that the worker
# does not use and that would otherwise need a compiler in this stage.
RUN npm ci --omit=dev --ignore-scripts \
      --workspace @inference-market/worker --include-workspace-root

FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY --from=deps /srv/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY client ./client
COPY worker ./worker
USER node
CMD ["node", "node_modules/tsx/dist/cli.mjs", "worker/src/index.ts"]
