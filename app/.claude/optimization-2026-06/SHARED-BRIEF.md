# AI 漫剧工作台 — 全面优化分析 共享 Brief

## 目标

做成**行业标杆**级 AI 漫剧(小说→漫剧视频)工作台。从 用户体验/性能/架构/功能 四维全面优化。

## 技术栈

Next.js 16(App Router, Turbopack) / TS5 / React Query v5 + Zustand v5 / NextAuth v5 / Prisma v7 + PostgreSQL / BullMQ(prod)+InMemoryQueue(dev) / Cloudflare R2(线上未配，降级本地盘 public/uploads) / 多 AI provider(LLM:DeepSeek/OpenAI/Claude/Gemini/Grok; 图:Replicate/Fal/SiliconFlow; 视频:Runway; TTS:Volcengine/ElevenLabs)

## 代码规模

223 个 ts/tsx，41768 行。最大文件：

- ai-models/configs/[id]/test/route.ts (1356) / ai-models/test/route.ts (1115)
- services/video-synthesis.ts (995) — ffmpeg spawn 合成，配乐接入点
- services/agents/workflow-engine.ts (901) — 编排
- editor/[id]/components/SceneList.tsx (824) / editor/[id]/page.tsx (699)
- services/queue.ts (697) / payment.ts (623)

## 关键架构

- services/ai/: provider-factory + sdk + types（多协议门面 chatCompletion/generateImage/generateVideo/synthesizeSpeech）
- services/generation/: image-orchestrator + face-validator + strategy-resolver
- services/agents/: workflow-engine + character-bible-agent 等（21 个文件）
- storage.ts: uploadFile() 统一门面(R2/本地自动切)——产物落盘必须走它
- schema: 38+ model（User/Project/Scene/Character/GenerationTask/AIProvider/UserAIConfig/Order/Subscription/WorkflowRun...）

## 已知缺陷背景(来自历史)

- 编辑页 /editor/[id] 曾锁定 6 个 P0(假拖拽/批量配置未透传/workflow不刷新/FAILED无UI/导出拦截/三色失控)，部分已修
- 导出曾"进度走完无反应"(R2未配videoUrl丢失)，已修(commit 21bce68，走 uploadFile)
- 视频生成是**同步**的(无异步轮询退款)
- 配乐(BGM)功能：当前完全没有。video-synthesis.ts L842-847 用 amix 混配音，BGM 需作为额外输入 + volume duck

## 部署/运维约束

- 远端直改 root@173.254.207.117:/software/ai-comic-drama(systemd ai-comic-drama.service, 端口3100)
- build 用 NODE_OPTIONS=--max-old-space-size=1024，Turbopack ~44s

## 产出要求

每个 agent 输出到 .claude/optimization-2026-06/agents/<your-name>.md：

1. 现状诊断(引用 file:line 证据，禁止臆测)
2. 问题分级(P0阻断/P1严重/P2改进)，每条带影响面
3. 具体优化方案(可落地，给关键代码/字段/SQL)
4. 行业标杆对标(对比 CapCut/Runway/剪映/Pika 等的同类能力差距)
5. 实施优先级与工作量估算(S/M/L)
