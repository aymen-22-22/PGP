# Optional. The application runs perfectly well as a plain Node process on
# shared hosting; this exists only for VPS deployments that prefer containers.
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @phone-erp/api --include-workspace-root

COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/apps/web/dist apps/web/dist

USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
