---
name: comic-drama-shot-language
description: 漫剧分镜与镜头语言的行业标准——景别级差、对话戏三镜组、180° 轴线、景别与运镜正交、竖屏节奏曲线与 ASL 目标。当修改分镜解析 prompt、景别/运镜映射表、镜头时长计算、storyboard agent、或任何产出 shotType / cameraMovement / duration 的代码时加载。涉及文件：src/lib/prompts/image-prompt.ts、camera-movements.ts、limited-animation.ts、src/lib/shot-timing.ts、src/services/agents/storyboard*.ts。
---

# 漫剧分镜与镜头语言标准

## 核心判据：prompt 里写了 ≠ 被执行了

本项目把方法论写进了 prompt，但**几乎没有关卡验证方法论是否被执行**。
改这一域的代码时，第一个要问的问题永远是：**这条规则有没有对应的可判定校验？**
只往 prompt 里加一段中文规则而不加校验，等于没做。

---

## 1. 景别级差规则（可判定）

景别按"取景范围"排成有序档位：

```
特写(0) < 近景(1) < 中景(2) < 全景(3) < 远景(4)
```

**规则 A（跨档）**：相邻两镜的景别档位差 `|level[i] - level[i-1]| >= 1`。
**规则 B（不连坐）**：同一景别连续出现不得超过 2 镜。

违规示例（必须打回）：

| 镜序 | 景别 | 判定 |
|---|---|---|
| 1 中景 / 2 中景 / 3 中景 | 中景×3 | ❌ 违反规则 B |
| 1 中景 / 2 中景 | 差 0 | ❌ 违反规则 A |
| 1 远景 / 2 中景 / 3 特写 | 4→2→0 | ✅ |

**项目坐标**：景别中文键的权威列表在 `src/lib/prompts/image-prompt.ts` 的 `SHOT_MAP`。
注意该表混装了两类键——前 5 个是**景别**（特写/近景/中景/全景/远景），后 7 个是**机位角度**
（俯拍/仰拍/平拍/斜角/过肩/低角冲击/高角压迫）。做级差校验时**只能对前 5 个排序**，
把"俯拍"当景别参与级差计算是错的。

## 2. 对话戏标准三镜组

两人对话的正确镜头序列：

```
establishing wide（交代空间与相对位置）
  → OTS-A（过 A 肩拍 B）
  → OTS-B（过 B 肩拍 A）
  → reaction CU（听者的反应特写）
```

**反例——talking-heads（业余标志）**：整场戏都是"两人平拍中景"，靠对白推进，
镜头不动、不切过肩、无反应镜。这是 AI 生成漫剧最典型的失败形态。

判据：一场对话戏（≥3 镜且有 ≥2 个说话角色）中，若 `shotType === "中景"` 且
`cameraMovement === "static"` 的镜头占比 > 50%，即判定为 talking-heads，应告警。

过肩镜在本项目对应 `SHOT_MAP` 的 `过肩` 键（`over-the-shoulder shot, foreground shoulder blur, 85mm lens`）。
生成对话戏时**必须真的用上这个键**，不是在 prompt 里提一句"用过肩"。

## 3. 180° 轴线（越轴禁令）

两人对话时，在两人之间画一条假想轴线，**整场戏所有机位必须在轴线同一侧**。

具体到画面语义：
- A 在画面左侧、视线朝右 → B 必须在画面右侧、视线朝左；
- 这个左右关系**整场戏不得翻转**，包括特写镜。

**允许过轴的唯二方式**：
1. 插入一个中性镜（正面拍摄、无明确左右指向）作为缓冲；
2. 镜内走位过轴（角色在同一镜内走到对侧，观众看到了移动过程）。

除此之外的翻转 = 越轴，观众会瞬间失去空间感。

**落地要求**：生成分镜时需给每个对话角色记录画面侧位（left/right）与视线方向，
并在整场内保持一致；这个信息要进 prompt，否则出图模型会随机翻转。
相关上下文构建在 `src/services/agents/scene-character-context.ts`、
朝向逻辑在 `src/services/generation/facing.ts`。

## 4. 景别与运镜是两个正交字段

**必须分开存储，禁止合并成一个字符串。**

"大特写·急推" 不是一个景别，而是：

```ts
{ shotType: "特写", cameraMovement: "dolly_in" }
```

- 景别（`shotType`）：中文键，真源在 `image-prompt.ts` 的 `SHOT_MAP`
- 运镜（`cameraMovement`）：13 值英文枚举，**单一真源在 `src/lib/prompts/camera-movements.ts`
  的 `CAMERA_MOVEMENTS`**：
  `static / zoom_in / zoom_out / pan_left / pan_right / tilt_up / tilt_down /
   dolly_in / dolly_out / orbit / tracking / handheld / crane`

`video-prompt.ts` 重导出这两个符号，解析器 / 导演增强 / Zod 校验都消费同一份枚举——
**新增运镜值只能改 `camera-movements.ts`**，改别处会造成枚举漂移。

半动（limited animation）风格对运镜有额外约束，见
`src/lib/prompts/limited-animation.ts` 的 `LIMITED_ANIMATION_CAMERA_MOVEMENTS`
与 `HIGH_RISK_CAMERA_MOVEMENTS`（`isHighRiskCameraMovement()` 是现成判据）。

## 5. 竖屏短剧节奏曲线

单镜时长不是一个常数，而是随叙事段位变化的曲线：

| 段位 | 单镜时长 | 说明 |
|---|---|---|
| 开场 0-3s | **0.6-1.0s**，用 3-5 镜 | 留存生死线，必须密集切 |
| 铺垫段 | 2.5-4.0s | 允许喘息，交代信息 |
| 冲突升级段 | 从 2.5s **线性收敛**到 1.5s | 节奏收紧制造压迫 |
| 高潮段 | 0.8-1.5s | 最密集 |
| 结尾钩子 | 最后一镜 **2.5-3.5s** 留白 | 给观众消化与追更的停顿 |

**全片 ASL（平均单镜时长）目标：2.0-2.8s。**
ASL > 3.5s 基本等于节奏拖沓；ASL < 1.5s 则观众看不清内容。

**反例——凑时长**：把镜头时长拉长来凑总时长，是本项目历史上出现过的真实缺陷。
时长应由对白长度驱动（见下），不足就加镜头，不是拉长镜头。

**项目坐标**：`src/lib/shot-timing.ts`
- `estimateSpeechSeconds()` — 对白驱动时长的基准（中文 2.5 字/秒、英文 2.5 词/秒）
- `computeShotDuration()` — 单镜时长计算，`SHOT_TYPE_BASE` 是景别基准时长
- `SHOT_TYPE_DIALOGUE_MIN` — 有对白时的景别级下限（不能因为是特写就砍到说不完话）
- `ABSOLUTE_MIN = 1` / `ABSOLUTE_MAX = 60` 是硬边界
- `calibrateSceneDurations()` — 全片时长校准入口
- `isTrimExemptShot()` — 哪些镜头不参与压缩

**声音优先原则**：配音超长时优先延长镜头，**截断配音绝对禁止**。
详见 `comic-drama-audio` 技能。

## 6. 改这一域时的自检清单

- [ ] 新加的规则有没有对应的**可判定校验**（不是只写进 prompt）？
- [ ] 校验是**默认开启**的吗？还是"某条调用路径忘了传参就静默失效"？
- [ ] 改了运镜枚举，是否只改了 `camera-movements.ts` 单一真源？
- [ ] 景别级差校验是否只对 5 个真景别排序，排除了机位角度键？
- [ ] 时长改动后 ASL 还在 2.0-2.8s 吗？
- [ ] 是否引入了 talking-heads（中景 + static 占比过半）？
