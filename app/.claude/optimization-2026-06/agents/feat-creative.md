# feat-creative — 生成质量与创作能力的功能差距分析

> 领域：7 步管线（文本→分镜→角色→图→视频→配音→导出）每步的**生成质量与创作能力**。
> 不含 BGM（→ feat-bgm）、不含交互（→ ux）。聚焦点：**角色一致性**（漫剧核心竞争壁垒）、镜头语言、配音、风格模板、批量/历史/多分辨率等标杆功能缺口。
> 证据驱动，全部引用 `file:line`。执行者：Claude Code（2026-06-19）。

---

## 1. 现状诊断（引用证据）

### 1.1 文本→分镜：prompt 工程已有雏形，但「镜头语言」字段被采集后丢弃

- 初版 `parseScript` 的 system prompt 已强制 LLM 输出 `cameraAngle / lighting / composition / colorPalette` 四个镜头语言字段，并带 few-shot 示例（`src/lib/prompts/script-parse.ts:11-63`）。
- Agent 版 `ScriptParserAgent` 的 Zod schema 也保留这四个字段为 `optional`（`src/services/agents/script-parser-agent.ts:38-41`）。
- **但下游全部丢弃**：
  - Scene DB 模型（`prisma/schema.prisma` model Scene）**没有** `cameraAngle / lighting / composition / colorPalette / cameraMovement / transition` 任何字段，只有 `shotType / emotion / duration`。
  - `StoryboardAgent` 重新生成 `imagePrompt` 时，输入只喂 `shotType / emotion / description / dialogue`（`src/services/agents/storyboard.ts:36-46` 的 sceneList 拼接），**不含**已解析出的 cameraAngle/lighting/composition/colorPalette。
  - 结果：第一步辛苦解析的电影级镜头语言，到出图 prompt 时已蒸发。`lib/prompts/image-prompt.ts:46-88` 虽有成熟的 `LIGHTING_MAP`（伦勃朗光/黄金时刻/赛博朋克…），但**没有任何调用方把 scene.lighting 喂进来**（grep 仅模板定义，无生产调用链）。

### 1.2 角色一致性（核心壁垒）：三条独立链路，强度参差且互不复用

漫剧的生死线是「同一角色跨分镜长相一致」。当前有三套机制，但存在硬缺陷：

**(a) 出图编排器 — seed + 参考图，方向对但 seed 太弱**

- `image-orchestrator.ts:78-82` 用主角色 ID 的 FNV-1a 哈希做稳定 seed，跨镜头复用——思路正确。
- `strategy-resolver.ts:56-60` 在 provider `supportsReferenceImage` 时走 `reference_edit`，把角色 canonicalImageUrl 当参考图——这是真正有效的一致性手段。
- **问题**：seed 仅对支持 seed 的 provider 生效（DALL·E 等忽略），且 seed 一致 ≠ 角色一致（同 seed 换 prompt 仍会漂）。真正的锚是参考图，但参考图依赖角色有 `canonicalImageUrl`，而很多角色没有定妆图就直接出分镜图。

**(b) Face Validator — 有 LLM 多模态校验，但默认形同虚设**

- `face-validator.ts:58-105` 用 LLM Vision 对比「参考图 vs 生成图」打 0-1 相似分，按景别设阈值（特写 0.8 / 近景 0.75）——设计不错。
- **但触发条件极苛刻**：必须 ① 景别是特写/近景/中景（`SHOT_TYPE_CONFIG:26-35`，远景/全景直接放行）② primary 角色有 `canonicalImageUrl`（`:73`）③ 传了 `llmConfig`（`:77`）。三者缺一即 `passthrough` 放行（`:67/73/79`）。生产中大量分镜没有 canonical 参考图 → 校验直接跳过，等于没校验。
- 失败也只重试，不换策略（`image-orchestrator.ts:103`），重试还是同 prompt+同 seed，大概率重复失败。

**(c) 三视图（角色定妆）— 三张图各自独立生成，互不参考 = 不是同一个人**

- `generate-three-views/route.ts:145-151`：front/side/back **三张图各调一次 `generateImage`，无 seed、无参考图、互不引用**，只靠 `POSE_CONSTRAINTS`（`lib/prompts/character-reference.ts:73`）的角度词区分。
- 后果：所谓「三视图/角色转身」三张脸很可能是三个人。标杆做法（即梦/可灵的角色定妆）是先出正面定妆图 → 锁 seed/参考图 → 用 i2i 出侧/背视图。当前实现彻底没做这步绑定，且三张都 `isCanonical:false`（`:181`），没有任何一张被选作后续分镜的锚点。

### 1.3 视频生成：身份维持已接线，但「同步阻塞 + 无运镜控制」

- `workflow-engine.ts:578-598` 做了 v2 身份维持（identityPrompt + referenceImages + seed 透传给 i2v），方向标杆。
- **但运镜信息断链**：`SceneArtifactSchema` 有 `cameraMovement`（`storyboard.ts` SceneArtifactSchema），可 `videoPrompt` 只拼 `identityPrompt + description`（`workflow-engine.ts:579-581`），**没把 cameraMovement（zoom_in/pan_left/tilt_up）喂给视频模型**。运镜全靠模型自由发挥。
- `duration` 只有二档：`sceneArtifact.duration > 5 ? 10 : 5`（`:587`），丢失了脚本里精细的秒数。
- 视频是**同步阻塞**（brief 已知缺陷），无异步轮询/失败退款。

### 1.4 配音（TTS）：自动管线把音频「生成完就扔」+ 无情感/无多角色音色

这是本领域**最严重的 P0**：

- `workflow-engine.ts:619-636`：自动管线调 `synthesizeSpeech` 后，`.then()` 里**只把 `audioStatus` 置 COMPLETED，完全没拿 returned Buffer 上传、没写 `scene.audioUrl`**。对比标准 TTS 路由 `generate/tts/route.ts:127-167` 是正确落 R2 + 写 audioUrl 的。→ 走 Workflow「一键成片」的项目，导出时 `scene.audioUrl` 为空，`video-synthesis.ts:702` 拿不到音频，**成片是哑的**。
- **无情感**：`TTSOptions`（`types/ai.ts:83-88`）只有 `text/voiceId/speed`，**没有 emotion 参数**。而脚本每个 scene 都有 `emotion`（happy/sad/angry…），CharacterBible 也生成了 `voiceProfile.tone`（`character-bible-agent.ts:38-42/264-268`），但全部没传给 TTS。火山引擎 provider（`tts/volcengine.ts:34-39`）请求体里也没带 emotion/情感参数（火山 bigtts 实际支持 `emotion` 字段）。
- **多角色音色不分**：自动管线对所有 scene 用同一个 `ctx.config.tts`（`workflow-engine.ts:620-622`），**不按 scene 的说话角色取 `Character.voiceId`**。标准 TTS 路由其实已支持按 characterId 取音色（`generate/tts/route.ts:59-72`），但 Workflow 没复用这条逻辑。→ 男女主一个声音。
- **无对白说话人归属**：scene 只有一个 `dialogue` 字符串（`schema.prisma` Scene.dialogue），多角色对话场景无法区分「谁说哪句」，导致无法做分句多音色。

### 1.5 导出/合成：实际是本领域**最成熟**的一环（差异化资产）

- `video-synthesis.ts` 已支持：xfade 转场白名单（`:96-99`）、字幕 force_style 样式（`:269-309`）、水印（`:557-563`）、变速（`:472-483`）、多分辨率 480p/720p/1080p（`:61-63`）、多画幅 9:16/16:9/1:1（`:67-69`）、按场景 adelay 对齐音频（`:708-710`）。
- 这层质量高，缺口主要在**上游没把数据喂满**（转场/运镜/情感/audioUrl 断链，如上）。

### 1.6 缺失的整类标杆能力（代码中完全无实现）

grep 全库确认**不存在**：

- **风格模板/预设**（国漫/日漫/写实/赛博）：`image-prompt.ts:6-17` 有 9 个风格 key，但无「模板」概念（无封面、无 negative 联动、无运镜/字幕预设打包）。无 `StyleTemplate` 模型（schema grep 无）。
- **生成历史/版本管理**：`schema.prisma` 无 `Version/History` 模型，scene 的 imageUrl 是单值覆盖，重新生成即丢旧图，无法 A/B 对比或回滚。
- **批量生成**：图像生成并发写死 `concurrency=3`（generation/CLAUDE.md 记载），但无「批量重出选中分镜」「一键全量重生成」的产品入口（需逐个点）。
- **口型同步（lip-sync）**：零实现。
- **一键成片**：有 Workflow auto 模式骨架，但因 1.4 的 audioUrl 断链，实际产出残缺。

---

## 2. 问题分级（每条带影响面）

| 级别   | 问题                                                                          | 证据                                                                      | 影响面                           |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| **P0** | 自动管线 TTS 不存 audioUrl，一键成片是哑片                                    | `workflow-engine.ts:619-636` vs `generate/tts/route.ts:163-167`           | 所有走 Workflow 的项目，导出无声 |
| **P0** | 三视图三张独立生成，非同一角色                                                | `generate-three-views/route.ts:145-151`                                   | 角色定妆=一致性地基，地基塌了    |
| **P1** | 镜头语言四字段（cameraAngle/lighting/composition/colorPalette）解析后全程丢弃 | `script-parse.ts:11-63` → Scene 模型无字段 → `storyboard.ts:36-46` 不传入 | 出图缺电影感，与标杆拉开质感差距 |
| **P1** | Face Validator 默认放行（无 canonical 参考图即跳过），一致性校验形同虚设      | `face-validator.ts:67/73/79`                                              | 角色跨分镜漂脸，漫剧硬伤         |
| **P1** | TTS 无 emotion、多角色不分音色                                                | `types/ai.ts:83-88`、`workflow-engine.ts:620-622`                         | 配音平淡、男女同声，观感廉价     |
| **P1** | 运镜（cameraMovement）不喂给视频模型；duration 仅二档                         | `workflow-engine.ts:579-587`                                              | 运镜失控、节奏失真               |
| **P2** | 无风格模板/预设（打包风格+negative+运镜+字幕）                                | 全库无 StyleTemplate                                                      | 新手无法一键定调，复用成本高     |
| **P2** | 无生成历史/版本管理，重生成即覆盖                                             | schema 无 Version 模型                                                    | 无法 A/B、无法回滚，创作焦虑     |
| **P2** | 无批量重生成产品入口                                                          | 仅 concurrency=3 引擎能力                                                 | 多分镜项目操作成本高             |
| **P2** | 失败重试不换策略（同 prompt+seed）                                            | `image-orchestrator.ts:103`                                               | 重试浪费配额，命中率低           |

---

## 3. 具体优化方案（可落地）

### P0-1 修复自动管线 TTS 落库（小改，立刻见效）

`workflow-engine.ts:616-637` 改为复用标准 TTS 逻辑：拿 Buffer → `uploadFile`（走 storage 门面）→ 写 `scene.audioUrl`，并按角色取 voiceId：

```ts
// 取该 scene 主说话角色的 voiceId（同 generate/tts/route.ts:59-72 逻辑）
const speakerId = sceneArtifact.characters?.[0];
const voiceId = await resolveVoiceId(speakerId, ctx.projectId); // 查 Character.voiceId
const buf = await synthesizeSpeech({ text, voiceId, config: ctx.config.tts });
const audioUrl = await uploadFile(buf, {
  fileType: "audio",
  userId: ctx.userId,
  projectId: ctx.projectId,
});
await prisma.scene.update({
  where: { id: dbScene.id },
  data: { audioUrl, audioStatus: "COMPLETED" },
});
```

### P0-2 三视图绑定锚点（i2i 串联）

`generate-three-views/route.ts:144-169`：先出正面图作 canonical，后两视图用首图当参考图 + 同 seed：

```ts
const seed = hashStringToSeed(characterId);
let canonicalUrl: string | undefined;
for (const pose of POSES) {
  // POSES 顺序确保 front 在首
  const imageUrl = await generateImage({
    prompt: `${basePrompt}, ${POSE_CONSTRAINTS[pose]}`,
    referenceImage: pose === "front" ? undefined : canonicalUrl, // 侧/背锚定正面
    seed,
    aspectRatio: "1:1",
    config: imageConfig || undefined,
  });
  if (pose === "front") canonicalUrl = savedUrl; // 落库后赋值
}
```

并把 front 图 `isCanonical:true`（`:181`），写回 `Character.canonicalImageUrl`，供后续分镜出图 + face-validator 当锚。

### P1-1 打通镜头语言（端到端）

1. Scene 模型加字段（迁移）：
   ```prisma
   cameraAngle    String?
   lighting       String?
   composition    String?
   colorPalette   String?
   cameraMovement String?  // static/pan_left/zoom_in/tilt_up
   transition     String?  // cut/fade/dissolve
   ```
2. `storyboard.ts:36-46` sceneList 拼接补上这四字段；imagePrompt 构造规则（`storyboard.ts` 注释 1-7 步）插入：用 `getLightingPrefix(scene.lighting)`（`image-prompt.ts:84-88`，已现成）翻译光线、追加 composition/colorPalette。
3. 导出端：把 `scene.cameraMovement → 视频 prompt`、`scene.transition → options.transitions`（`video-synthesis.ts:52` 已支持）。

### P1-2 让 Face Validator 真正生效

- 兜底参考图：primary 无 `canonicalImageUrl` 时，回退用**首张已成功生成的同角色分镜图**当临时锚（写入运行态 map），让后续分镜有得比。
- 失败重试时退档策略：第 2 次重试改走 `reference_edit`（强制带参考图）+ 提高 prompt 中 `buildConsistencyGuard` 权重（`image-prompt.ts:99-111` 已现成），而非重复同 prompt（`image-orchestrator.ts:103` 处分支）。

### P1-3 TTS 情感 + 多角色音色

1. `TTSOptions` 加 `emotion?: string`（`types/ai.ts:83-88`）。
2. 火山 provider 请求体 `audio` 段加 `emotion`（`tts/volcengine.ts:34-39`，火山 bigtts 支持 happy/sad/angry 等）。
3. 自动管线把 `sceneArtifact.emotion` 透传（`workflow-engine.ts:620`）。
4. 多角色：scene.dialogue 升级为分句结构 `[{speaker, text}]`（或新增 `dialogueLines Json?`），按 speaker 取 voiceId 分段合成 → 多段音频 concat。CharacterBible 已产 `voiceProfile`（`character-bible-agent.ts:38-42`），可据此为新角色自动建议 voiceId。

### P2-1 风格模板系统（差异化）

新增 `StyleTemplate` 模型：`{ name, stylePrefix, negativePreset, lightingPreset, defaultShotRhythm, subtitleStyle Json, transitionPreset }`，预置「国漫古风/日系赛璐璐/写实电影/赛博朋克」四套。创建项目时选模板 → 一键灌满风格+negative+字幕+转场默认值。复用现成的 `STYLE_MAP`（`image-prompt.ts:6-17`）、`STYLE_NEGATIVE`（`negative-prompts.ts:38-49`）、`LIGHTING_MAP`。

### P2-2 生成历史/版本

新增 `SceneAsset` 模型（`{ sceneId, type: image|video|audio, url, isActive, createdAt, prompt, seed }`），出图不覆盖而是追加；scene.imageUrl 指向 isActive。前端可切换历史版本/收藏/回滚（属 ux 落地，但数据模型在本领域）。

### P2-3 批量重生成入口

基于现成 `generationQueue`（concurrency=3），加 `POST /api/projects/[id]/batch-generate`（body: sceneIds[] + type），复用 orchestrator。属引擎能力已具备，缺产品 API + 入口。

---

## 4. 行业标杆对标

| 能力                     | 本项目现状                                            | 即梦/可灵                 | Runway Gen-4                       | 剪映/CapCut 图文成片 | 差距判定                     |
| ------------------------ | ----------------------------------------------------- | ------------------------- | ---------------------------------- | -------------------- | ---------------------------- |
| **角色一致性**           | seed+参考图框架有，但三视图不绑定、validator 默认放行 | 角色定妆+锁定，跨镜一致强 | Gen-4 References（多参考图锁角色） | 弱（靠模板人物）     | **核心差距，且是可建壁垒处** |
| 镜头语言                 | 解析了但丢弃                                          | 运镜预设丰富              | 运动笔刷/相机控制                  | 模板化运镜           | 落后（数据已有，断链）       |
| 配音情感/多音色          | 无情感、单音色、自动管线还丢音频                      | 多音色+情感+多角色        | —                                  | 多音色+情感          | **明显落后**                 |
| 口型同步                 | 无                                                    | 部分支持                  | Act-One 表演迁移                   | 数字人对口型         | 缺失                         |
| 风格模板                 | 仅风格 key，无模板                                    | 丰富风格模板库            | —                                  | 海量模板             | 缺失                         |
| 版本/历史                | 覆盖式，无历史                                        | 有生成记录                | 有                                 | 有草稿/历史          | 缺失                         |
| 一键成片                 | 有骨架但产出哑片(P0)                                  | 成熟                      | —                                  | 成熟                 | **数据断链致不可用**         |
| 导出(转场/字幕/多分辨率) | **成熟**（xfade/force_style/480-1080p/多画幅）        | 成熟                      | —                                  | 成熟                 | **持平/局部领先**            |
| 批量生成                 | 引擎可并发，无入口                                    | 有                        | 有                                 | 有                   | 落后(易补)                   |

**差异化壁垒判断**：导出合成层（1.5）已是资产，不必追赶；真正能建立壁垒的是 **角色一致性闭环**——「定妆三视图绑定 → canonical 锚点 → 跨分镜参考图+seed → face-validator 真校验+退档重试」串成完整链路。这是漫剧（长篇连续剧情、同一批角色反复出现）相比通用 AI 视频工具（Pika/Runway 单镜头为主）的**结构性优势点**，且当前代码已有 70% 骨架，补齐断链即可领先。

---

## 5. 实施优先级与工作量（S/M/L）

| 顺序 | 任务                                | 工作量 | 价值 | 说明                                                                    |
| ---- | ----------------------------------- | ------ | ---- | ----------------------------------------------------------------------- |
| 1    | P0-1 自动管线 TTS 落库+按角色音色   | **S**  | 极高 | 改 `workflow-engine.ts:616-637`，~30 行，让一键成片不再哑片             |
| 2    | P0-2 三视图 i2i 绑定锚点            | **S**  | 极高 | 改 `generate-three-views/route.ts:144-169`，角色定妆地基                |
| 3    | P1-1 镜头语言端到端打通             | **M**  | 高   | Scene 加 6 字段(迁移) + storyboard prompt + 导出透传                    |
| 4    | P1-2 Face Validator 真生效+退档重试 | **M**  | 高   | 临时锚兜底 + 重试换 reference_edit                                      |
| 5    | P1-3 TTS 情感+多角色分句            | **M**  | 高   | TTSOptions 加 emotion + volcengine 透传；dialogueLines 结构化(L 的部分) |
| 6    | P1-4 运镜/duration 喂给视频         | **S**  | 中   | `workflow-engine.ts:579-587` 拼 cameraMovement、用真实 duration         |
| 7    | P2-1 风格模板系统                   | **M**  | 中   | StyleTemplate 模型 + 4 套预置 + 创建项目选模板                          |
| 8    | P2-2 生成历史/版本(SceneAsset)      | **L**  | 中   | 数据模型重构(image/video/audio 改追加式) + 出图链路改写                 |
| 9    | P2-3 批量重生成入口                 | **S**  | 中   | 复用 queue，新增一个批量 API                                            |
| —    | 口型同步 lip-sync                   | **L**  | 中   | 需接专用模型，长期项                                                    |

**最小见效切片**：1+2（合计 S+S，半天）即可让「一键成片有声 + 角色定妆可用」两个最痛点闭环，性价比最高。
