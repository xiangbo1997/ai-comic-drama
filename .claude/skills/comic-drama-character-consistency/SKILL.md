---
name: comic-drama-character-consistency
description: 漫剧角色一致性与美术设定的行业标准——角色设定表必备字段（头身比/发型三层/瞳孔高光/服装层次/不对称特征）、常服作为每张原画的默认约束、表情集必要性、质检闸门必须默认开启。当修改角色定妆/三视图/参考图合成/身份校验/画风包、或任何生成角色外观 prompt 的代码时加载。涉及文件：src/lib/prompts/canonical-appearance.ts、character-reference.ts、identity-check.ts、style-packs.ts、src/lib/three-views.ts、src/services/agents/character-bible-*.ts、src/services/generation/。
---

# 漫剧角色一致性与美术设定标准

## 核心判据：闸门默认开启、显式关闭

角色一致性的失败几乎总是同一个形态：**质检代码存在，但某条调用路径没传参数，
于是静默跳过**。本项目历史上出过多次"两条出图路径不对等"的问题。

写任何质检/校验时：

```ts
// ✅ 正确：默认开启，需显式关闭
if (options.identityCheck !== false) { ... }

// ❌ 错误：默认关闭，忘了传就失效
if (options.identityCheck === true) { ... }
```

同一个能力若存在多条调用路径（编辑器手动出图 / workflow 自动出图 / 重生成），
**每条路径都必须接同一个闸门**。改一条就要检查其余所有条。

---

## 1. 角色设定表必备字段

以下字段缺一不可，缺任何一项都会在跨镜头出图时漂移：

| 字段 | 要求 | 常见错误 |
|---|---|---|
| **头身比** | 设定表的**第一根线**，如 7 头身 / 5 头身 / Q 版 2 头身 | ❌ 把它当成画风级属性。头身比是**角色级**的——同一部剧里成人 7 头身、儿童 5 头身可以并存 |
| **发型三层标注** | ① 分缝方向（中分/左三七/无缝）② 刘海形状（齐刘海/空气刘海/斜刘海/无）③ 发尾处理（内扣/外翘/直切/层次） | ❌ 只写"黑色长发"——模型每次都画不同的分缝和刘海 |
| **瞳孔高光样式** | 高光形状与位置（单点/双点/星形/横条）、瞳色渐变 | ❌ 省略。眼睛是特写镜的主体，漂移最刺眼 |
| **服装材质与层次** | 由内到外逐层，每层写材质（棉/丝/皮革/金属）与版型 | ❌ 只写"校服"——领口、袖长、配饰全靠模型猜 |
| **左右不对称特征** | 疤痕/耳环/发饰/绷带在**哪一侧**，明确 left/right | ❌ 写"有疤"不写侧。镜像翻转后观众立刻察觉 |

**项目坐标**：规范字段序在 `src/lib/prompts/canonical-appearance.ts` 的
`CANONICAL_FIELD_ORDER`，拼装入口是 `buildCanonicalAppearanceFields()` /
`buildCanonicalAppearanceText()` / `buildCanonicalCharacterEntry()`。
注意 `hairColor` + `hairStyle` 在该文件里有合并逻辑（两者齐备时拼成一个短语）——
新增发型子字段时要走同一条合并路径，别在外面裸拼。

画风级锁定在同文件的 `STYLE_LIGHTING_LOCK`；画风包本身在 `src/lib/prompts/style-packs.ts`。
**头身比不要塞进画风包**——那会让整部剧所有角色同一头身比。

## 2. 常服是默认约束，不是换装才有

**standard outfit（常服）是每一张原画的默认约束。**

错误心智模型：「只有需要换装时才需要指定服装」。
正确心智模型：「每一次出图都必须带上该角色当前 look 的完整服装描述；
未指定场景装扮时，默认值就是常服，而不是空」。

服装为空 = 模型自由发挥 = 每镜换一套衣服。

**项目坐标**：
- `src/services/generation/character-look.ts` / `character-look-match.ts` — 角色 look 解析
- `src/services/generation/scene-looks.ts` / `scene-looks-match.ts` — 场景级装扮匹配
- 匹配不到场景装扮时，**必须回落到常服**，不能回落到空字符串

## 3. 三视图之外还需表情集

三视图（front / side / back，见 `src/lib/three-views.ts` 的 `THREE_VIEW_POSES`）
解决的是**结构一致性**，但**漫剧 80% 的镜头是表情特写**——三视图对表情帮助有限。

需要的是 **expression sheet（表情集）**：同一角色在若干情绪下的面部表现，
作为特写镜的参考锚。

情绪枚举与表现映射的真源在 `src/lib/prompts/emotion-grammar.ts`：
- `Emotion` 类型 + `EMOTION_ALIASES`（中文别名归一）
- `EXPRESSION_MAP` — 情绪 × 强度（low/medium/climax）→ 表情描述
- `SYMBOL_MAP` — 漫符（汗滴/怒纹/星星眼），**注意 `NO_MANGA_SYMBOL_STYLES`：
  写实类画风不允许漫符**，用 `packAllowsMangaSymbols()` 判断，别硬加

## 4. 多角色同框的参考图处理

多张定妆图直接喂 `/images/edits` 会被模型**融合重画**，导致角色都不像。

正确做法：用 sharp 把每个角色一张图**横向拼成一张带名字标签的合成图**再喂入。
触发判据是去重后角色数 ≥ 2（防止单角色三视图误触发）。

**项目坐标**：`src/services/generation/reference-composite.ts`（`buildReferenceCells`）。
改多角色出图路径时不要绕开它。

## 5. 身份校验与候选筛选

出图后应有身份校验闭环，而不是出了就用：

| 环节 | 文件 |
|---|---|
| 身份校验 prompt | `src/lib/prompts/identity-check.ts`（`IDENTITY_CHECK_SYSTEM` / `buildIdentityCheckPrompt`）|
| 校验结论落地 | `src/services/generation/identity-verdict.ts` |
| 人脸校验 | `src/services/generation/face-validator.ts` |
| 候选打分与择优 | `src/services/generation/candidate-scorer.ts` / `candidate-selection.ts` |
| 角色圣经观察者 | `src/services/agents/character-bible-observer.ts` |
| 视觉复核 | `src/services/agents/vision-reviewer.ts` |

**抽卡缓存必须带 seed**——无 seed 的缓存会让多次抽卡返回同一张却重复扣费
（本项目出过这个 P0）。

**定稿权威**：角色的最终定妆锚是 `canonicalImageUrl`。
判断角色是否已定妆用 `src/lib/character-finalized.ts` 的 `isCharacterFinalized()`，
批量检查用 `collectUnfinalizedCharacterNames()`——不要在各处重写这个判断。

## 6. 改这一域时的自检清单

- [ ] 新加的质检是 `!== false`（默认开）还是 `=== true`（默认关）？
- [ ] 出图有几条调用路径？全都接上这个闸门了吗？
- [ ] 头身比是按角色存的还是按画风存的？
- [ ] 服装为空时回落到常服了吗？还是回落到空串？
- [ ] 不对称特征写了 left/right 吗？
- [ ] 多角色同框走 `reference-composite.ts` 了吗？
- [ ] 写实画风下有没有误加漫符？
- [ ] 抽卡缓存 key 里有 seed 吗？
