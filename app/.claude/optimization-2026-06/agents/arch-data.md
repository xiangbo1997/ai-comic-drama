# 数据模型架构诊断 — arch-data

> 领域：Prisma schema / 数据一致性 / 事务边界 / 配乐数据建模
> 范围：`prisma/schema.prisma`（662 行，约 30 model + 14 enum）
> 不含：查询性能调优（perf-backend）、资金安全/积分对账（security-cost）
> 证据基线：所有行号引用 `app/prisma/schema.prisma`，代码引用标注完整路径

---

## 1. 现状诊断（证据驱动）

### 1.1 数据完整性：`GenerationTask` 是孤儿表（最严重）

`GenerationTask`（L350-369）的 `projectId String?`（L360）/ `sceneId String?`（L361）是**裸字符串，没有 `@relation`、没有外键、没有 `@@index`、没有 `userId`**：

```prisma
model GenerationTask {
  ...
  projectId   String?   // ← 无 @relation，无外键约束
  sceneId     String?   // ← 无 @relation，无外键约束
  // ← 完全缺失 userId
}
```

后果（均有代码证据）：

- **删项目不清任务**：`Project`(L110-131) 的 relation 列表里没有 `tasks`，删 Project 时 `GenerationTask` 行残留 → DB 无限膨胀。同理删 Scene。
- **无法按用户查/限流/清理**：全仓 `grep generationTask` 仅有 `.create` / `.update` / `findUnique(by id)` / admin `groupBy`，**没有任何 `where: { userId }`**。`GenerationTask` 既不能做"用户的任务历史"页，也无法做配额。这是 security-cost 域要做幂等退款时的硬伤——退款要回查 task 归属，现在查不到。
- **`cost Float`(L357) 落库但无人对账**：image route 写 `cost`（`generate/image/route.ts:142-150`），但积分实际扣减走的是 `lib/credits.ts` 的 `CreditTransaction` 账本。两套 cost 记录并存且不交叉验证。

### 1.2 事务边界：分镜批量保存是「删全表 + 循环单插」非事务（P0）

`POST /api/projects/[id]/scenes`（`scenes/route.ts:135-176`）：

```ts
await prisma.scene.deleteMany({ where: { projectId: id } });   // L135 先删全部
for (let i = 0; i < scenes.length; i++) {
  await findCharacterByName(id, characterName);                // L152 循环内查库
  const createdScene = await prisma.scene.create({ ... });     // L161 循环内单条插
}
```

三个独立问题叠加：

1. **非原子**：`deleteMany` 与后续 `create` 循环**不在 `$transaction` 内**。任意一条 `create` 失败 → 用户分镜被删光、新分镜只插了一半，**数据不可恢复**（inputText 还在但分镜全没了）。
2. **N+1 写**：N 条分镜 = 1 删 + N 次 `findCharacterByName`（每次查库）+ N 次 insert，串行。50 镜 ≈ 100+ round-trip。
3. **删全建全丢失生成结果**：`deleteMany` 把已生成的 `imageUrl/videoUrl/audioUrl`（L179-181）连同 Scene 一起删了 → 重新保存脚本即丢图。应改 upsert by `(projectId, order)`。

对比：项目里**已有正确范式**——`scenes/reorder/route.ts:73`、所有 `payment/callback/*`、`lib/credits.ts:129` 都正确用了 `$transaction`。批量保存是唯一漏网的高危写路径。

`workflow-engine.ts:857,880` 的 `scene.create` 循环 + `deleteMany({ id: { in: stale } })` 也是同一模式（非事务），次严重（后台任务，但同样会半写）。

### 1.3 范式 / 冗余：双写字段技术债（P1）

schema 内有 4 处「旧字段 + 新模型」并存，靠应用层手动同步，无 DB 约束保证一致：

| 旧（标量/数组）                         | 新（结构化模型）                       | 行号        |
| --------------------------------------- | -------------------------------------- | ----------- |
| `Scene.selectedCharacterId`（单选）     | `Scene.selectedCharacterIds[]`（多选） | L189 / L191 |
| `Character.referenceImages String[]`    | `CharacterReferenceAsset[]`            | L220 / L233 |
| `Character.description`（自由文本外貌） | `CharacterAppearance`（结构化）        | L215 / L232 |
| —（无 enum）                            | 多处 `String` 当枚举用                 | 见 1.4      |

`prisma/CLAUDE.md` 自己已标注"读写时注意同步"——这是承认了一致性靠人肉维护。新数据双写，老数据只有旧字段，任何只读新模型的代码都会漏老数据。

### 1.4 枚举设计：该枚举的字段在用裸 String（P1）

明确该收敛为 enum 却用 `String` 的字段（扩展性/拼写一致性差，无 DB 校验）：

- `Scene.shotType String?`（L171，注释写死"特写/中景/远景"）
- `Scene.emotion String?`（L175，代码默认 `"neutral"`）
- `Project.style String`（L116）/ `aspectRatio String`（L117）/ `ShortDramaScript.style/aspectRatio/genre`（L144-146）
- `Character.gender/age String?`（L213-214）
- `CharacterReferenceAsset.sourceType String`（L265，注释"upload/ai_generated/canonical"）/ `pose String?`（L267，"front/side/back/3quarter"）
- `GenerationAttempt.strategy String`（L380，"prompt_only/reference_edit/face_id"）
- `WorkflowStepRun.status String`（L639，与已有 `WorkflowStatus` enum L656 不一致——同库两种状态表达）

注意约束：服务器用 `prisma db push` 部署（见 1.6），**新增 enum 值 / String→enum 迁移在 PG 上是破坏性的**，需评估，不能盲转。

### 1.5 JSON 字段滥用评估（部分合理，部分应结构化）

逐个判定（不是所有 JSON 都该拆）：

| 字段                                                          | 行号             | 判定             | 理由                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Project.generationParams`                                    | L120             | **保留 JSON** ✅ | 已有 `normalizeGenerationParams` 白名单校验（`projects/[id]/route.ts:105-137`），是松散的"用户可调样式包"，读路径多（export/transcribe/workflow 都读），结构化收益低。**但内含 `subtitleStyle/watermark/stickers/transitions/sceneEffects`(export/route.ts:66-88) 全塞这一个 JSON——配乐若也塞进去会让这个 blob 继续膨胀，见第 6 节，BGM 应独立建模而非塞 generationParams** |
| `GenerationAttempt.similarityScores`                          | L386             | **应结构化** ⚠️  | 人脸相似度是要做阈值过滤/排序的（`passedValidation` L387 依赖它），JSON 里查不了，应拆 `{ assetId, score }` 子表或至少 `Float[]`                                                                                                                                                                                                                                            |
| `GenerationTask.input/output`                                 | L354-355         | 保留 JSON ✅     | 异构任务的多态载荷，结构化代价过高                                                                                                                                                                                                                                                                                                                                          |
| `CharacterAppearance.clothingPresets`                         | L250             | 保留 JSON ✅     | 纯展示用数组，无查询需求                                                                                                                                                                                                                                                                                                                                                    |
| `WorkflowRun.config/artifacts` `WorkflowStepRun.input/output` | L617-618,641-642 | 保留 JSON ✅     | 编排态多态数据                                                                                                                                                                                                                                                                                                                                                              |
| `AIProvider.models/configSchema`                              | L523-524         | 保留 JSON ✅     | 动态表单 schema，本就该是 JSON                                                                                                                                                                                                                                                                                                                                              |

### 1.6 软删除全缺失 + db push 部署约束（P1 / 约束）

- **零软删除**：全 schema 无一个 `deletedAt`。所有删除是硬删 + 大量 `onDelete: Cascade`（`prisma/CLAUDE.md` 已警告"删 User 连带清 Project/Character/Orders，生产慎用"）。**删 User → 级联删 Order/Subscription/CreditTransaction**（L52/L450/L499）——这会**销毁资金/积分审计账本**，与 security-cost 域直接冲突。`Order`/`CreditTransaction`/`Subscription` 必须改 `onDelete: Restrict` 或软删。
- **部署约束**：服务器无 migration 历史，靠 `prisma db push`（MEMORY 确认）。所有 schema 变更必须 **additive & nullable**：新字段给默认值或可空、新表无强制回填、不重命名、不删列、enum 只增不改值。本报告所有方案都按此约束设计。

### 1.7 索引缺口（与 perf 域边界：仅列完整性相关）

数据完整性视角的缺失（非性能调优）：

- `Scene` 无 `@@index([projectId, order])` —— 排序读全表扫（L168-200 无索引）。
- `ShortDramaScript` 有 `@@index([projectId])`（L157）✅ 但缺 `@@unique` 防同 project 重复草稿。
- `GenerationTask` 全裸（见 1.1）。

---

## 2. 问题分级

| 级     | 问题                                               | 证据                             | 影响面                                                                       |
| ------ | -------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| **P0** | 分镜批量保存非事务 + 删全建全                      | `scenes/route.ts:135-176`        | **数据丢失**：保存中断丢全部分镜 + 已生成图/视频被删；每个走"保存脚本"的用户 |
| **P0** | 删 User 级联销毁资金/积分账本                      | L52/L450/L499 `onDelete:Cascade` | **审计合规**：Order/CreditTransaction/Subscription 被连带硬删，无法对账退款  |
| **P0** | `GenerationTask` 孤儿表（无 FK/userId/index/级联） | L350-369                         | DB 无限膨胀 + 无法按用户查任务/退款回查归属                                  |
| **P1** | 4 处旧/新字段双写，无 DB 约束                      | L189/191, L220/233, L215/232     | 一致性靠人肉；漏读老数据                                                     |
| **P1** | 软删除全缺失                                       | 全 schema 无 `deletedAt`         | 误删不可恢复；与审计冲突                                                     |
| **P1** | 该枚举的字段用裸 String（9+ 处）                   | L171/175/265/267/380/639…        | 拼写漂移、无校验、`WorkflowStepRun.status` 与 enum 自相矛盾                  |
| **P1** | `WorkflowStepRun.status` 用 String 而非已有 enum   | L639 vs L656                     | 同库两种状态语义                                                             |
| **P2** | `GenerationAttempt.similarityScores` 该结构化      | L386                             | 阈值过滤/排序查不了                                                          |
| **P2** | `Scene`/`ShortDramaScript` 索引/唯一约束缺口       | L168-200, L157                   | 完整性兜底缺失                                                               |
| **P2** | `Order.subscriptionId`(L444) 裸 String 无 relation | L444                             | 订单↔订阅无外键                                                              |

---

## 3. 具体优化方案（可落地，兼容 db push）

### 3.1 P0-A 分镜批量保存改事务 + upsert（不丢生成结果）

`scenes/route.ts` 重写为：先批量预解析角色（一次性 `findMany` 替代 N 次 `findCharacterByName`），再单一 `$transaction` 内按 `order` upsert，删掉"删全表"。

```ts
// 1) 一次性取项目所有角色名→id（消 N+1）
const chars = await prisma.projectCharacter.findMany({
  where: { projectId: id },
  include: { character: { select: { id: true, name: true } } },
});
const byName = new Map(chars.map((c) => [c.character.name, c.character.id]));

await prisma.$transaction(async (tx) => {
  // 删除多余尾部（新脚本比旧短时）
  await tx.scene.deleteMany({
    where: { projectId: id, order: { gte: scenes.length } },
  });
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const selectedCharacterId =
      (s.characters ?? []).map((n) => byName.get(n)).find(Boolean) ?? null;
    await tx.scene.upsert({
      where: { projectId_order: { projectId: id, order: i } }, // 需新增复合唯一键
      update: {
        shotType: s.shotType ?? null,
        description: s.description ?? "",
        dialogue: s.dialogue ?? null,
        narration: s.narration ?? null,
        emotion: s.emotion ?? "neutral",
        duration: s.duration ?? 3,
      },
      // imageUrl/videoUrl/audioUrl 不写 → 保留已生成结果
      create: { projectId: id, order: i, /* …同上… */ selectedCharacterId },
    });
  }
});
```

schema 配套（additive，db push 友好）：

```prisma
model Scene {
  // …
  @@unique([projectId, order])   // upsert 锚点
  @@index([projectId, order])
}
```

> 迁移注意：若现网存在 `(projectId, order)` 重复行，db push 加唯一键会失败。上线前先跑一次去重脚本（`row_number()` 重排 order）。

### 3.2 P0-B 保护审计账本：改级联策略

```prisma
model Order        { user User @relation(..., onDelete: Restrict) }   // L450
model Subscription { user User @relation(..., onDelete: Restrict) }   // L499
model CreditTransaction { user User @relation(..., onDelete: Restrict) } // L52
```

配合软删（3.4）：删用户走 `deletedAt`，账本永久保留。`onDelete` 改动对 db push 是 additive（仅改约束行为），安全。

### 3.3 P0-C `GenerationTask` 补全为一等公民

```prisma
model GenerationTask {
  // …现有字段…
  userId    String?                                              // 新增（nullable 兼容老行）
  user      User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  project   Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  scene     Scene?   @relation(fields: [sceneId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@index([projectId])
  @@index([status])
}
// Project / Scene / User 各加反向： tasks GenerationTask[]
```

全 nullable + 老 `projectId` 字符串值天然成为 FK（指向存在的 Project 即合法；指向已删的留 null）。db push 友好。补 `userId` 后所有生成端点 `.create` 加一行 `userId: session.user.id`。

### 3.4 P1 引入软删除（最小集：用户内容 + 审计实体）

```prisma
model Project   { deletedAt DateTime? @@index([userId, deletedAt]) }
model Character { deletedAt DateTime? }
model User      { deletedAt DateTime? }
model Order     { /* 不删，仅靠 Restrict */ }
```

全 nullable，db push 零风险。查询统一加 `where: { deletedAt: null }`（可用 Prisma extension 全局过滤，避免逐处改）。

### 3.5 P1 String→enum 收敛（分批，每个独立 db push）

优先收敛**值域稳定、有代码默认值**的：`Scene.shotType`(SHOT_CLOSEUP/MEDIUM/WIDE)、`Scene.emotion`、`CharacterReferenceAsset.sourceType/pose`、`GenerationAttempt.strategy`、`WorkflowStepRun.status`（直接复用 `WorkflowStatus`）。

db push 迁移姿势（避免破坏老数据）：先加 enum 类型 + **新增 enum 列**（保留旧 String 列），后台回填，应用双读切换，最后一个 push 删旧列。不要原地 `String→enum`。

### 3.6 P2 `GenerationAttempt.similarityScores` 结构化

```prisma
model FaceSimilarityScore {
  id        String @id @default(cuid())
  attemptId String
  attempt   GenerationAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  assetId   String
  score     Float
  @@index([attemptId])
}
```

---

## 4. 行业标杆对标

| 能力                | 本项目现状                                                                  | CapCut/剪映 / Runway / Pika                       | 差距                           |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------ |
| 工程/分镜数据原子性 | 删全建全、非事务（3.1）                                                     | 剪映工程文件原子写 + 自动版本快照                 | **大**：会丢工程               |
| 操作历史 / 版本     | 仅 `ShortDramaScript.version`(L153) 单调整数，无快照                        | Runway/剪映均有 history + undo 栈                 | **大**：无撤销、无回滚         |
| 资产去重 / 媒资库   | 角色参考图有 `CharacterReferenceAsset`，但**无项目级共享媒资库、无 BGM 库** | 剪готов/CapCut 有内置音乐+音效库 + 用户素材库     | **大**：配乐功能缺整库（见 6） |
| 软删除 / 回收站     | 全无                                                                        | CapCut 草稿回收站 30 天                           | **中**                         |
| 生成任务可观测      | 孤儿 `GenerationTask`，无用户维度                                           | Runway 有 per-user generation history + 重试/退款 | **中**                         |

---

## 5. 实施优先级与工作量

| 优先级 | 任务                                          | 工作量                  | db push 风险         |
| ------ | --------------------------------------------- | ----------------------- | -------------------- |
| 1      | P0-A 分镜保存事务+upsert（3.1）               | **M**                   | 低（需先去重 order） |
| 2      | P0-B 审计账本 onDelete:Restrict（3.2）        | **S**                   | 极低                 |
| 3      | P0-C GenerationTask 补 FK/userId/index（3.3） | **S**                   | 极低（全 nullable）  |
| 4      | P1 软删除最小集（3.4）                        | **M**（含全局查询过滤） | 极低                 |
| 5      | **配乐数据建模（见第 6 节）**                 | **M**                   | 极低（纯新增表）     |
| 6      | P1 String→enum 分批收敛（3.5）                | **L**                   | 中（需分步迁移）     |
| 7      | P2 similarityScores 结构化 + 索引补全         | **S**                   | 低                   |

建议先做 1-3（一个 PR，纯加固，db push 一次过），再做 5（配乐，独立 PR，与 feat-bgm agent 协同）。

---

## 6. 配乐（BGM）功能完整 Schema 设计【交付重点】

### 设计决策

1. **独立建表，不塞 `Project.generationParams`**：generationParams 已是 watermark/sticker/transition/sceneEffect 的杂物袋（`export/route.ts:66-88`），BGM 需要曲库（可复用、可检索、有时长/封面/版权元信息），塞 JSON 会丧失检索与复用，违背 1.5 判定。
2. **三层模型**：`BgmTrack`（曲库，系统预置 + 用户上传）→ `ProjectBgm`（项目级配乐配置，整片或多段）→ 可选 `SceneBgm`（分镜级，留扩展）。
3. **对接合成管线**：`video-synthesis.ts:842-851` 当前用 `amix=inputs=N` 混人声。BGM 作为**额外音频输入**进 `amix`，并对人声段做 **volume duck**（sidechaincompress 或分段 volume）。字段须承载 `volume` / `loop` / `fadeIn/Out` / `duckingDb` 供 ffmpeg 取参。
4. **db push 友好**：全部新增表，零破坏。

### Schema 定义

```prisma
// ============ 配乐 / BGM ============

// BGM 曲库：系统预置曲目 + 用户上传曲目（可跨项目复用）
model BgmTrack {
  id          String      @id @default(cuid())
  title       String                          // 曲名
  artist      String?                         // 艺术家 / 来源
  url         String                          // 音频文件 URL（走 storage.uploadFile，R2/本地）
  coverUrl    String?                         // 封面图
  durationSec Float                           // 时长（秒，用于 loop/裁切计算）
  bpm         Int?                            // 节拍（可选，用于卡点）
  mood        BgmMood?                        // 情绪标签（检索用）
  genre       String?                         // 曲风（先 String，稳定后转 enum）
  license     BgmLicense  @default(ROYALTY_FREE) // 版权类型（合规必需）
  isSystem    Boolean     @default(false)     // 系统预置曲库（无 userId）
  isActive    Boolean     @default(true)      // 下架开关
  sortOrder   Int         @default(0)

  userId      String?                         // 用户上传曲目归属；null=系统预置
  user        User?       @relation(fields: [userId], references: [id], onDelete: Cascade)

  projectBgms ProjectBgm[]
  sceneBgms   SceneBgm[]

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([userId])
  @@index([mood])
  @@index([isSystem, isActive])
}

// 项目级配乐配置：一个项目可挂多段 BGM（整片 or 时间区间），按 order 串
model ProjectBgm {
  id          String   @id @default(cuid())
  projectId   String
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  trackId     String
  track        BgmTrack @relation(fields: [trackId], references: [id], onDelete: Restrict) // 曲目被引用时禁删

  order        Int     @default(0)            // 多段排序
  startSec     Float   @default(0)            // 在成片时间轴上的起点（秒）
  endSec       Float?                         // 终点；null=贴到片尾
  trackOffsetSec Float @default(0)            // 从曲目内第几秒开始取（裁切）
  volume       Float   @default(0.6)          // 音量 0~1（混入 amix 前的增益）
  loop         Boolean @default(true)         // 不够长是否循环铺底
  fadeInSec    Float   @default(1.0)          // 淡入
  fadeOutSec   Float   @default(1.5)          // 淡出
  duckingDb    Float   @default(-8.0)         // 有人声时 BGM 压低分贝（0=不闪避）
  enabled      Boolean @default(true)

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@unique([projectId, order])
  @@index([projectId])
  @@index([trackId])
}

// （扩展位，先建表不强用）分镜级配乐：单个分镜独立配乐覆盖项目级
model SceneBgm {
  id        String   @id @default(cuid())
  sceneId   String   @unique                  // 一个分镜至多一条覆盖
  scene      Scene    @relation(fields: [sceneId], references: [id], onDelete: Cascade)
  trackId   String
  track      BgmTrack @relation(fields: [trackId], references: [id], onDelete: Restrict)

  volume     Float   @default(0.6)
  loop       Boolean @default(true)
  fadeInSec  Float   @default(0.5)
  fadeOutSec Float   @default(0.5)
  duckingDb  Float   @default(-8.0)
  enabled    Boolean @default(true)

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([trackId])
}

enum BgmMood {
  HAPPY        // 欢快
  SAD          // 悲伤
  TENSE        // 紧张
  EPIC         // 史诗
  ROMANTIC     // 浪漫
  CALM         // 舒缓
  MYSTERY      // 悬疑
  COMEDY       // 搞笑
}

enum BgmLicense {
  ROYALTY_FREE // 免版税
  CC           // 知识共享
  USER_UPLOAD  // 用户自传（责任在用户）
  LICENSED     // 已购授权
}
```

### 反向关系（加到现有 model，全 additive）

```prisma
model User    { bgmTracks BgmTrack[] }     // 加到 L36 附近
model Project { bgms ProjectBgm[] }        // 加到 L130 附近
model Scene   { bgm SceneBgm? }            // 加到 L199 附近
```

### 与 feat-bgm 协同的契约

- **我（arch-data）交付**：上述 schema（曲库/项目配乐/分镜配乐）+ 字段语义（`volume/loop/fadeIn/Out/duckingDb/trackOffsetSec`）。
- **feat-bgm 负责**：① `video-synthesis.ts:842-851` 把 `ProjectBgm.track.url` 作为额外 `-i` 输入接进 `amix`，按字段生成 `volume`/`afade`/`aloop`，对人声做 ducking；② 曲库选择 UI + 上传（走 `storage.uploadFile`）；③ export route 读 `project.bgms` 注入合成参数。
- **边界**：BGM 文件落盘走 `storage.ts uploadFile()`（R2/本地自动切，brief L18），`BgmTrack.url` 存返回 URL，与现有产物存储一致。

---

## 摘要

数据模型最致命的是 **3 个 P0**：分镜批量保存「删全建全 + 非事务」会丢工程和已生成图视频（`scenes/route.ts:135-176`）；删 User 级联硬删 Order/CreditTransaction/Subscription 会销毁资金审计账本（L52/450/499）；`GenerationTask` 是无 FK/无 userId/无索引的孤儿表（L350-369）。配乐功能给出了完整三层 schema（`BgmTrack` 曲库 + `ProjectBgm` + `SceneBgm` + 2 个 enum，全 additive 兼容 db push），承载 ffmpeg ducking/fade/loop 所需全部字段，与 feat-bgm 划清「我建模、他合成+UI」边界。所有方案按 `prisma db push` 无 migration 约束设计（additive & nullable）。
