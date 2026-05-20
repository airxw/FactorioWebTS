FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/

RUN npm ci && npm cache clean --force

RUN npx tsc

FROM node:22-alpine

WORKDIR /app

RUN addgroup -S factorio && adduser -S factorio -G factorio

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/config ./config

EXPOSE 3001

USER factorio

CMD ["node", "dist/index.js"]