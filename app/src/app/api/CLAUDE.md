[根目录](../../../../ARCHITECTURE.md) > [app](../../../CLAUDE.md) > [src](../../CLAUDE.md) > [app](../CLAUDE.md) > **api**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# app/src/app/api — REST API 路由

## 模块职责

集中所有后端 HTTP 端点。每个 `route.ts` 对应一个 URL，使用 **Next.js 16 Route Handlers**（`GET` / `POST` / `PATCH` / `DELETE` 函数导出）。

## 全局约定

| 约定 | 说明 |
|------|------|
| **鉴权** | 所有受保护端点开头必须 `const session = await auth()`，未登录返回 `401 Unauthorized` |
| **响应格式** | 统一使用 `NextResponse.json({...})`；错误 `{ error: string }` |
| **动态路由参数** | 使用 `Promise<{ id: string }>`（Next.js 16 要求 `await params`） |
| **限流** | 重要端点必须走 `rateLimiters.*`（来自 `@/lib/rate-limit`），失败返回 `429` |
| **内容安全** | 图像/视频生成前必须 `contentSafetyMiddleware(prompt, kind)` |
| **积分扣减** | 生成类端点查 `User.credits`，不足返回 `400` |
| **日志** | 使用 `createLogger("api:<name>")`；不要直接 `console.*` |

## 入口与启动

所有文件按路径即路由加载：`app/src/app/api/<path>/route.ts` → `/api/<path>`。

## 主要端点族（索引）

| 路径前缀 | 主要端点 | 作用 |
|----------|----------|------|
| `/api/auth/**` | NextAuth handlers (`[...nextauth]/route.ts`) + 自定义 `register/` | 登录/注册/会话 |
| `/api/projects` | `GET`（列表）、`POST`（新建） | 项目 CRUD |
| `/api/projects/[id]` | `GET` / `PATCH` / `DELETE` | 单项目 |
| `/api/projects/[id]/scenes` | `POST`（批量保存） | 分镜持久化 |
| `/api/projects/[id]/export` | `POST`（触发导出）、`GET?taskId=` | 视频合成导出 |
| `/api/projects/[id]/workflow` | `POST` / `GET` / SSE | 启动/查询 Agent Workflow |
| `/api/script/parse` | `POST` | 文本 → 分镜 JSON |
| `/api/generate/image` | `POST` | 图像生成（含 orchestrateImageGeneration） |
| `/api/generate/video` | `POST` | 视频生成 |
| `/api/generate/tts` | `POST` | 语音合成 |
| `/api/characters` + `/api/characters/[id]` | CRUD | 角色管理 |
| `/api/characters/[id]/reference-assets` | `POST` / `DELETE` | 参考图资产 |
| `/api/ai-configs` + `/api/ai-configs/[id]` | CRUD | 用户 AI 配置（API Key AES-256 加密） |
| `/api/ai-configs/[id]/test` | `POST` | 测试配置连通性 |
| `/api/ai-providers` | `GET` | 系统预置 + 用户自定义提供商 |
| `/api/credits` + `/api/checkins` | `GET` / `POST` | 积分 / 签到 |
| `/api/orders` + `/api/payment/**` | 下单 / 回调 | 微信/支付宝/Stripe |
| `/api/upload` | `POST` | 文件直传 R2 |

> 完整清单以实际 `route.ts` 文件为准；本表为采样索引。

## 端点示范：`POST /api/generate/image`

关键流程（摘自 `generate/image/route.ts`）：

1. `auth()` → 取 `session.user.id`
2. `rateLimiters.imageGeneration(request, userId)` → 失败 429
3. 解析 body：`prompt / referenceImage / aspectRatio / style / projectId / sceneId / imageConfigId`
4. `contentSafetyMiddleware(prompt, "image")` → 不安全直接 400
5. 积分检查（普通 1 / 带参考图 3）
6. `prisma.scene.update({ imageStatus: "PROCESSING" })`
7. `prisma.generationTask.create({ type: "IMAGE_GENERATE" })`
8. 调用 `orchestrateImageGeneration(...)`（`services/generation`）
9. 成功：`uploadFileFromUrl` → R2；更新 `Scene.imageUrl` + `imageStatus: COMPLETED`；扣积分
10. 返回 `{ imageUrl, strategy, attemptCount }`

## 关键依赖

- `@/lib/auth` —— `auth()` 会话
- `@/lib/prisma` —— DB 访问
- `@/lib/ai-config` —— 解密用户 AI 配置
- `@/lib/rate-limit` —— 限流
- `@/lib/content-safety` —— 内容审核
- `@/lib/prompt-builder` —— Prompt 增强
- `@/services/ai` —— LLM/Image/Video/TTS
- `@/services/generation` —— 图像编排
- `@/services/storage` —— R2 上传
- `@/services/queue` —— 异步任务

## 测试与质量

- 无单测；依赖 `pnpm type-check` 确保类型严格。
- 建议：关键端点引入 `vitest` + `supertest`（未配置）。

## 扩展点 / 常见坑

- **Next.js 16 动态参数**：必须 `const { id } = await params;` —— 直接访问会 TypeScript 报错。
- **新增生成类端点**：务必同时加限流 + 内容安全 + 积分检查 + `GenerationTask` 记录（四件套）。
- **NextAuth 适配器**：用的是 `@auth/prisma-adapter`，Prisma 模型改动时关注 `Account`/`Session` 表字段。

## 相关文件清单

- `route.ts`（在本目录各子目录下）
- `app/src/lib/ai-config.ts`
- `app/src/lib/rate-limit.ts`
- `app/src/lib/content-safety.ts`

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师） |
