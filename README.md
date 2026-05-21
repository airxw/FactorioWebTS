# FactorioWebTS

Factorio 服务器 Web 管理面板，基于 Node.js / TypeScript + Fastify 构建。

提供完整的服务器管理、玩家管理、商店系统、VIP 系统、RCON 控制台、日志监控等功能，支持 WebSocket 实时通信。

## 技术栈

- **运行时**: Node.js 22
- **框架**: Fastify 5
- **数据库**: SQLite (better-sqlite3)
- **实时通信**: @fastify/websocket
- **认证**: @fastify/jwt + bcrypt
- **校验**: Zod
- **日志**: Pino
- **前端**: Alpine.js + htmx (服务端渲染)

## 功能模块

| 模块 | 说明 |
|------|------|
| auth | 用户认证、权限管理 |
| shop | 游戏内商店 |
| cart | 购物车 |
| vip | VIP 等级系统 |
| player | 玩家管理 |
| server | 服务器控制（启动/停止/重启） |
| config | 服务器配置管理 |
| chat | 聊天管理、定时消息 |
| mod | Mod 管理 |
| vote | 投票系统 |
| file | 文件管理（存档等） |
| log | 日志查看 |
| version | 版本管理 |
| backup | 备份管理 |
| cdk | CDK 兑换码系统 |
| health | 健康检查 |

## 快速开始

### 环境要求

- Node.js 22
- g++（编译 better-sqlite3 / bcrypt 原生模块）
- Factorio 服务端（如需 RCON 和日志功能）

### 安装与运行

```bash
npm install
cp .env.example .env
# 编辑 .env，至少设置 JWT_SECRET 和 RCON_PASSWORD
npm run dev        # 开发模式，http://localhost:3001
```

### 初始化

首次运行前需要初始化数据库和管理员账户：

```bash
npm run init       # 交互式初始化
# 或通过环境变量/参数非交互式初始化：
ADMIN_USERNAME=admin ADMIN_PASSWORD=your-password npm run init
```

检查是否已初始化：

```bash
npm run init:check
```

### 生产部署

```bash
npm run build      # TypeScript 编译
npm start          # 运行编译后的代码
# 或使用启动脚本
./start.sh
```

### Docker 部署

```bash
docker-compose up -d
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3001 | 服务端口 |
| HOST | 0.0.0.0 | 监听地址 |
| JWT_SECRET | - | JWT 签名密钥（必须设置，至少32字符） |
| RCON_HOST | 127.0.0.1 | RCON 主机 |
| RCON_PORT | 27015 | RCON 端口 |
| RCON_PASSWORD | - | RCON 密码（优先使用 server-settings.json 中的值） |
| DB_PATH | ./data/factorio.db | 数据库路径 |
| LOG_LEVEL | info | 日志级别 |
| CORS_ORIGIN | http://localhost:3001 | CORS 允许的来源 |
| FACTORIO_PATH | 项目根目录 | Factorio 安装路径 |
| BCRYPT_COST | 12 | bcrypt 加密轮数 |
| SYNC_ITEMS_URL | - | 物品数据同步地址 |

> **RCON 密码说明**：项目会先读取 `.env` 中的 `RCON_PASSWORD`，如果 `config/server-settings.json` 中存在 `rcon_password` 且非空，则优先使用 `server-settings.json` 中的值。

## 项目结构

```
src/
├── app.ts              # Fastify 应用构建
├── index.ts            # 入口文件
├── config/
│   ├── constants.ts    # 常量定义
│   └── env.ts          # 环境变量加载与校验
├── lib/
│   ├── database.ts     # 数据库连接
│   ├── event-bus.ts    # 事件总线
│   ├── game-command-bus.ts  # 游戏命令总线
│   ├── command-queue.ts     # 命令队列
│   ├── log-reader.ts   # 日志读取器
│   ├── log-rotation.ts # 日志轮转
│   ├── log-watcher.ts  # 日志文件监听
│   ├── logger.ts       # 日志工具
│   ├── paths.ts        # 路径管理
│   ├── rcon.ts         # RCON 导出
│   ├── rcon-client.ts  # RCON 连接实现
│   ├── rcon-manager.ts # RCON 连接池管理
│   └── scheduler.ts    # 定时任务调度
├── modules/            # 业务模块（每个模块含 routes/service/repository/schema）
├── plugins/            # Fastify 插件（CORS/WebSocket/JWT/静态文件/限流）
├── scripts/
│   ├── init.ts         # 初始化脚本
│   └── sync-items.ts   # 物品数据同步
└── types/
    └── index.ts        # 全局类型定义
```

## 开发

```bash
npm run dev          # 开发模式（热重载）
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm run lint:fix     # 自动修复
```

