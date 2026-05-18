FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine

WORKDIR /app

RUN addgroup -S factorio && adduser -S factorio -G factorio

COPY --from=builder /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/

RUN npm install -g typescript tsx && npx tsc

EXPOSE 3001

USER factorio

CMD ["node", "dist/index.js"]