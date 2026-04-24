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
pnpm ci               # Full CI: type-check + lint + format:check + build
```

No test framework is configured yet.

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
| `ai.ts` | Unified AI facade: `chatCompletion()`, `generateImage()`, `generateVideo()`, `synthesizeSpeech()`. Handles multi-protocol dispatch (OpenAI-compat, Claude, Gemini, Fal.ai, Replicate, etc.) |
| `script.ts` | LLM-based script parsing (text → storyboard JSON) and image prompt generation |
| `queue.ts` | Dual-mode job queue with `generationQueue` and `exportQueue` |
| `storage.ts` | Cloudflare R2 upload/download |
| `payment.ts` | WeChat Pay, Alipay, Stripe integration |
| `video-synthesis.ts` | Final video assembly |

### Key Lib (`app/src/lib/`)

| File | Role |
|------|------|
| `ai-config.ts` | Fetches user's active AI provider config from DB, decrypts API key. Functions: `getUserLLMConfig()`, `getUserImageConfig()`, `getUserVideoConfig()`, `getUserTTSConfig()` |
| `encryption.ts` | AES-256 encrypt/decrypt for user API keys |
| `prisma.ts` | Prisma Client singleton |
| `auth.ts` | NextAuth configuration |

### State Management (`app/src/stores/`)

- `project.ts` — `useProjectStore` (Zustand): holds project, scenes, characters, selectedSceneId. All updates are immutable.
- `user.ts` — user-related state

### AI Model System

Users configure their own API keys per category (LLM/Image/Video/TTS), stored AES-256 encrypted in DB. The `AIProvider` model defines available providers with protocol type and config schema. `UserAIConfig` stores per-user encrypted credentials with category-level defaults.

### Database (Prisma/PostgreSQL)

Key models: `User`, `Project`, `Scene`, `Character`, `ProjectCharacter`, `SceneCharacter`, `GenerationTask`, `AIProvider`, `UserAIConfig`, `UserGenerationPreference`, `Order`, `Subscription`.

Schema at `app/prisma/schema.prisma`.

### Data Flow

```
Browser → Next.js App Router → API Routes
  → Services (ai.ts, script.ts, queue.ts, storage.ts)
    → lib/ai-config.ts (decrypt user AI configs)
    → Prisma ORM → PostgreSQL
    → Job Queue (InMemory | BullMQ/Redis)
    → External AI APIs
    → Cloudflare R2
```

## Key Patterns

- **Dual queue mode**: `InMemoryQueue` for dev/serverless, `BullMQ` for production with Redis. Controlled by `REDIS_URL` env presence.
- **Multi-protocol AI dispatch**: `ai.ts` routes calls based on provider protocol field (`openai`, `claude`, `gemini`, `grok`, `replicate`, `fal`, `siliconflow`, `proxy-unified`).
- **shadcn/ui components**: located in `app/src/components/ui/`, added via shadcn CLI.
- **Editor page** (`editor/[id]/page.tsx`): the largest and most complex page (~1500+ lines), orchestrates the full storyboard editing workflow.

## Environment Setup

Copy `.env.example` to `.env.local`. Required minimum: `DATABASE_URL`, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` (64-char hex), and at least one AI provider key (e.g., `DEEPSEEK_API_KEY`).

## CI

GitHub Actions (`.github/workflows/ci.yml`): two jobs on push/PR to `main`/`develop`:
1. lint-and-type-check: `type-check` → `lint` → `format:check`
2. build (depends on 1): `db:generate` → `build`
