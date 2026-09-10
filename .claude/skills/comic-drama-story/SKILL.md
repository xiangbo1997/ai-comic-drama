---
name: comic-drama-story
description: 爆款短剧剧本与叙事的行业标准——三秒钩子/15 秒情绪点/结尾断口三道质检闸，写与审强制分离且审有否决权，单集必须留钩，冲突阶梯与预埋反转。当修改剧本解析/短剧创作 prompt、叙事观察者、审片报告、集数结构与钩子轮换、改编外化规则、或系列故事圣经时加载。涉及文件：src/lib/prompts/episode-structure.ts、adaptation-rules.ts、script-parse.ts、agent-prompts/（drama-script/script-parser/narrative-review/storyboard-table）、src/lib/review-report.ts、src/services/agents/narrative-observer.ts、src/services/series/。
---

# 爆款短剧剧本与叙事标准

## 核心判据：写与审必须分离，且审有否决权

这是本域最重要的一条，也是本项目当前**最大的结构性缺口**。

- **写**：`drama-script-agent.ts` / `script-parser-agent.ts` 产出剧本与分镜
- **审**：`narrative-observer.ts`（`reviewStoryboard` / `reviewVideoSequence`）、
  `agent-prompts/narrative-review.ts`、`src/lib/review-report.ts`

⚠️ **现状缺口**：`review-report.ts` 的产出目前只在导出面板
（`editor/[id]/components/export-dialog/ReviewReportSection.tsx`）**展示**，
通过 `GET /api/projects/[id]/review-report` 只读拉取。
它**没有任何阻断能力**——评级 D 也照样能导出。

「审有否决权」意味着：**三道闸不过就打回重写**，而不是给用户看一眼红字。
在这一域加规则时，先问：这条规则能否决什么？如果不能，它就只是装饰。

---

## 1. 三道质检闸（不过就打回）

### 闸一：三秒钩子是否成立

第一个分镜必须是本集**冲突最高点或悬念最强**的画面。

**明确禁止**（这些是判定为不成立的形态）：
- 风景空镜开场
- 起床/走路等日常铺垫
- 旁白介绍世界观
- "从前有个人"式顺叙
- 第一句台词是自我介绍或背景说明

**必须满足**：
- 第一句台词制造信息差或认知冲突（身份悖论/极端羞辱/威胁/反常识宣言）
- 开场 10 秒内 3-5 个分镜
- 首场景出场角色 ≤3 人

项目常量：`REDLINE_HOOK_WINDOW_SEC = 3`（`review-report.ts`）——
前 3 秒内须有冲突/钩子镜。

### 闸二：每 15 秒是否有情绪点

**判据：任意连续 30 秒无情绪事件即告警**（`REDLINE_EMOTION_GAP_SEC = 30`）；
目标密度是**每 15-20 秒一个小高潮或新信息增量**，每 30 秒一个剧情爆点。

节奏骨架：
```
0-3s 钩住 → ~6s 进入冲突 → ~10s 抛出悬念 → ~30s 第一个爽点
→ 60s 内完成一次情绪爆发（打脸/逆袭/揭秘）→ 结尾 10-15s 设下集钩子
```

**禁止信息真空**：连续分镜无新信息。

情绪事件的判定依据是分镜的 `narrativeBeat`（impact/reveal/emotional/calm）、
高潮镜标记、`emotion` 标签——见 `ReviewScene` 接口。
新增情绪点检测时要从这三个字段读，别另起一套。

### 闸三：结尾是否留断口

**每集必须留钩，含第 1 集**（这条无条件适用，是治"凑时长"的源头规则）。

五类钩子，从中选一：

| 类型 | 定义 |
|---|---|
| 悬念钩 | 关键疑问不答 |
| 反转钩 | 最后一刻颠覆 |
| 情绪钩 | 情绪推顶后切断 |
| 信息钩 | 关键信息只说一半 |
| 危机钩 | 突发威胁 |

**轮换约束**：连续 3 集禁用同一类型。系列上下文提供"近 N 集钩子类型"时必须避开。
**下一集开头不得立即完全化解上集钩子。**

钩子分类与 `types/series-bible.ts` 的 `HOOK_TYPES` 对齐，供史官
（`src/services/series/chronicler.ts`）读取。

---

## 2. 冲突阶梯与反转纪律

### 矛盾四级阶梯

每集主冲突**至少到第 2 级**，高潮集用 3-4 级：

1. 基础对立（欲望 vs 阻碍成立但弱）
2. 强化二选一（强欲望 + 强阻碍 + 不可调和的两难）
3. 高级立场冲突（两个好人因不同选择走向不同命运——**立场冲突而非善恶冲突**，没有绝对好坏人）
4. 升级不可逆后果（主角为解初始矛盾的行动招致回不了头的代价）

**关键区分**：矛盾是内在「想要而得不到」，冲突是外在对抗行为。
**反例——堆吵架**：靠角色互相怒吼来"制造冲突"，矛盾等级却始终停在 1 级。

### 反转三式与铁律

三式：预期误导（不藏信息，只用思维定式引导出合理的错误结论）/
人设颠覆（**只能用在配角**，绝不动主角核心底色）/ 动机置换。

**铁律**：
- 反转必须**提前预埋线索**，揭晓时观众能回想起伏笔
- 禁止无预埋的凭空反转、空降硬凹结局
- **单集反转 ≤1 次**
- **反转 ≠ 钩子**：钩子是断点悬而未决，反转是对已知的颠覆

### 反同质化

赘婿被辱、当众摊牌亮身份、闪婚霸总、认亲胎记、三个巴掌等烂大街桥段
**不得原样照搬**，必须至少做一处变形——换动机 / 换场域 / 换代价。

**项目坐标**：以上全部在 `src/lib/prompts/episode-structure.ts` 的四个常量块
（`EPISODE_HOOK_RULES` / `EPISODE_PACING_RULES` / `EPISODE_ENDING_RULES` /
`EPISODE_CONFLICT_RULES`）+ `SHOT_RHYTHM_RULES`，
经 `buildEpisodeStructureBlock()` 组合注入。
**这是单一真源，由小说解析路径与短剧创作路径共享**——改规则只改这里。

---

## 3. 改编外化：小说 → 剧本的核心工序

小说的内心戏必须**外化**为可拍的动作、表情、对白、道具。
直接把心理描写塞进旁白，是最常见的改编失败。

**旁白纪律：旁白是最后手段，严控占比。**
凡是能用画面/动作/对白表达的，都不用旁白。

**反例——talking-heads 的叙事成因**：没有做外化，
于是所有信息都靠角色站着互相说，画面无事可拍。
（视觉层的判据见 `comic-drama-shot-language` 技能。）

**项目坐标**：`src/lib/prompts/adaptation-rules.ts`
- `EXTERNALIZATION_RULES` — 内心戏外化
- `NARRATION_DISCIPLINE_RULES` — 旁白纪律
- `buildAdaptationBlock()` — 组合入口

---

## 4. 台词与时长纪律

| 项 | 值 | 项目常量 |
|---|---|---|
| 台词密度 | 12-18 句/分钟 | — |
| 单句字数 | **≤15 字**口语化短句 | `REDLINE_DIALOGUE_MAX_CHARS = 15` |
| 每分钟镜数 | 15-25 镜 | `SHOTS_PER_MIN_MIN/MAX` |
| 单集总时长 | ≤180s（告警线 168s）| `REDLINE_TOTAL_SEC_BAD/WARN` |
| 无对白空镜 | ≤8s | `SILENT_SHOT_MAX_SEC` |
| 静止长镜 | >4s 且无运动即建议加镜内运动 | `REDLINE_STATIC_SHOT_SEC` |

每个反转场景配一句**可独立传播的金句**。

⚠️ 两套时长阈值不可混用（`review-report.ts` 已注明）：
- `MICRO_DRAMA_MAX_SEC = 20*60` 是**法规**定义的微短剧边界
  （关系办法第二十七条片头标注、第三十四条 AI 标识是否适用）
- `REDLINE_TOTAL_SEC_BAD = 180` 是**平台投流**建议上限

---

## 5. 系列连续性

系列剧的故事圣经是永久记忆，不是每集重新推导：
- 圣经合并 `src/services/series/bible-merge.ts` / `src/services/agents/character-bible-merge.ts`
- 史官（跨集记忆写入）`src/services/series/chronicler.ts`
- 系列参数继承白名单 `src/lib/series.ts`
- 跨集记忆注入 `src/lib/series-memory.ts`

存量系列需 POST chronicler 冷启动才有记忆。

---

## 6. 改这一域时的自检清单

- [ ] 新加的规则有**否决权**吗？还是只是展示一行红字？
- [ ] 规则加在 `episode-structure.ts` 单一真源里，还是散落在某条管线的 prompt 里？
- [ ] 两条叙事管线（小说解析 / 短剧创作）都会消费到吗？
- [ ] 第 1 集也强制留钩了吗（不能豁免）？
- [ ] 钩子类型有轮换约束吗（连续 3 集禁同型）？
- [ ] 反转有预埋检查吗？单集反转 ≤1 次吗？
- [ ] 情绪点检测读的是 `narrativeBeat`/高潮标记/`emotion` 三字段吗？
- [ ] 时长阈值用对了那一套（法规 20min vs 投流 180s）？
