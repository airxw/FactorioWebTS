# FactorioWebTS — 重构版 (TypeScript)

Factorio 服务器管理面板，从 PHP 迁移到 Node.js/TypeScript + Fastify。

## 与旧项目的关系
- 旧项目：`../FactorioWeb/`（PHP）
- 新项目：`../FactorioWebTS/`（TypeScript）
- 通过绞杀者模式逐步替换 PHP API

## 技术栈
- **运行时**: Node.js 22
- **框架**: Fastify 5
- **数据库**: SQLite (better-sqlite3)
- **实时通信**: @fastify/websocket
- **认证**: @fastify/jwt
- **校验**: Zod
- **日志**: Pino
- **测试**: Vitest

## 快速开始
```bash
npm install
npm run dev        # http://localhost:3001
npm test           # 运行测试
npm run typecheck  # 类型检查
```
