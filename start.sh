#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$SCRIPT_DIR}"

echo "========================================="
echo "  FactorioWebTS 服务启动"
echo "========================================="

cd "$PROJECT_DIR"

if [ ! -d "node_modules" ]; then
  echo "[1/3] 安装依赖..."
  npm install
fi

echo "[2/3] TypeScript 编译..."
npx tsc

echo "[3/3] 启动服务 (production)..."
NODE_ENV=production node dist/index.js &

sleep 2

echo "========================================="
echo "  FactorioWebTS 启动完成！"
echo "  API: http://localhost:3001"
echo "  WebSocket: ws://localhost:3001/ws"
echo "========================================="
