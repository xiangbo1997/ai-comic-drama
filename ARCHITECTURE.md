<!--
由 /ccg:init 生成（自适应架构师）
生成时间：2026-04-23 17:34:08 +08:00
执行者：Claude Code
说明：本文件是对根 CLAUDE.md 与 app/CLAUDE.md 的架构视图补充，
     聚焦「模块导航 + Mermaid 数据流图」，不覆盖既有手写内容。
-->

# 架构总览与模块导航

> 本文档为**只读导航层**，用于在根 CLAUDE.md 之外提供一个全局可点击的模块索引与数据流示意。
> 所有模块的详细职责请打开下方链接对应的模块级 `CLAUDE.md`。

## 项目一句话定位

**AI 漫剧工作台（AI Comic Drama Workbench）** —— 以 Next.js 16 + React 19 为核心的全栈应用，通过 7 步 AI 流水线将小说/故事文本转换为漫剧视频：
**文本输入 → 分镜解析 → 角色设置 → 图像生成 → 视频生成 → 语音合成 → 导出合成**。

## 模块结构图（可点击导航）

```mermaid
graph TD
    ROOT["根目录<br/>ai-comic-drama"] --> APP["app<br/>主应用 (Next.js)"]
    ROOT --> DOCS["docs<br/>设计/需求文档"]
    ROOT --> OSPEC["openspec<br/>规格草案"]
    ROOT --> POC["poc<br/>概念验证"]

    APP --> APP_SRC["app/src"]
    APP --> PRISMA["prisma<br/>Schema + Seed"]

    APP_SRC --> APP_APP["app/<br/>App Router"]
    APP_SRC --> SERVICES["services<br/>服务层"]
    APP_SRC --> LIB["lib<br/>基础设施"]
    APP_SRC --> STORES["stores<br/>Zustand 状态"]
    APP_SRC --> COMPONENTS["components<br/>UI 组件"]

    APP_APP --> APP_API["api<br/>REST API"]
    APP_APP --> APP_DASH["(dashboard)<br/>受保护页面"]
    APP_DASH --> APP_EDITOR["editor/[id]<br/>核心编辑器"]

    SERVICES --> SVC_AI["ai<br/>多协议 AI 门面"]
    SERVICES --> SVC_AGENTS["agents<br/>Workflow 引擎"]
    SERVICES --> SVC_GEN["generation<br/>图像编排器"]
    SERVICES --> SVC_QUEUE["queue.ts<br/>双模队列"]
    SERVICES --> SVC_STORE["storage.ts<br/>R2/S3"]
    SERVICES --> SVC_SCRIPT["script.ts<br/>剧本解析"]
    SERVICES --> SVC_PAY["payment.ts<br/>微信/支付宝/Stripe"]
    SERVICES --> SVC_VIDEO["video-synthesis.ts<br/>FFmpeg 合成"]

    click APP "./app/CLAUDE.md" "主应用项目规范"
    click APP_APP "./app/src/app/CLAUDE.md" "App Router 模块文档"
    click APP_API "./app/src/app/api/CLAUDE.md" "API 路由文档"
    click APP_EDITOR "./app/src/app/(dashboard)/editor/[id]/CLAUDE.md" "编辑器模块文档"
    click SERVICES "./app/src/services/CLAUDE.md" "服务层总览"
    click SVC_AI "./app/src/services/ai/CLAUDE.md" "AI 服务模块"
    click SVC_AGENTS "./app/src/services/agents/CLAUDE.md" "Agent 管线模块"
    click SVC_GEN "./app/src/services/generation/CLAUDE.md" "图像编排模块"
    click LIB "./app/src/lib/CLAUDE.md" "lib 基础设施"
    click STORES "./app/src/stores/CLAUDE.md" "Zustand 状态"
    click COMPONENTS "./app/src/components/CLAUDE.md" "UI 组件"
    click PRISMA "./app/prisma/CLAUDE.md" "数据模型"
```

## 端到端数据流（Mermaid）

```mermaid
sequenceDiagram
    autonumber
    participant B as 浏览器 (React 19)
    participant R as Next.js App Router
    participant A as API 路由 (app/api/**)
    participant L as lib/ai-config
    participant DB as PostgreSQL (Prisma)
    participant Q as Queue (BullMQ/InMemory)
    participant S as services/ai (多协议)
    participant X as 外部 AI (OpenAI/Claude/Replicate/Fal/Runway/Volcengine)
    participant R2 as Cloudflare R2

    B->>R: 用户操作（登录态 NextAuth）
    R->>A: 派发到 /api/* 路由
    A->>L: getUserLLMConfig / getUserImageConfig …
    L->>DB: 查询 UserAIConfig（AES-256 解密 API Key）
    DB-->>L: 配置 + 解密后的 Key
    L-->>A: AIServiceConfig
    A->>Q: 入队（可选：长任务异步化）
    Q->>S: 任务分发到 services/ai
    S->>X: protocol 路由（openai / claude / gemini / fal / replicate / runway / volcengine）
    X-->>S: 生成结果（URL / Buffer）
    S->>R2: 上传图像/视频/音频资产
    R2-->>S: 公开 URL
    S-->>A: 结果返回
    A->>DB: 更新 Scene / GenerationTask / WorkflowStepRun
    A-->>B: JSON 响应（含进度/资产 URL）
```

## 模块索引（一句话职责）

| 模块路径 | 一句话职责 | 模块文档 |
|----------|-----------|---------|
| `app/` | Next.js 16 主应用根（pnpm 工程入口） | [app/CLAUDE.md](./app/CLAUDE.md) |
| `app/src/app/` | App Router：页面 + API 路由 | [app/src/app/CLAUDE.md](./app/src/app/CLAUDE.md) |
| `app/src/app/api/` | 所有 REST 端点（projects / generate / auth / ai-configs / payment / workflow / export …） | [app/src/app/api/CLAUDE.md](./app/src/app/api/CLAUDE.md) |
| `app/src/app/(dashboard)/editor/[id]/` | 7 步流水线的核心编辑器（拆分后 ≈431 行编排 + 子组件与 hooks） | [app/src/app/(dashboard)/editor/[id]/CLAUDE.md](./app/src/app/(dashboard)/editor/[id]/CLAUDE.md) |
| `app/src/services/` | 业务服务层总索引 | [app/src/services/CLAUDE.md](./app/src/services/CLAUDE.md) |
| `app/src/services/ai/` | 统一 AI 门面：LLM / Image / Video / TTS 多协议分发 | [app/src/services/ai/CLAUDE.md](./app/src/services/ai/CLAUDE.md) |
| `app/src/services/agents/` | Hybrid Plan-and-Execute Workflow 引擎（7 步 Agent 管线） | [app/src/services/agents/CLAUDE.md](./app/src/services/agents/CLAUDE.md) |
| `app/src/services/generation/` | 图像生成编排器（策略选择 + 人脸一致性校验 + 重试） | [app/src/services/generation/CLAUDE.md](./app/src/services/generation/CLAUDE.md) |
| `app/src/lib/` | 基础设施：Auth / Encryption / Prisma / Logger / RateLimit / ContentSafety / Prompt | [app/src/lib/CLAUDE.md](./app/src/lib/CLAUDE.md) |
| `app/src/stores/` | Zustand 客户端状态（project / user） | [app/src/stores/CLAUDE.md](./app/src/stores/CLAUDE.md) |
| `app/src/components/` | React 组件 + shadcn/ui 原子组件 | [app/src/components/CLAUDE.md](./app/src/components/CLAUDE.md) |
| `app/prisma/` | Prisma Schema（19 个模型）+ 种子脚本 | [app/prisma/CLAUDE.md](./app/prisma/CLAUDE.md) |

## 变更记录 (Changelog)

| 日期 | 执行者 | 说明 |
|------|-------|------|
| 2026-04-23 | Claude Code (/ccg:init) | 首次生成架构总览 + 模块导航 + 12 份模块级 CLAUDE.md |
