# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI漫剧工作台 (AI Comic Drama Workbench) — a full-stack Next.js application that converts novel/story text into comic-drama videos through a 7-step AI pipeline: text input → storyboard parsing → character setup → image generation → video generation → voice synthesis → export.

## Commands

All commands run from the `app/` directory:

```bash
pnpm dev              # Dev server (port 3000)
pnpm build            # Production build
pnpm lint             # ESLint check
pnpm lint:fix         # ESLint auto-fix
pnpm format           # Prettier write
pnpm format:check     # Prettier check
pnpm type-check       # TypeScript type check (tsc --noEmit)
pnpm db:generate      # Generate Prisma Client
pnpm db:seed          # Seed database
pnpm test             # Vitest 单元测试
pnpm ci               # Full CI: type-check + lint + format:check + test + build
```

测试框架：Vitest（`tests/` 目录，node 环境，纯函数为主）。CI 已运行 `pnpm test`。

## Tech Stack

- **Framework**: Next.js 16 (App Router), TypeScript 5, Node.js 20, pnpm 8
- **UI**: Tailwind CSS v4 + Radix UI + shadcn/ui, lucide-react icons
- **State**: TanStack React Query v5 (server) + Zustand v5 (client)
- **Auth**: NextAuth.js v5 (beta)
- **DB**: PostgreSQL via Prisma v7 (with `@prisma/adapter-pg`)
- **Queue**: BullMQ (Redis, prod) / InMemoryQueue (dev/serverless)
- **Storage**: Cloudflare R2 (S3-compatible)
- **AI providers**: DeepSeek, OpenAI, Claude, Gemini, Grok (LLM); Replicate, Fal.ai, SiliconFlow (image); Runway (video); Volcengine, ElevenLabs (TTS)

## Architecture

### Route Groups

- `(auth)/` — login page
- `(dashboard)/` — protected routes: `projects/`, `characters/`, `editor/[id]/`, `credits/`, `settings/ai-models/`
- `api/` — all backend API routes

### Core Services (`app/src/services/`)

| Service | Role |
|---------|------|
| `ai/` (dir) | Unified AI facade (`ai/index.ts`): `chatCompletion()`, `generateImage()`, `generateVideo()`, `synthesizeSpeech()`. Multi-protocol dispatch via `ai/provider-factory.ts` + `ai/providers/*` (OpenAI-compat, Claude, Gemini, Fal.ai, Replicate, etc.). 注：原单文件 `ai.ts` 已重构为目录 |
| `script.ts` / `drama-script.ts` | LLM-based script parsing (text → storyboard JSON) and image prompt generation |
| `agents/` (dir) | Plan-and-Execute Workflow 引擎（`workflow-engine.ts` 等，7 步管线 + 一致性闭环） |
| `queue.ts` / `queue-workers.ts` | Dual-mode job queue (InMemory/BullMQ) + 各类任务处理器 |
| `storage.ts` | Cloudflare R2 / 本地盘降级 upload/download/delete |
| `payment.ts` | WeChat Pay, Alipay, Stripe integration |
| `video-synthesis.ts` | Final video assembly (FFmpeg) |

### Key Lib (`app/src/lib/`)

| File | Role |
|------|------|
| `ai-config.ts` | Fetches user's active AI provider config from DB, decrypts API key. Functions: `getUserLLMConfig()`, `getUserImageConfig()`, `getUserVideoConfig()`, `getUserTTSConfig()` |
| `encryption.ts` | AES-256 encrypt/decrypt for user API keys |
| `prisma.ts` | Prisma Client singleton |
| `auth.ts` | NextAuth configuration |

### State Management

- 服务端状态：TanStack React Query（`use-editor-project.ts` / `use-generation-actions.ts` / `use-workflow.ts` 等 hooks，集中在 `editor/[id]/hooks/`）。
- 客户端 UI 状态：组件内 `useState` + 自定义 hooks。
- 注：早期文档曾提及 `src/stores/`（Zustand），该目录现已不存在；状态统一走 React Query + hooks。

### AI Model System

Users configure their own API keys per category (LLM/Image/Video/TTS), stored AES-256 encrypted in DB. The `AIProvider` model defines available providers with protocol type and config schema. `UserAIConfig` stores per-user encrypted credentials with category-level defaults.

### Database (Prisma/PostgreSQL)

Key models: `User`, `Project`, `Scene`, `Character`, `ProjectCharacter`, `SceneCharacter`, `GenerationTask`, `AIProvider`, `UserAIConfig`, `UserGenerationPreference`, `Order`, `Subscription`.

Schema at `app/prisma/schema.prisma`.

### Data Flow

```
Browser → Next.js App Router → API Routes
  → Services (ai/, script.ts, queue.ts, storage.ts, agents/)
    → lib/ai-config.ts (decrypt user AI configs)
    → lib/credits.ts (统一积分扣减/发放/退款入口)
    → Prisma ORM → PostgreSQL
    → Job Queue (InMemory | BullMQ/Redis)
    → External AI APIs
    → Cloudflare R2 / 本地盘降级
```

## Key Patterns

- **Dual queue mode**: `InMemoryQueue` for dev/serverless, `BullMQ` for production with Redis. Controlled by `REDIS_URL` env presence.
- **Multi-protocol AI dispatch**: `ai/index.ts` + `ai/provider-factory.ts` route calls based on provider protocol field (`openai`, `claude`, `gemini`, `grok`, `replicate`, `fal`, `siliconflow`, `proxy-unified`).
- **积分扣减收口**：所有扣费/发放/退款必须经 `lib/credits.ts`（`chargeCredits` / `grantCredits` / `refundCredits`），保证事务 + 流水 + 余额校验 + 幂等。禁止裸 `prisma.user.update({ credits })`。
- **出站 fetch SSRF 防护**：服务端 fetch 用户可影响的 URL 前须 `lib/url-guard.ts` 的 `assertSafeUrl()`。
- **shadcn/ui components**: located in `app/src/components/ui/`, added via shadcn CLI.
- **Editor page** (`editor/[id]/page.tsx`): the most complex page (~780 lines), orchestrates the full storyboard editing workflow; 逻辑下沉到 `components/` 与 `hooks/`。

## Environment Setup

从 `app/` 目录执行（首次启动完整步骤）：

```bash
pnpm install                       # 安装依赖
cp .env.example .env.local         # 配置环境变量（见下）
npx prisma db push                 # 同步 schema 到数据库（否则报"表不存在"）
pnpm db:generate                   # 生成 Prisma Client
pnpm db:seed                       # 灌入种子数据（AIProvider 等）
pnpm dev                           # 启动开发服务器
```

`.env.local` 必填最小集：`DATABASE_URL`、`NEXTAUTH_SECRET`、`ENCRYPTION_KEY`（64-char hex），以及至少一个 AI provider key（如 `DEEPSEEK_API_KEY`）。

隐式降级行为（无需额外配置即可本地跑通）：
- 不配 `REDIS_URL` → 队列走 InMemory（进程重启即丢）、限流走内存（多实例不同步）。
- 不配 R2（`R2_ENDPOINT` 等）→ 文件落本地盘 `public/uploads`（见 `LOCAL_STORAGE_*`）。
- 不配 Langfuse → 可观测性变 no-op，不影响功能。

⚠️ 变量名须与代码一致（见 `.env.example` 注释）：Volcengine 用 `VOLC_*`、微信支付用 `WECHAT_APP_ID`/`WECHAT_MCH_ID` 等、R2 用 `R2_ENDPOINT`。名字不符会导致对应能力静默失效。

## CI

GitHub Actions (`.github/workflows/ci.yml`): two jobs on push/PR to `main`/`develop`:
1. lint-and-type-check: `type-check` → `lint` → `format:check` → `test`
2. build (depends on 1): `db:generate` → `build`
