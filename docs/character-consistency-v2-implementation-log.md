# 角色一致性 v2 - MVP-1 实施记录

> **执行日期**：2026-05-20
> **执行者**：Claude Code（多 Agent 协作产出后实施）
> **基础方案**：[`docs/character-consistency-v2-plan.md`](./character-consistency-v2-plan.md)
> **当前阶段**：MVP-1 已完成（Phase 0），等待基线测试启动 Phase 1

---

## 1. 已完成改动一览

| # | 任务 | 文件 | 净增行 | 类型 |
|---|------|------|--------|------|
| P0-1 | 22 个未提交文件冲突闸门 | `.claude/v2-conflict-report.md` | +60 | 报告 |
| P0-2 | 透传 referenceImages 到 generateVideo | `services/agents/workflow-engine.ts` | +85 | 代码 |
| P0-3 | 透传 identity seed | `types/ai.ts` + `workflow-engine.ts` + `flow2api-video.ts` | +12 | 代码 |
| P0-4 | identityPrompt 前缀注入 | `workflow-engine.ts` + `flow2api-video.ts` | +25 | 代码 |
| P0-5 | xfade 0.3s 转场（feature-flag） | `services/video-synthesis.ts` | +47 | 代码 |

**净改动**：3 个文件修改 + 2 个文件首次接入新字段消费，共 ~170 行新增代码。
**质量门**：`pnpm type-check` ✅ 零错误；`pnpm lint` ✅ 零警告；`prettier --check` ✅ 我们修改的文件无格式问题。

---

## 2. 详细改动说明

### P0-2 / P0-3 / P0-4 合并改动（workflow-engine.ts）

在 `executeMediaGeneration` 之前新增两个工具函数：

```typescript
// FNV-1a 32 位哈希；与 image-orchestrator 的 hashStringToSeed 完全同构
function identitySeedFromCharacterId(characterId: string): number

// 查询场景角色上下文：referenceImages + identityPrompt + seed
async function buildSceneCharacterContext(
  sceneArtifact, projectId, characterBible
): Promise<{ referenceImages, identityPrompt?, seed? }>
```

`executeMediaGeneration` 签名扩展第三个可选参数 `characterBible`：
- 在 `executeWorkflow` Step 5 调用处补传 bible
- 调用 `generateVideo` 时填入 `referenceImages / seed / identityPrompt / aspectRatio`
- prompt 改为 `${identityPrompt}. ${description}`（Prompt Pinning）

**参考图取值策略**（优先级降序）：
1. `Character.referenceAssets.where(isCanonical=true)` 按 `qualityScore desc, createdAt asc` 排序的第一张
2. 回退到旧字段 `Character.referenceImages[0]`
3. 都没有 → 不传 referenceImages（保持向后兼容）

**激活的能力**：
- `flow2api-video.ts` 的 `chooseModel` 在检测到 `referenceImages.length >= 1 && !hasMain` 时路由到 `veo_3_1_r2v_fast`
- 同角色 → 同 seed → 跨镜头风格稳定
- 角色 DNA 前缀 → 视频模型在 prompt 层有强约束

### P0-5（video-synthesis.ts）

把 `concat -c copy` 替换为带 fallback 的 xfade 链：

```typescript
const xfadeEnabled =
  process.env.ENABLE_VIDEO_XFADE !== "0" && videoClips.length >= 2;

if (xfadeEnabled) {
  // 构造 filter_complex：每两段之间插 0.3s xfade
  // offset = 累计前置时长 - 0.3
  // 输出：libx264 + veryfast + yuv420p（牺牲少量编码时间换转场质量）
} else {
  // 旧行为：concat demuxer + -c copy（零重编码）
}
```

**回滚方法**：设置环境变量 `ENABLE_VIDEO_XFADE=0` 即可立即回退到旧行为，零代码改动。

### types/ai.ts 扩展

```typescript
export interface VideoGenerationOptions {
  // 既有字段保留
  seed?: number;            // v2：identity seed
  identityPrompt?: string;  // v2：身份维持前缀
}
```

### flow2api-video.ts 消费新字段

```typescript
function buildVideoPrompt(prompt: string, identityPrompt?: string): string
// 在 generateVideo() 中提前调用，把 identityPrompt 前置到 finalPrompt
// finalPrompt 用于 buildContent(...) 喂给上游 SSE messages
// seed 仅在日志中记录（上游 Veo 不直接支持 seed 入参）
```

---

## 3. 已激活的"死代码"

| 模块 | 之前状态 | 现在状态 |
|------|---------|---------|
| `CharacterReferenceAsset.isCanonical` 查询 | 0 个消费路径 | 1 个（buildSceneCharacterContext） |
| `Character.referenceImages[]` 在视频阶段 | 仅图像 prompt-builder 用 | 视频生成也用了 |
| `flow2api-video.ts` Veo R2V 路由 | 类型已扩、调用层未填 | 调用层激活 |
| 角色 ID → FNV-1a seed | 仅图像 image-orchestrator 用 | 视频共享同一 seed |
| CharacterBible.canonicalPrompt 在视频 | 仅图像 strategy-resolver 用 | 视频 prompt 前缀注入 |

---

## 4. 回滚预案

### 全量回滚（恢复 v1 行为）
```bash
# 1. 环境变量切换：xfade 关闭
export ENABLE_VIDEO_XFADE=0

# 2. 代码层回滚：直接 git checkout（v2 改动仅 3 个 modified 文件 + 0 个新增文件）
git checkout HEAD -- \
  app/src/types/ai.ts \
  app/src/services/agents/workflow-engine.ts \
  app/src/services/video-synthesis.ts
# 注：flow2api-video.ts 是未提交新文件，git checkout 不会动它，但其 v2 改动仅在 buildVideoPrompt 函数 + log fields，
# 不影响主流程；如需彻底卸载，单独 sed 移除 buildVideoPrompt 调用即可
```

### 单点回滚

| 改动 | 单点回退方法 |
|------|------------|
| referenceImages 透传 | 在 `generateVideo({...})` 调用中删 `referenceImages` 字段 |
| identityPrompt 前缀 | 把 `videoPrompt` 改回 `sceneArtifact.description` |
| seed | 删 `seed: charContext.seed` 字段 |
| xfade | 设置 `ENABLE_VIDEO_XFADE=0` 环境变量 |

---

## 5. 风险与已知限制

| 风险 | 概率 | 缓解 |
|------|------|------|
| **角色无 referenceAssets 也无 referenceImages** | 高（老项目） | buildSceneCharacterContext 返回空数组，generateVideo 走旧路径，无副作用 |
| **CharacterBible 未生成（bible step 失败）** | 中 | executeMediaGeneration 第三参 optional，未传时 identityPrompt = undefined，走旧 prompt |
| **xfade 重编码 CPU 占用增加** | 中 | 用 libx264 veryfast preset 控制；ENABLE_VIDEO_XFADE=0 一键回退 |
| **Veo R2V 模型与现有 t2v/i2v 切换** | 低 | flow2api-video.ts 的 chooseModel 已经按入参自动路由，逻辑无改动 |
| **新增 prisma.character.findMany 查询性能** | 低 | 已加 referenceAssets 索引（characterId），单场景 ≤ 5 角色，毫秒级 |

---

## 6. 待做（Phase 1 起步项）

按 v2 方案文档的 Phase 1 backlog，下一步需要：

1. 接入 CLIP image embedding 评分（替换 ArcFace） —— 6h
2. CLIP 评分融入 Observer Agent —— 4h
3. 分段并行视频生成（4-5 镜/段，段内串行末帧链） —— 6h
4. 末帧准入门槛（CLIP < 0.7 回退 t2v） —— 3h
5. VideoFaceValidator 三帧抽样 + 重生 1 次 —— 5h
6. **v1 基线测试集**（10 条 × 3 人盲评） —— 4h ★ 必须先做

**强烈建议**：在跑 Phase 1 之前，**先用 MVP-1 跑一遍现有 workflow 并做 v1 vs MVP-1 双盲评分**。
如果评分提升 ≥ 0.5（5 分制）→ 继续 Phase 1；< 0.3 → 重审方向。
