# syntax=docker/dockerfile:1
#
# Build từ GỐC repo:  docker build -f apps/api/Dockerfile .
# Render dùng đúng lệnh này (render.yaml: dockerContext ".").

FROM node:22-alpine AS build
WORKDIR /repo

# Chép package.json trước để lớp `npm ci` được cache khi chỉ sửa code.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/sdk/package.json packages/sdk/
COPY apps/api/package.json apps/api/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN npm run build:packages && npm run build -w @mambo/api \
  && npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/core/package.json packages/core/
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/packages/contracts/package.json packages/contracts/
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
