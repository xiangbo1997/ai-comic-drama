# v2 实施前冲突报告（Phase 0-1）

> 生成时间：2026-05-20
> 执行者：Claude Code（多 Agent 协作产出后）
> 任务：在动 v2 P0 改动前，确认 22 个未提交文件与 v2 设计是否冲突

## 1. 结论：**全部互补，无破坏性冲突**

22 个未提交改动正在做的事，恰好是 v2 设计的**上游脚手架**：

- 图像 provider 全部加了 `seed` 透传（replicate / fal / siliconflow / proxy-unified / openai-compatible）→ 与 v2 P0-3 (seed) 同向
- `openai-compatible.ts` 新增了 `/v1/images/edits` multipart 多参考图能力 + `FACE_ANCHOR_SUFFIX` 自动锚定 → 与 v2 P0-2 (referenceImages) 同向
- `queue.ts` + `queue-workers.ts` 把 `addVideoGenerationJob` 扩成接受 `prompt / aspectRatio / referenceImages` → **下游管道已经接通**
- `types/ai.ts` 已扩 `VideoGenerationOptions.referenceImages` 和 `aspectRatio`
- `provider-factory.ts` 注册了 `flow2api` 视频 provider
- `prompt-builder.ts` 加了 `referenceImageUrls` 多图字段
- `image-orchestrator.ts` 已加 FNV-1a hashStringToSeed
- `tts/route.ts` 加了 `characterId → Character.voiceId` 自动解析（**TTS 音色一致性的隐藏好事**）
- `video-synthesis.ts` 23 行只是加 absolutizeUrl + 错误处理，**没动 concat 部分**
- `(dashboard)/layout.tsx` server-side auth 重构，与一致性无关

## 2. 缺口（v2 必须补的事）

| 缺口 | 当前状态 | v2 任务 |
|------|----------|---------|
| `workflow-engine.ts::executeMediaGeneration` 直接调 `generateVideo` 时**没传** `referenceImages / prompt / aspectRatio / seed / identityPrompt` | 调用层断点 | **P0-2 / P0-3 / P0-4** |
| `flow2api-video.ts` 的 `referenceImages` 路由已实现，但缺 `seed` / `identityPrompt` 消费 | provider 内部补 | P0-3 / P0-4 |
| `video-synthesis.ts` 仍用 `concat -c copy` 硬拼 | 改 xfade | **P0-5** |
| 没有 `lastFrameImage` 字段（首末帧链） | 类型 + provider 路由 | Phase 1（不在 MVP-1） |
| `face-validator` 远景仍 passthrough | 改弱校验 | Phase 1（不在 MVP-1） |

## 3. 实施顺序（不冲突情况下的安全路径）

由于所有未提交改动都是"加新字段、加新分支"型的非破坏性增量，v2 P0 可以**与之并行**，不需要先 commit:

1. **不动** 22 个文件中**已 modify** 的部分（避免被误覆盖）
2. **只动 workflow-engine.ts**（不在 22 个未提交列表中）—— 调用层填字段
3. **flow2api-video.ts**（不在 22 个未提交列表中）—— 内部消费 seed / identityPrompt
4. **video-synthesis.ts**（在 22 个未提交列表中，但只动 concat 段）—— 与已有 23 行改动不冲突

## 4. 回滚锚点

实施前 commit hash：（在每个改动前用 `git stash` 或 `git diff > backup.patch` 备份）

各文件回滚命令：
```bash
ssh -p 54231 root@173.254.207.117 "cd /software/ai-comic-drama && git diff app/src/services/agents/workflow-engine.ts > /tmp/v2-workflow-engine.patch.bak"
# 类似的对每个改动文件做备份
```
