FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json eslint.config.mjs ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build

FROM node:24-bookworm-slim AS api
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps ./apps
COPY --from=build /repo/packages ./packages
CMD ["node", "apps/api/dist/server.js"]

FROM node:24-bookworm-slim AS worker
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps ./apps
COPY --from=build /repo/packages ./packages
CMD ["node", "apps/worker/dist/index.js"]

FROM nginx:1.29-alpine AS web
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
