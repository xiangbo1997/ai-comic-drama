# 角色一致性 v2 改造方案

> **作者**：多 Agent 协作产出（Agent A 诊断 / Agent B 业界调研 / Agent C 架构 / Agent D 红队评审）
> **整合**：Claude Code（主 agent）
> **日期**：2026-05-20
> **状态**：方案稿，**待用户决策**后方可进入实施
> **前置阅读**：`docs/character-consistency-research.md`（v1 调研）、`docs/tech-selection.md`（技术选型）

---

## 0. 执行摘要（TL;DR）

**当前状态一句话**：项目是"**图像首帧高度一致、视频内与镜头切换处一致性裸奔**"——CharacterBible/strategy-resolver/face-validator 把单帧做到了 7-8 分，但视频阶段把已有的一致性资本全部丢失，且 Prisma 里为多模态身份准备的 `CharacterReferenceAsset` / `CharacterFaceEmbedding` 表是**死代码**（90% 没消费路径）。

**核心三个动作**（按红队评审压缩后的优先级）：

1. **激活已有死代码**：把 `referenceImages` / `seed` / `identityPrompt` 透传到 `generateVideo` 调用（workflow-engine.ts 现有 ~6 行调用代码不到位）。Flow2API Veo 3.1 的 R2V（多参考图）和 i2v_s_fast_fl（首末帧）能力**已经接入项目**但未被调用。
2. **建立跨镜头连续性**：视频生成由 "全 fan-out" 改为 **"分段并行 + 段内串行末帧链"**（4-5 镜/段），同时 `concat -c copy` 改 `xfade 0.3s`。
3. **建立人眼基线 + 客观指标**：先用 3 人盲评建立 v1 基线，再用 **CLIP image embedding**（**不是 ArcFace**——动漫风格不适配）做客观一致性评分。

**强烈建议先走 MVP-1（~20h，2 天）拿到基线数据再决定是否启动完整 v2**。LoRA 训练在 PoC 验收前不进入主线。

**预期收益**：
- MVP-1 完成后：用户主观评分 +0.5（5 分制）以上
- 完整 Phase 1 完成后：视频内/跨镜一致性主观分 ≥ 4/5
- 总工时：**MVP-1 (20h) → Phase 1 (28h) → Phase 2 可选 (24h)** = 完整路径 52-72h，但**每个 Phase 之间都有决策点**，不需要一次性承诺。

---

## 1. 现状诊断（Agent A 主笔）

### 1.1 项目目前在哪个分数段
- **静帧首帧**：7-8 分 ✅
- **视频内（5s 内的帧间）**：5-6 分 ⚠️
- **跨镜头切换**：3-4 分 ❌
- **综合成片观感**：5-6 分 ❌

### 1.2 三大 P0 瓶颈

| # | 现象 | 根因（文件:行号） | 已实现但未生效 |
|---|------|------------------|----------------|
| P0-1 | 角色进入第 2 镜后 1-2s 起五官/发色/服饰开始漂移 | `workflow-engine.ts:454-460` `generateVideo` 只接收 `imageUrl + description + duration`，canonicalPrompt/referenceImages/seed 全丢 | `types/ai.ts` 已扩 `referenceImages` 字段；`flow2api-video.ts` 已接 R2V 模型；**调用层没填字段** |
| P0-2 | 镜头切换处肉眼可见"人物再生"感（每 5-10s 一次） | `video-synthesis.ts:271` `concat -c copy` 硬拼；`executeMediaGeneration` 用 `Promise.allSettled` 结构性排斥串行依赖 | `flow2api-video.ts` 已支持 Veo 3.1 `i2v_s_fast_fl`（首末帧→中间视频），从未被调用 |
| P0-3 | 多模态身份系统是空壳 | `prisma/schema.prisma` 有 `CharacterReferenceAsset.pose/isCanonical` 和 `CharacterFaceEmbedding.embedding[]`，**写入端只有 1 处 API、消费端零** | 表已建、迁移已落、文档已写，**generation/agents 目录从未读过它们** |

### 1.3 两个 P1 瓶颈

- **P1-4**：face-validator 仅在 image-orchestrator 同步路径内验单帧；视频 5s × 24fps = 120-150 帧**没一帧被校验**。
- **P1-5**：face-validator 对远景/全景直接 passthrough（合理设计），但视频模型可能在 5s 内做推镜把远景脸放大 3-5 倍，**首帧合格 ≠ 末帧合格**。

### 1.4 死代码清单（"看似已实现但实际未生效"）

| 项 | Schema | 写入路径 | 消费路径 | 状态 |
|----|--------|----------|----------|------|
| `CharacterReferenceAsset.pose / qualityScore / isCanonical` | ✓ | 仅 `api/characters/[id]/generate-reference` | **零** | 死字段 |
| `CharacterFaceEmbedding`（512-d 向量） | ✓ | **零（连写入都没）** | **零** | 完全空壳 |
| `Character.referenceAssets[]` 关联 | ✓ | 1 个 API | 未读 | 与旧 `referenceImages[]` 双轨，新轨悬空 |
| `Scene.selectedCharacterIds[]` 多角色 | ✓ | 待确认 | 视频阶段未用于组合身份 | 多角色场景退化为碰运气 |
| ArcFace 相似度检索（README 承诺） | doc 描述 | - | 无代码 | 文档承诺，代码未兑现 |

---

## 2. 业界方案借鉴（Agent B 调研）

**重要前置**：Agent B 因 web 检索权限受限，所有具体 model id / 单价标注**"待验证"**。结构性结论可靠。

### 2.1 项目已有的 v1 调研基线
团队已选用 Flux Kontext Pro + PuLID + InstantID + IP-Adapter FaceID 组合（详见 `docs/character-consistency-research.md`），这里只补充**新方案**。

### 2.2 图像新方案（v1 之外）

| 方案 | 定位 | API 通道（**slug 待验证**） | 何时用 |
|------|------|---------------------------|--------|
| Flux Kontext Max | 旗舰版，prompt 遵循度更高 | Replicate `black-forest-labs/flux-kontext-max`、Fal `fal-ai/flux-pro/kontext/max` | 高情绪关键帧 |
| Nano Banana（Gemini 2.5 Flash Image） | **多角色/多元素同帧融合** | Replicate `google/nano-banana`、Fal `fal-ai/nano-banana` | 群戏分镜 |
| Seedream 3.0（字节） | 中文场景 + 海报文字 | Volcengine `doubao-seedream-3-0-t2i` | 中文海报/字幕 |
| Ideogram Character 3.0 | 面孔锁定 + 文字稳 | Ideogram API + Fal/Replicate 镜像 | 关键封面 |

### 2.3 视频"首末帧 + 角色参考"双输入方案（漫剧关键）

| 模型 | 接 first frame | 接 character ref | 链式适合度 | 项目状态 |
|------|----------------|------------------|-----------|---------|
| **Veo 3.1 `i2v_s_fast_fl`** | ✅（first+last） | ⚠️ 通过 prompt | 高 | **flow2api 已接，未被调用** |
| **Veo 3.1 R2V** | n/a | ✅（最多 3 张） | 高 | **flow2api 已接，未被调用** |
| Kling 1.6 Elements | ✅ | ✅（最多 4 元素） | 最佳 | 需新接 |
| Runway Gen-4 References | ✅ | ✅（最多 3 ref） | 最佳 | 已有 Runway provider，需升 Gen-4 |
| Hailuo S2V-01 subject-reference | ✅ | ✅ | 好 | 需新接 |
| Pika 2.0 Scene Ingredients | ✅ | ✅ ingredients | 好 | 需新接 |

### 2.4 跨镜头连续性的工业级答案

按 Agent B 调研，业界打到 9 分一致性的标准三件套：
1. **角色 LoRA 训练**（Replicate `ostris/flux-dev-lora-trainer` 或 Fal `flux-lora-fast-training`，~$2/角色，~20 min）—— 但 Agent D 红队评审指出此方案**有训练样本循环依赖风险**，需先做 PoC 验收。
2. **Reference Pack + 首末帧链**（多张参考图固定喂入每个分镜的视频生成）。
3. **Prompt Pinning + Seed Locking**（每镜 prompt 前缀固定"角色 DNA 描述"+ 同角色固定 seed）。

---

## 3. v2 改造方案（Agent C 架构 + Agent D 红队修正）

### 3.1 设计原则
- **激活已有死代码 > 引入新依赖**：90% 的 P0 收益来自打通已有管道
- **分段并行 > 全 fan-out 或全串行**：4-5 镜/段，段内串行末帧链、段间并行
- **CLIP 一致性评分（非 ArcFace）**：动漫风格 ArcFace 不可靠，地基塌陷
- **人眼基线先行**：没有 v1 主观评分基线就不存在"提升"
- **LoRA 不进入主线**：先用 reference + seed 路线验证收益上限，再决定是否上 LoRA

### 3.2 红队评审强制修正的事项

> Agent C 原方案中以下决策被 Agent D 推翻或修正：

| Agent C 原方案 | Agent D 修正 | 原因 |
|---------------|--------------|------|
| `executeMediaGeneration` 全串行滑窗 | **改分段并行**（4-5 镜/段） | 全串行 = 体验自杀（25-40 min/workflow）；分段并行端到端 +30-50% 可接受 |
| KPI 基于 ArcFace 距离 | **改用 CLIP image embedding** | ArcFace 训练于 MS-Celeb-1M 真人脸，对**动漫面孔特征空间根本不对齐**；项目默认 style=anime |
| ArcFace 快路径作为 face-validator 新增层 | **CLIP 评分替换 Observer 的人脸维度评分** | 双层评分打架、仲裁空白；正确做法是融入现有 Reflection Loop |
| LoRA 训练在 P1（与 P0 并行） | **LoRA 整体降到 Phase 2**，加 PoC 验收门 | 训练样本来源循环依赖（用一致性不够的工具产 LoRA 训练样本）；失败 LoRA 比无 LoRA 更糟 |
| KPI #5 "端到端时长 +25%" | **改"+50%"**（并配套分段并行） | 与滑窗串行物理矛盾 |
| 缺失人眼盲评 KPI | **新增 KPI #7：3 人盲评 1-5 分 ≥ 4 才算通过** | 机器指标在动漫领域无法替代人眼 |
| 末帧直接当下一镜锚点 | **加末帧准入门槛**：末帧自身要先通过 CLIP 阈值，否则回退用角色定妆图做 t2v | 漂移的末帧锚定后续会**加速漂移** |
| 假设"先让 22 个未提交改动落盘" | **新增 Phase 0-5**：动 v2 前必须先读 `openai-compatible.ts` 306 行 diff | 此 diff 经主 agent 实测就是**多参考图 multipart 传递**——与 v2 P0-1 功能高度重叠，盲目 rebase 风险极高 |

### 3.3 四阶段闭环（修正后）

#### 阶段 1：角色资产建档（**降级为 Phase 2**）

> 红队评审后：LoRA 训练不进入主线，只保留多 pose 定妆图 + CLIP embedding 抽取。

#### 阶段 2：静帧生成升级

- `strategy-resolver` 在原有"reference_edit / face_id / prompt_only"之上**不引入新策略**（LoRA 推迟）
- `face-validator` 改造：
  - 中近景：**CLIP image embedding** 距离快路径（成本/延迟均比 LLM Vision 低一个量级），≥ 0.85 直接通过，0.75-0.85 再调 LLM Vision，< 0.75 重生
  - 远景/全景：原 passthrough **改弱校验**（用 LLM Vision 评色调一致性 + 服装颜色匹配，不再问"是不是同一个人"，问"是不是同一身打扮"）
- **CLIP 评分融入 Observer**：替换 Observer 内的人脸维度评分，而非新加一层（避免双层重试）

#### 阶段 3：视频生成串接（**核心修改**）

```
当前：scenes.map(s => Promise.all([genVideo(s), genAudio(s)])) → allSettled
v2：  分段（4-5 镜/段）
        段内串行：scenes.reduce((chain, s, i) => chain.then(async (prev) => {
          const lastFrame = i === 0 ? null : await extractLastFrame(prev.videoUrl)
          // 末帧准入门槛：CLIP < 阈值时回退
          const useT2V = lastFrame && await clipSimilarity(lastFrame, charCanonical) < 0.7
          const video = await genVideo({
            imageUrl: s.firstFrameUrl,
            lastFrameImage: useT2V ? null : lastFrame,   // 激活 flow2api i2v_s_fast_fl
            referenceImages: characterPack(s.selectedCharacterIds), // 激活 flow2api r2v
            seed: identitySeed,                           // 复用 FNV-1a
            identityPrompt: char.canonicalPrompt.slice(0, 200),  // Prompt Pinning
            prompt: s.description,
          })
          return { videoUrl: video.url, sceneId: s.id }
        }), Promise.resolve(null))
        段间并行：Promise.all(segments.map(runSegment))
        音频独立 fan-out：Promise.all(scenes.map(genAudio))
```

#### 阶段 4：镜头拼接与后验

- `video-synthesis.ts` 的 `concat -c copy` 改 `xfade=0.3s`（**注意：video-synthesis.ts 在未提交 23 行改动列表中，先合并再 rebase**）
- 每个视频生成完后：抽 1/3、2/3、末帧 3 帧 → CLIP 距离均值写 `Scene.videoValidationScore`，< 0.75 触发 1 次重生

### 3.4 Prisma schema diff（精简版）

```prisma
model Character {
  // 既有字段保留；以下新增字段只为 Phase 2 准备，Phase 1 不强依赖
  identitySeed       Int?      // FNV-1a(character.id) 固化，对应 image-orchestrator 已有逻辑
  // 以下字段标注 // Phase 2 only，Phase 1 阶段不创建
  loraUrl            String?   // Phase 2 only
  loraStatus         LoraTrainingStatus @default(PENDING) // Phase 2 only
  loraTrainedAt      DateTime? // Phase 2 only
  loraTrainingJobId  String?   // Phase 2 only
}

enum LoraTrainingStatus { PENDING TRAINING READY FAILED SKIPPED }  // Phase 2 only

model Scene {
  videoLastFrameUrl     String?  // 视频末帧 URL（供下一镜首末帧链）
  videoValidationScore  Float?   // 三帧 CLIP 距离均值
  videoRegenCount       Int      @default(0)
}

// 新表（Phase 2 可选，Phase 1 用 Scene.videoLastFrameUrl 即可）
model VideoGenerationLink {
  id                     String   @id @default(cuid())
  fromSceneId            String
  toSceneId              String
  firstFrameUrl          String
  crossSceneClipDelta    Float?   // CLIP（非 ArcFace）落差
  status                 String
  createdAt              DateTime @default(now())
  @@unique([fromSceneId, toSceneId])
}
```

### 3.5 TypeScript 接口 diff（精简版）

```typescript
// services/ai/types.ts —— 扩展 VideoGenerationOptions（types/ai.ts 中部分字段已在未提交改动中预备）
export interface VideoGenerationOptions {
  imageUrl?: string;
  prompt?: string;
  duration?: number;
  aspectRatio?: "1:1" | "9:16" | "16:9";   // 已在未提交改动中 ✓
  referenceImages?: string[];               // 已在未提交改动中 ✓（≤ 3，character pack）
  config?: AIServiceConfig;
  // === v2 新增（workflow-engine 调用层填充）===
  lastFrameImage?: string;                  // 前一镜末帧，激活 flow2api i2v_s_fast_fl
  seed?: number;                            // FNV-1a identity seed
  identityPrompt?: string;                  // canonicalPrompt 截断片段
}

// services/generation/character-pack-builder.ts (新文件)
export async function buildCharacterPack(
  characterIds: string[]
): Promise<CharacterPack> {
  // 查 referenceAssets 取 isCanonical=true，按 pose 排序：front > 3quarter > side
  // 返回最多 3 张参考图 + canonicalPrompt 截断
}

// services/generation/clip-scorer.ts (新文件，Phase 1)
export async function clipSimilarity(
  imageUrlA: string,
  imageUrlB: string,
  config?: AIServiceConfig
): Promise<number>;

// services/generation/last-frame-extractor.ts (新文件)
export async function extractLastFrame(videoUrl: string): Promise<string>;
```

---

## 4. 立刻可拿的"免费收益"（红队验证后，< 50 行）

| # | 改动 | 文件 | 行数 | 风险 | 收益 |
|---|------|------|------|------|------|
| 1 | 透传 `referenceImages` 到 `generateVideo` | `workflow-engine.ts:454-460` | ~15 行 | 低（**前置：先读完未提交 openai-compatible.ts diff 防止冲突**） | 激活 flow2api R2V，视频内身份立即提升 |
| 2 | 透传 `seed = FNV-1a(characterId)` | 同上 | ~3 行 | 低 | 同角色视频风格稳定 |
| 3 | 注入 `identityPrompt = canonicalPrompt.slice(0, 200)` 前缀 | 同上 | ~5 行 | 低 | Prompt Pinning，零成本 |
| 4 | `concat -c copy` 改 `xfade=0.3` | `video-synthesis.ts:271` | ~10 行 | **中（与未提交 23 行改动冲突，需手动 merge）** | 切换处跳变减弱 |
| 5 | face-validator 远景由 passthrough 改为色调/服装弱校验 | `face-validator.ts` | ~20 行 | 低 | 远景不再裸奔 |

**注**：Agent C 原方案把这 5 条标为 P0；Agent D 评审后第 4 条因 video-synthesis.ts 已有 23 行未提交改动，**降级为"需先合并"**。

---

## 5. 分阶段 Backlog（Agent D 修正后）

### Phase 0：基础阀门 + 免费收益（10h，零破坏）

| # | 任务 | 工时 | 风险 |
|---|------|------|------|
| 0-1 | **读完 openai-compatible.ts 306 行 diff 并产出冲突报告**（前置闸门） | 2h | 中（前置） |
| 0-2 | 透传 referenceImages 到 generateVideo | 2h | 低 |
| 0-3 | 透传 seed 到视频 provider | 1h | 低 |
| 0-4 | identityPrompt 前缀注入 | 2h | 低 |
| 0-5 | xfade 0.3s 替换 concat -c copy（**等 video-synthesis.ts 落盘后**） | 3h | 中 |

### Phase 1：核心一致性（28h，分段并行 + CLIP 评分）

| # | 任务 | 工时 | 风险 |
|---|------|------|------|
| 1-1 | 接入 CLIP image embedding 评分（**替换 ArcFace**） | 6h | 中 |
| 1-2 | CLIP 评分**替换** Observer 人脸维度（非新增层） | 4h | 中 |
| 1-3 | 分段并行视频生成（4-5 镜/段，段内串行末帧链） | 6h | 中 |
| 1-4 | 末帧准入门槛：CLIP < 0.7 时回退 t2v | 3h | 低 |
| 1-5 | VideoFaceValidator 三帧抽样 + 重生 1 次（用 CLIP） | 5h | 中 |
| 1-6 | 建立 v1 一致性基线测试集（10 条 × 3 人盲评） | 4h | 低 |

### Phase 2：可选增强（24h，按 Phase 1 结果决定是否做）

| # | 任务 | 工时 | 风险 |
|---|------|------|------|
| 2-1 | 远景/侧脸弱校验降权 | 3h | 低 |
| 2-2 | Prisma 加 videoLastFrameUrl / videoValidationScore | 3h | 低 |
| 2-3 | VideoGenerationLink 表（记录用，不做决策） | 4h | 低 |
| 2-4 | LoRA 训练 PoC（**单角色、手动验收**，不接 workflow） | 8h | 高 |
| 2-5 | LoRA 接入 strategy-resolver（需 2-4 验收通过） | 6h | 高 |

**总计 62h，但每个 Phase 之间有决策点，可中止。**

---

## 6. MVP-1：1-2 天验证路径（红队推荐）

> **目标**：20h 内验证 v2 思路方向是否对，不破坏现有功能，不引入新依赖。

| # | 任务 | 工时 |
|---|------|------|
| 1 | 读完 openai-compatible.ts 306 行 diff（前置闸门） | 2h |
| 2 | Phase 0-2~0-5 一次性落地（referenceImages + seed + identityPrompt + xfade） | 8h |
| 3 | 建立 v1 基线（3 条 workflow × 5 帧 × 3 人盲评 1-5 分） | 4h |
| 4 | 末帧准入 prototype（先用现有 image-consistency-agent 评分回退 t2v，不接 CLIP） | 3h |
| 5 | 跑同脚本 v1 vs MVP-1 双盲对照 + 3 人评分 | 3h |

### MVP-1 判定意义
- **评分提升 ≥ 0.5（5 分制）** → 进入完整 Phase 1（CLIP + 分段并行）
- **评分提升 0.3-0.5** → 说明 reference + seed 路线已接近上限，**这才是上 LoRA 的真正信号**
- **评分提升 < 0.3** → **v2 整体方向有问题**，回到画板，**不要急着上 LoRA**

---

## 7. 验收 KPI（修正后）

| # | 指标 | 目标 | 测量点 |
|---|------|------|--------|
| 1 | 主角静帧 **CLIP 距离 ≥ 0.85** 镜头占比 | ≥ 90% | face-validator (CLIP) |
| 2 | 视频内三帧 CLIP 方差 | ≤ 0.05 | video-face-validator |
| 3 | 跨镜头末→首帧 CLIP 落差 | ≤ 0.15 | VideoGenerationLink |
| 4 | LLM Vision 触发率（成本指标） | 较 v1 下降 ≥ 60% | face-validator metrics |
| 5 | 单条 20 分镜片生成端到端时长 | 较 v1 增加 ≤ **50%**（分段并行） | operations-log |
| 6 | 单条 20 分镜片增量成本 | ≤ $0.6（CLIP 调用，LoRA 不在 Phase 1） | 成本日志 |
| **7** | **3 人盲评一致性主观分（5 分制）** | **≥ 4.0** | **每 sprint 抽 10 条样本** |
| 8 | 远景"色调/服装"弱校验通过率 | ≥ 95% | face-validator |

---

## 8. 风险登记表

| 风险 | 严重度 | 缓解策略 |
|------|-------|---------|
| openai-compatible.ts 306 行未提交改动与 v2 P0-1 功能重叠 | 严重 | **Phase 0-1 前置阀门**：先读完 diff，确认无冲突再动 |
| CLIP 在中文海报/字幕场景的评分准确度待验证 | 中 | Phase 1-6 基线测试时一并测，必要时换 DINOv2 |
| 分段并行的"段间末帧不连续" | 中 | 段间转场强制用 `xfade=0.5s`，比段内 0.3 略长，遮蔽不连续 |
| LoRA 训练失败质量差 | 高 | Phase 2-4 必须有手动验收门，不通过则废弃 LoRA |
| 用户期望"立刻见效"但完整 v2 需 50+h | 中 | **MVP-1 路径 20h 内交付可感知提升**，再决定是否深入 |
| BullMQ + Redis worker 在自部署环境下需测稳定性 | 中 | Phase 1 落地前先压测分段并行 4-5 镜的 worker 表现 |

---

## 9. 与未提交改动的合并策略

主 agent 实测 `app/src/services/ai/providers/openai-compatible.ts` 的 306 行未提交改动**就是多参考图 multipart 传递**（含图像数据 URL 解析、`/v1/images/edits` multipart 接入、模型名识别图像 vs LLM）—— **与 v2 P0-1 referenceImages 透传功能在数据流上重叠**。

建议处理顺序：
1. **不要先动 workflow-engine** —— 让那 22 个文件的改动先收尾 commit
2. v2 的"新增文件"部分（`character-pack-builder.ts` / `clip-scorer.ts` / `last-frame-extractor.ts`）**可立即并行进行**（零冲突）
3. `workflow-engine.ts` **不在 22 个未提交文件中**，所以 Phase 0-2/0-3/0-4 可以**在未提交改动 commit 之后立即着手**（不会与正在 in-flight 的改动冲突）
4. Phase 0-5 (xfade) 和 Phase 2 中所有触碰 `video-synthesis.ts / image-orchestrator.ts / replicate.ts / fal.ts` 的任务 **必须等待 22 个改动落盘**

---

## 10. 决策点

**给用户的问题**：

1. **是否启动 MVP-1（20h，2 天）？**
   - ✅ 推荐——先拿到基线数据再决策完整 v2 走向
   - ❌ 跳过 → 风险：50+h 投入后才发现方向偏差

2. **未提交的 22 个改动文件**何时收尾？谁在做？
   - 决定 v2 何时能动 workflow-engine 和 video-synthesis
   - 主 agent 强烈建议先把它们 commit 落盘

3. **LoRA 训练**是否完全推迟到 Phase 2？
   - ✅ 推荐——Agent D 已证明训练样本来源有循环依赖
   - ❌ 若现在就想做 LoRA → 必须先 PoC 验收，**这是另一个并行项目**

4. **客观指标**用 CLIP 还是 DINOv2？
   - 推荐 CLIP（生态成熟，Replicate `andreasjansson/clip-features` 等模型可用）
   - 中文海报场景如效果差，备选 DINOv2

5. **是否在 `openspec/changes/` 下开 OpenSpec change** 跟踪？项目已有 `openspec/changes/complete-video-tts-pipeline`，建议**新开 `character-consistency-v2`** 沿用相同协议。

---

## 11. 变更记录 (Changelog)

| 日期 | 执行者 | 说明 |
|------|--------|------|
| 2026-05-20 | Multi-Agent（A/B/C/D 协作） | 首次产出 v2 改造方案 |

---

**方案签发**：等待用户审阅决策

