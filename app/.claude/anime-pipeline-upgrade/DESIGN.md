# AI 漫剧管线专业化升级设计

> 执行者：Claude Code ｜ 日期：2026-07-12
> 依据：三份调研（动漫工业流程 / 专业小说方法论 / 小说→动漫改编）+ 当前代码现状精读
> 目标：让当前 7 步管线产出「专业级」而非「业余级」动漫短剧

---

## 0. 核心洞察（三份调研的共同主线）

专业质量 **不来自单一环节出彩**，而来自一条链：

> **上游锁定一份 artifact → 下游每一步被它硬约束 → 每步有专人拿输出对着 artifact 做门禁复查 → 不达标打回重做。**

业余 AI 管线：独立生成每个镜头，祈祷一致。
专业 AI 管线：让「不一致」在结构上无法发生。

**每一个"一致性问题"本质都是"缺 artifact"或"缺门禁"问题。**

---

## 1. 当前项目已具备的专业能力（不要重造）

| 专业概念                     | 当前实现                                                        | 位置                                              |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| 系列构成 / 故事圣经          | `SeriesStoryBible` + 史官增量更新 + 4 注入点                    | `types/series-bible.ts` `lib/series-memory.ts`    |
| 人设表 / 角色卡              | `CharacterBible` + canonicalPrompt + 三视图 + seed 复用         | `character-bible-agent.ts`                        |
| 作画监督门禁（部分）         | Vision Reviewer 5 维评审 + Observer 闭环重生成                  | `vision-reviewer.ts` `image-consistency-agent.ts` |
| 爆款方法论（人设/钩子/节奏） | `episode-structure.ts` 四块规则注入两条解析路径                 | `lib/prompts/episode-structure.ts`                |
| 结构化分镜 spec              | 13 值 `cameraMovement` 枚举 + `actionBeat` + 景别/情绪/光线字段 | `video-prompt.ts` `script-parser.ts`              |
| 视频导演（运动+记忆）        | `directVideoScene` 带 prev/next/角色/跨集记忆                   | `workflow-engine.ts`                              |

**结论：项目已领先绝大多数 AI 漫剧工具。缺的是三处结构性断裂的修补，不是从零搭建。**

---

## 2. 三处结构性断裂（本次要修的核心）

### 断裂 A：色彩设计（色彩設計）未锁定、未门禁、被丢弃

**专业做法**：色彩设计师锁定整集/整部的 master palette（含日/夜/黄昏/阴影各光照下的确切颜色），此后没人能画到调色板之外；per-episode 色指定必须在既定色调内工作或显式扩展。

**当前断裂**：

- `colorPalette` 是**每镜独立**由 LLM 解析的自由文本，镜与镜之间可以完全不同 → "每个镜头色调都不太一样"。
- 视频端 `video-prompt.ts` **刻意省略 colorPalette**（注释写"首帧已携带，二次描述会漂移"）——治标，但根因是从没有一份 series/episode 级锁定的调色板。
- 没有任何门禁检查生成图色调是否服从统一 palette。

**设计（修法）**：

1. `SeriesStoryBible.worldSetting` 已有 `visualGuideline`。**新增结构化 `colorScript`**：series 级 master palette（keyColors + 光照变体 + 情绪→色调映射）。史官收官时增量沉淀。
2. 出图 prompt 构建（`buildEnhancedPrompt` / storyboard imagePrompt）**统一前置注入 series palette**，每镜的 `colorPalette` 降级为"在 master palette 内的局部偏移"，而非独立自由发挥。
3. Vision Reviewer 增加 **palette 一致性维度**（生成图主色调 vs master palette），偏离超阈值计入 feedback。

**优先级：P1**（一致性最大杠杆，仅次于角色卡）

---

### 断裂 B：改编阶段缺失（散文→剧本的"外化转换"跳过了）

**专业做法**：小说 → 剧本不是直切分镜。中间有一道 **prose→screenplay 转换**：把"内心独白/叙述/反思"路由到三个通道之一——① 可见动作（默认最强）② 对白+潜台词 ③ 旁白（最后手段，<10% 场景）。否则 CUT。这道工序是防 talking-heads / 角色崩人设 / 说教旁白的根因。

**当前断裂**：

- 小说文本被 `script-parser` **直接**切成分镜；`narration`（旁白）被**原样保留**丢给 TTS。
- 没有"内心戏外化"这一步 → 小说里大段内心独白要么变成大段旁白（说教），要么丢失（角色动机崩塌，行为变 off-model）。

**设计（修法）**：
两个可选强度，本次落地**轻量版（prompt 层增强，零新 agent）**：

1. 在 `script-parser` 系统 prompt 注入 **"外化转换规则块"**（新建 `adaptation-rules.ts`）：
   - 内心独白优先转为可见动作/表情/反应镜头（externalization catalog 精选 8-10 条：紧张→摆弄手指 insert、领悟→缓推特写+线索 insert、孤独→大远景+负空间…）。
   - 旁白（narration）占比硬约束：≤ 场景数的 20%，且只在无法用画面承载时保留。
   - 禁止 action 描述里出现"他觉得/她想/意识到"这类不可拍摄的内心状态。
   - 每场景必须有 value charge shift（+→− 或 −→+）。
2. `narrative-review.ts` 评审维度增加 **externalization 分**（旁白是否过量、是否有说教式 telling）。

**优先级：P1**（叙事质量最大杠杆）

---

### 断裂 C：对白-时长-镜头三者未绑定

**专业做法**：分镜阶段每 cut 有确切秒数（导演拿秒表掐到 1/24 秒）；对白镜时长 = 台词时长（中文 ~2.5 字/秒）；快节奏冲突镜 1-2s、铺垫镜 2-4s。语音、字幕、视频长度三者锁死。

**当前断裂**：

- `duration` 由 LLM 拍脑袋填 1-60s，与对白字数无确定性关系。
- 历史反复修的"视频时长对齐"bug（memory 有记录）本质就是这个断裂的下游：Veo 忽略请求时长、导出 xfade 坍塌、预览黑屏——都是因为上游 duration 本就不是"对白驱动的确定值"。

**设计（修法）**：

1. 新建纯函数 `lib/shot-timing.ts`：`computeShotDuration({ dialogue, narration, shotType, emotion, hasAction })`
   - 有对白：`max(dialogueDuration, minByShotType)`，`dialogueDuration = ceil(charCount / 2.5)`（中文），英文按词数估。
   - 无对白：按景别+情绪派生（冲突/反转特写 1.5-2s、铺垫全景 2-4s、情绪特写 2-3s）。
   - 与现有 `episode-structure.ts` 的 SHOT_RHYTHM_RULES 数值对齐。
2. 解析/分镜落库时，用该函数**校准 LLM 给的 duration**（LLM 值与算出值取更贴近叙事的：有对白强制不短于对白时长）。
3. 保持与视频分段器、TTS、导出时轴的既有对齐逻辑兼容（只改上游 duration 来源，下游不动）。

**优先级：P1**（修复长期反复出现的时长类 bug 的根因）

---

## 3. 增量增强（P2，锦上添花，本轮视预算落地）

| 项                                  | 专业依据                                     | 落地点                                                 |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| **SFX/音效 spec**                   | 专业分镜每 cut 标 SE/BGM；动态漫"80% 靠声音" | Scene 加 `soundEffect?` 字段 + prompt 产出；导出时映射 |
| **coverage 顺序纪律**               | establishing→master→coverage→insert→reaction | storyboard prompt 注入镜序规则                         |
| **shot-size × 情绪映射硬化**        | wide=孤立 / close=情绪 / ECU 稀用            | script-parser prompt 明确景别选择依据                  |
| **付费卡点/情绪峰值密度**           | 每 3 min 情绪峰、每集末 10-20s 落爽点        | episode-structure 补充节奏门禁                         |
| **编辑评分 rubric（LLM-as-judge）** | 9 维 + 硬门禁（开篇/节奏 ≤3 直接 reject）    | 新建剧本级评审 agent，采数据模式                       |

---

## 4. 落地顺序与派单方案

**本轮落地（P1 三修 + P2 精选）**：

| 批次 | 内容                                                                 | 文件                                                                                                      | 风险                                                    |
| ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 批1  | 断裂C：`shot-timing.ts` 纯函数 + 解析落库校准                        | 新建 `lib/shot-timing.ts`；改 `script-parser-agent.ts` / `script-parse.ts` / workflow 落库                | 低（纯函数+单测）                                       |
| 批2  | 断裂B：`adaptation-rules.ts` 外化规则块 + 注入解析 prompt + 评审维度 | 新建 `lib/prompts/adaptation-rules.ts`；改 `script-parser.ts` / `script-parse.ts` / `narrative-review.ts` | 低（prompt 层）                                         |
| 批3  | 断裂A：`colorScript` 结构化进圣经 + 出图注入 + palette 门禁          | 改 `series-bible.ts` / `series.ts`（digest）/ `prompt-builder.ts` / vision-reviewer prompt                | 中（schema 改，需 db push 兼容——圣经是 Json，向后兼容） |

**验证**：每批 `pnpm type-check` + 相关单测；全部完成后 `pnpm test` + `pnpm build`。
**部署**：本地验证绿后，按用户"三方一致"或"远端直改"习惯询问部署方式（不擅自 push/上线）。

---

## 5. 有意不做（避免过度工程）

- **不新建独立 adaptation agent**：轻量 prompt 增强已覆盖 80% 收益；独立 agent 增加一次 LLM 往返成本与失败面，待数据验证后再上。
- **不做 layout 预锁（低分辨率构图预生成）**：ROI 低，当前 i2i 参考图已部分覆盖。
- **不改视频分段/导出时轴**：断裂 C 只改 duration 来源，下游对齐逻辑已成熟，不动。
- **不引入 controlnet/pose 预生成**：超出当前 provider 能力边界。
