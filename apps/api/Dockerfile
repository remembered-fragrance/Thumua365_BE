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
# `build` của API chạy `prisma generate` trước — Prisma Client được biên dịch vào dist.
RUN npm run build:packages && npm run build -w @mambo/api

# Chỉ gói chạy thật. Prisma CLI, TypeScript, Prisma Studio… là peer tuỳ chọn của
# @prisma/client nên lockfile đánh dấu `devOptional` — `--omit=dev` một mình không bỏ
# được, cần thêm `--omit=optional` (gói optional duy nhất phía chạy thật là
# pg-cloudflare, chỉ dùng trên Cloudflare Workers).
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/sdk/package.json packages/sdk/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund && mkdir -p apps/api/node_modules

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=deps /repo/package.json ./
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/packages/core/package.json packages/core/
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/packages/contracts/package.json packages/contracts/
COPY --from=build /repo/packages/contracts/dist packages/contracts/dist
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/apps/api/dist apps/api/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
