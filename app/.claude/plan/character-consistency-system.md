# 📋 实施计划：角色一致性系统 + 整体优化

## 任务类型

- [x] 前端 (→ Gemini)
- [x] 后端 (→ Codex)
- [x] 全栈 (→ 并行)

---

## 背景分析

### PRD 承诺 vs 现状差距

| PRD §4.3.2 承诺          | 当前实现          | 差距等级 |
| ------------------------ | ----------------- | -------- |
| Face embedding 提取      | ❌ 不存在         | CRITICAL |
| 人脸相似度校验 (>0.85)   | ❌ 不存在         | CRITICAL |
| 不达标自动重试 (最多3次) | ❌ 不存在         | HIGH     |
| 多参考图支持             | ⚠️ 仅取第一张     | HIGH     |
| 角色 embedding 注入      | ❌ 纯 prompt 文本 | HIGH     |
| 服装预设管理             | ❌ 不存在         | MEDIUM   |

### 核心技术问题

1. **单参考图瓶颈**：多角色场景仅用第一个角色的第一张参考图 (`api/generate/image/route.ts:L79-89`)
2. **身份漂移风险**：新生成的参考图插入数组头部，后续默认取 `[0]`，逐步偏离原始形象 (`generate-reference/route.ts:L173-178`)
3. **Provider 能力不一致**：SiliconFlow 只是把 URL 拼进文本，OpenAI-compatible 完全忽略 referenceImage
4. **管线重复**：同步路由支持 `selectedCharacterIds` + 场景分析，queue worker 只看单个 `selectedCharacter`
5. **无验证闭环**：生成后无任何质量反馈机制

---

## 技术方案

### 分层一致性策略

```
Layer 0: Structured Prompt (所有 provider)
  ├── 结构化角色外貌字段 → 确定性 prompt 构建
  └── "IMPORTANT: Keep character appearance..." 强化标签

Layer 1: Managed Reference Editing (Replicate/Fal)
  ├── Flux Kontext Pro: 单主角色参考图锁定
  └── 多角色场景: 主角色 image ref + 次角色 enhanced prompt

Layer 2: Face Validation (后验)
  ├── InsightFace/ArcFace face detection + embedding
  ├── 近景/中景: cosine similarity ≥ 动态阈值
  ├── 远景/背面/遮挡: 降级为 soft pass
  └── 不达标 → 同 provider 重试 (最多3次)

Layer 3: Premium Identity (未来)
  ├── PuLID (高保真 face ID injection)
  └── LoRA (高频主角专属训练)
```

---

## 实施步骤

### Phase A: 数据模型升级 + 管线统一 (基础层)

**步骤 A1: 数据库 Schema 升级**

```prisma
// 角色参考资产（从 referenceImages: String[] 归一化）
model CharacterReferenceAsset {
  id            String   @id @default(cuid())
  characterId   String
  character     Character @relation(fields: [characterId], references: [id], onDelete: Cascade)

  url           String
  sourceType    String   // "upload" | "ai_generated" | "canonical"
  isCanonical   Boolean  @default(false)  // 标记「定妆照」
  pose          String?  // "front" | "side" | "back" | "3quarter"
  qualityScore  Float?   // 0-1
  mimeType      String?
  width         Int?
  height        Int?

  createdAt     DateTime @default(now())

  @@index([characterId])
}

// 角色人脸 Embedding（高敏感数据，按用户隔离）
model CharacterFaceEmbedding {
  id            String   @id @default(cuid())
  characterId   String
  character     Character @relation(fields: [characterId], references: [id], onDelete: Cascade)

  embedding     Float[]  // 512-dim ArcFace vector
  modelVersion  String   // "arcface_r100" 等
  sourceAssetId String?  // 来源参考图

  createdAt     DateTime @default(now())

  @@index([characterId])
}

// 角色结构化外貌（替代自由文本 description）
model CharacterAppearance {
  id            String   @id @default(cuid())
  characterId   String   @unique
  character     Character @relation(fields: [characterId], references: [id], onDelete: Cascade)

  hairStyle     String?  // "长发微卷" / "short straight"
  hairColor     String?  // "黑色" / "black"
  faceShape     String?  // "瓜子脸" / "oval"
  eyeColor      String?  // "棕色" / "brown"
  bodyType      String?  // "纤细" / "slim"
  height        String?  // "165cm"
  skinTone      String?  // "fair" / "tan"

  // 服装预设
  clothingPresets Json?  // [{name, description, imageRef}]
  accessories   String?  // "金色耳环, 黑框眼镜"

  // 保留自由文本作为补充
  freeText      String?  @db.Text
}

// 生成尝试记录（支持重试分析）
model GenerationAttempt {
  id              String   @id @default(cuid())
  taskId          String
  task            GenerationTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  attemptNumber   Int
  provider        String   // "replicate" | "fal" 等
  model           String
  strategy        String   // "prompt_only" | "reference_edit" | "face_id"
  seed            Int?
  referenceAssetIds String[] // 使用了哪些参考资产

  // 验证结果
  similarityScores Json?   // {characterId: score}
  faceCount       Int?     // 检测到的人脸数
  passedValidation Boolean?
  failureReason   String?

  outputUrl       String?
  createdAt       DateTime @default(now())

  @@index([taskId])
}
```

**步骤 A2: 管线统一**

将 `api/generate/image/route.ts` 和 `queue-workers.ts` 中的图像生成逻辑收敛为：

```
services/generation/
├── image-orchestrator.ts    # 统一入口：角色解析 → 策略选择 → 生成 → 验证 → 重试
├── strategy-resolver.ts     # 根据 provider 能力 + 角色数 + 景别选择策略
├── face-validator.ts        # InsightFace 人脸检测 + embedding 比对
└── types.ts                 # GenerationStrategy, ValidationResult 等
```

- 同步路由和 queue worker 都调用 `imageOrchestrator.generate()`
- 消除当前两套不一致的角色解析逻辑

**步骤 A3: Provider 能力声明**

```typescript
interface ImageProviderCapability {
  supportsReferenceImage: boolean;
  supportsMultipleReferences: boolean;
  supportsFaceId: boolean;
  supportsInpainting: boolean;
  maxReferenceImages: number;
}

// provider-factory.ts 中为每个 provider 声明能力
// strategy-resolver 根据能力选择最优策略
```

---

### Phase B: 角色管理 UX 升级

**步骤 B1: 结构化角色编辑器**

- 将角色创建/编辑从单一 `description` 文本框改为结构化表单
- 字段：发型、发色、脸型、眼色、身材、肤色、服装预设
- 保留自由文本作为补充
- AI 辅助：用户输入自由文本 → LLM 自动拆解到结构化字段

**步骤 B2: 参考图管理升级**

- 参考图从 `String[]` 迁移到 `CharacterReferenceAsset` 表
- 支持标记"定妆照"(canonical) — 后续生成优先使用
- 支持标记姿态 (正面/侧面/背面)
- 上传时自动做人脸检测，筛掉无脸/低质量图
- 新生成的参考图标记为 `ai_generated`，不自动替代 canonical

**步骤 B3: 角色一致性仪表板**

- 新增「一致性视图」：网格展示某角色在所有场景中的生成图
- 高亮异常（相似度低于阈值的场景标红）
- 支持点击异常场景直接重新生成

---

### Phase C: 生成流程增强

**步骤 C1: 主角色锁定**

- 场景编辑器中支持指定「主角色」（用参考图锁定）和「次角色」（仅 prompt）
- UI：角色列表中添加 ⭐ 标记主角色
- API：主角色参考图作为 `referenceImage`，次角色信息仅注入 prompt

**步骤 C2: 视觉对比面板**

- `SceneEditor` 中新增参考图对比区域
- 生成结果旁边显示角色定妆照
- 支持「闪烁对比」(flicker) 切换参考图和生成图
- 显示相似度分数（当后端验证可用时）

**步骤 C3: Face Validator 集成**

- 集成 InsightFace (Python microservice 或 WASM)
- 角色上传参考图时 → 提取 face embedding → 存储
- 生成后 → 检测人脸 → 与 canonical embedding 比对
- 验证逻辑按景别降级：

| 景别      | 预期人脸   | 验证策略         |
| --------- | ---------- | ---------------- |
| 特写/近景 | 必须检测到 | 严格校验 (≥0.80) |
| 中景      | 应该检测到 | 标准校验 (≥0.70) |
| 远景/全景 | 可能无脸   | 仅检测，不阻断   |
| 背面/遮挡 | 无法检测   | 跳过验证         |

**步骤 C4: 自动重试机制**

- 不达标时同 provider+strategy 重试（最多3次）
- 3次仍不达标 → 标记为 ⚠️ 待人工审核
- 记录每次尝试到 `GenerationAttempt`

---

### Phase D: 批量操作 + 其他优化

**步骤 D1: 批量重新生成**

- 角色库中「更新定妆照后，重新生成所有关联场景」
- 编辑器中「选中多个场景 → 批量生成图像」
- 队列化执行，进度反馈

**步骤 D2: 遗留优化（与一致性并行）**

| 优化项                  | 说明                        | 对应已有计划 |
| ----------------------- | --------------------------- | ------------ |
| Characters 页面拆分     | 1,469 行 → 组件化           | Phase 3 续   |
| AI Models 页面拆分      | 1,841 行 → 组件化           | Phase 3 续   |
| Logger 替换 console.log | 126 处 → 使用 lib/logger.ts | Phase 7 续   |
| Zustand store 清理      | 移除未使用的数据状态        | Phase 5      |
| 测试框架搭建            | Vitest + Playwright         | 新增         |

---

## 关键文件

| 文件                                                         | 操作      | 说明                                |
| ------------------------------------------------------------ | --------- | ----------------------------------- |
| `prisma/schema.prisma`                                       | 修改      | 新增 4 个模型，Character 添加关联   |
| `src/app/api/generate/image/route.ts`                        | 重构      | 调用 imageOrchestrator 替代内联逻辑 |
| `src/services/queue-workers.ts:L56-150`                      | 重构      | 调用 imageOrchestrator              |
| `src/services/generation/image-orchestrator.ts`              | 新建      | 统一生成入口                        |
| `src/services/generation/strategy-resolver.ts`               | 新建      | 策略选择                            |
| `src/services/generation/face-validator.ts`                  | 新建      | 人脸验证                            |
| `src/services/ai/types.ts`                                   | 修改      | 添加 Provider Capability            |
| `src/services/ai/provider-factory.ts`                        | 修改      | 声明各 provider 能力                |
| `src/lib/prompt-builder.ts`                                  | 修改      | 支持结构化角色字段                  |
| `src/types/character.ts`                                     | 修改      | 新增 CharacterAppearance 等类型     |
| `src/app/(dashboard)/characters/page.tsx`                    | 拆分+修改 | 结构化编辑器                        |
| `src/app/(dashboard)/editor/[id]/components/SceneEditor.tsx` | 修改      | 参考图对比面板                      |
| `src/app/(dashboard)/editor/[id]/components/SceneList.tsx`   | 修改      | 主角色标记 + 一致性指示器           |
| `src/app/api/characters/[id]/generate-reference/route.ts`    | 修改      | 不再默认替代 canonical              |

## 风险与缓解

| 风险                                   | 概率 | 影响 | 缓解措施                                             |
| -------------------------------------- | ---- | ---- | ---------------------------------------------------- |
| InsightFace 集成复杂度                 | 高   | 中   | 先用 Python microservice，后期考虑 WASM              |
| Face embedding 生物特征合规            | 中   | 高   | 按用户隔离、级联删除、限制导出、加密存储             |
| 多角色一致性仍受模型能力限制           | 高   | 高   | 明确「主角色锁定 + 次角色 prompt」策略，设定用户预期 |
| 数据迁移（referenceImages → Asset 表） | 中   | 中   | 编写迁移脚本，保留旧字段过渡期                       |
| 阈值校准缺乏数据                       | 高   | 中   | 初期宽松阈值 + 用户反馈收集，逐步收紧                |

## 执行优先级

```
Phase A (基础层，2-3周)
  A1 Schema → A2 管线统一 → A3 Provider 能力
      ↓
Phase B (角色 UX，2周)          Phase C (生成增强，2-3周)
  B1 结构化编辑 ──────────────→ C1 主角色锁定
  B2 参考图管理 ──────────────→ C2 视觉对比
  B3 一致性仪表板 ←──────────── C3 Face Validator
                                C4 自动重试
      ↓                              ↓
Phase D (批量+优化，1-2周)
  D1 批量重新生成
  D2 遗留优化（并行）
```

**总计估算：7-10 周**

## SESSION_ID（供 /ccg:execute 使用）

- CODEX_SESSION: 019d0126-539f-7a92-8611-8936837aa894
- GEMINI_SESSION: bab4495b-f31e-4175-93c9-ae17729a0174
