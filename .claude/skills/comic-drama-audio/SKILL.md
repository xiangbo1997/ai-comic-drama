---
name: comic-drama-audio
description: 漫剧表演与声音的行业标准——音色分配表驱动与项目内互斥、旁白恒中性、情绪语速区间、-14 LUFS 短视频响度目标、对白 ducking 默认必开、人声进混音前独立处理、中文字幕单行 15 字/最短驻留 1.2s、环境底噪场景级铺底、声音是主时间轴。当修改混音滤镜链、TTS 声线/情绪映射、字幕切分与驻留、音效/BGM 库、或任何影响音画时长关系的代码时加载。涉及文件：src/services/video-synthesis/filters/audio.ts、src/lib/tts-voice.ts、tts-emotion.ts、tts-request.ts、subtitle-segments.ts、sfx-library.ts、bgm-library.ts、emotion-bgm.ts。
---

# 漫剧表演与声音标准

## 铁律：声音是主时间轴，画面服从声音

配音时长决定镜头时长，不是反过来。

- 配音超长 → **优先延长镜头**（补静帧 / 放慢运镜 / 加一个反应镜）
- **截断配音绝对禁止**——半句话被切掉是最刺耳的成片缺陷
- 配音短于镜头 → 可用环境音与留白填充，或压缩镜头

改任何时长计算时，先确认这条链路没被反转。时长计算见
`src/lib/shot-timing.ts`（`estimateSpeechSeconds` 是对白驱动时长的基准）。

---

## 1. 音色分配：设定表驱动 + 项目内互斥

音色**不是随机分配也不是全用默认**，而是查表：

```
voice = lookup(gender × ageBand × personality)
```

然后加一层 **项目内互斥**：同一部剧里两个角色不得共用同一音色
（观众靠音色区分角色，撞音色等于角色合并）。分配到冲突时在候选表内取次优。

**系列剧音色绑定必须持久化**——第 2 集里同一角色换了声音，是最严重的连续性事故。
绑定落在 `Character.voiceId` / `Character.voiceProvider`。

**项目坐标**：`src/lib/tts-voice.ts`
- `normalizeVoiceFamily()` — 厂商家族归一（volcano / elevenlabs / gpt-sovits）
- `resolveDialogueVoiceId()` — **跨厂商防污染**：角色 voiceId 是火山专用串，
  激活配置若是别家会被当未知声线，家族不匹配时回落 provider 默认
- `resolveNarratorVoiceId()` — 旁白独立声线

⚠️ 手动 TTS 路由与 workflow 引擎**必须共用这套裁决逻辑**，否则两条配音路径行为漂移。

## 2. 旁白 vs 角色对白 vs 内心独白

三者是三套参数，不能混：

| 类型 | 情绪 | 语速 | 额外处理 |
|---|---|---|---|
| **旁白** | **恒中性**，不跟着剧情走 | 比对白**慢 5-10%** | 独立声线（说书人音色，与角色对白听感分离）|
| **角色对白** | 走情绪映射 | 愤怒/惊讶 **1.15-1.25x**；悲伤/恐惧 **0.85-0.95x**；中性 1.0x | — |
| **内心独白** | 走情绪 | 同对白 | **轻混响 + 音量低 2-3dB** |

**反例（必须避免）**：旁白跟着角色情绪走——旁白激动地喊出"就在这时，他愤怒了！"
是业余电台腔。旁白是叙述者，不是剧中人。

**项目坐标**：
- 情绪枚举与厂商映射：`src/lib/tts-emotion.ts`
  （`mapEmotionToVolcengine()` / `mapEmotionToElevenLabs()`）
- 请求组装：`src/lib/tts-request.ts`
- 旁白声线：`VOLCANO_NARRATOR_VOICE_ID`（`tts-voice.ts`）

改情绪映射时注意：**语速是情绪的函数，不是角色的函数**——
同一角色在不同镜头应有不同语速。

## 3. 响度目标：-14 LUFS（不是 -16）

```
loudnorm = I=-14 : TP=-1.0 : LRA=9
```

| 参数 | 值 | 理由 |
|---|---|---|
| I（整体响度）| **-14 LUFS** | 抖音/快手/YouTube 短视频的实际归一目标 |
| TP（真峰值）| **-1.0 dBFS** | 给平台二次转码留削峰余量 |
| LRA（响度范围）| **7-9** | 竖屏小喇叭下动态过大会让轻声对白听不清 |

**反例——用 -16 LUFS**：那是 **EBU R128 的广播/播客标准**，不适用于短视频。
按 -16 交片，成片在信息流里听感明显比别人小声。

**项目坐标**：`src/services/video-synthesis/filters/audio.ts` 的
`LOUDNORM_FILTER`（当前值正确，为 `-14`）。

⚠️ 已知文档债：该文件第 135 行与 204 行附近的注释仍写着"归一到 -16 LUFS"，
与常量 `-14` 不符，是历史遗留的过时注释。**以常量为准**，改到这段时顺手订正注释。

## 4. Ducking 默认必开

对白 ducking（BGM 侧链闪避）是**默认开启项**，不是可选增强。

| 参数 | 目标区间 | 项目当前值 |
|---|---|---|
| 衰减量 | **8-12 dB** | `ratio=8`（配合 threshold 达成）|
| attack | **5-15 ms** | `attack=20` ⚠️ 略高于推荐上限，起振偏慢，对白头字可能被 BGM 盖一瞬 |
| release | **250-400 ms** | `release=300` ✅ |
| threshold | — | `0.05`（从 0.03 提上来的，0.03 太灵敏，配音底噪就触发）|

滤镜链：`[bgmout][voice]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300`

**默认开的写法必须是 `bgm.ducking !== false`**，不能是 `=== true`——
历史落库配置可能缺该字段，缺省要落在"已闪避"一侧。项目当前实现正确
（`audio.ts:87`），改动时别把它翻过来。

**混音层级**：`voice > SFX > BGM > ambient`。
三层 amix 全部要带 `normalize=0`——`normalize=1`（默认）会把总响度按输入数拉平，
造成"分镜越多、对白越小声"的逐镜漂移（本项目出过这个 bug）。

## 5. 人声进混音前必须单独处理

`loudnorm` 只做**整体归一**，解决不了句内动态。人声轨在进 amix 之前应各自处理：

```
highpass(80-100Hz 去低频隆隆声)
  → compressor(控句内动态，比 loudnorm 精细)
  → de-esser(压齿音 5-8kHz)
  → EQ(2-4kHz 提清晰度)
```

**反例**：直接把 TTS 原始输出丢进 amix 再 loudnorm——
结果是轻声句子听不清、重音句子刺耳，整体却"响度达标"。

**项目坐标**：混音链构建在 `audio.ts` 的 BGM/SFX/voice 三层收口处。
补人声预处理时插在 voice 标签进 amix 之前。

## 6. 环境底噪是场景级持续铺底

环境音（雨声/街声/虫鸣）**不是点触发音效**，而是整场戏持续铺底：

- 电平 **-35 ~ -30 dBFS**（在对白之下，可感知但不抢）
- 覆盖整个场景时长，跨镜头连续（**换镜不能断**，断了观众会察觉空间跳变）
- 换场景时交叉淡入淡出，不硬切

**反例**：把 `ambient-rain` 当成一次性音效在某一镜触发一下——
雨声响一秒就没了，比不加更假。

**项目坐标**：`src/lib/sfx-library.ts`
- `SfxCategory` 含 `"ambient"` 分类，`SFX_CATEGORIES` 中 label 为"环境氛围"
- 条目如 `ambient-rain` / `ambient-street` / `ambient-night-crickets` / `ambient-thunder`
- 音量约定：一次性击打类 ~0.7，**环境铺底类 ~0.35**（见 `SfxEntry` 注释）
- BGM 库在 `src/lib/bgm-library.ts`，情绪→BGM 映射在 `src/lib/emotion-bgm.ts`

## 7. 中文字幕规格

| 项 | 值 | 说明 |
|---|---|---|
| 单行字数 | **≤ 15 全角字** | 项目常量 `MAX_SUBTITLE_LINE_WIDTH = 15` |
| 最大行数 | **2 行** | 超出应切句，不是缩字号 |
| 最短驻留 | **1.2 s** | 项目常量 `MIN_WINDOW_DURATION = 1.2` |

**反例——用 0.83s 最短驻留**：那是**英文**字幕的经验下限。
英文靠词形整体识别，中文需逐字扫视，0.83s 中文字幕根本读不完。

**项目坐标**：`src/lib/subtitle-segments.ts`（切分逻辑与两个常量）；
样式规范化 `subtitle-style-normalize.ts`、CSS 端 `subtitle-css.ts`、
字体 `subtitle-fonts.ts`、ASS 渲染 `src/services/video-synthesis/ass/builder.ts`。

⚠️ 改字幕切分或动效时，**ASS（导出）与 CSS（预览）两端必须同源同步**——
用户把预览当调试窗口，预览里看不见的效果等于没做。

## 8. 改这一域时的自检清单

- [ ] 时长关系有没有被反转（画面时长决定了配音）？
- [ ] 有没有任何路径会截断配音？
- [ ] 旁白的情绪是不是恒中性、语速是不是慢 5-10%？
- [ ] 响度目标是 -14 而不是 -16？
- [ ] ducking 是 `!== false`（默认开）吗？
- [ ] amix 全部带 `normalize=0` 吗？
- [ ] 环境音是整场铺底还是点触发？
- [ ] 字幕最短驻留 ≥1.2s、单行 ≤15 字？
- [ ] 导出侧改了效果，预览端（CSS/preview-player）同步了吗？
- [ ] 手动 TTS 路径与 workflow 路径行为一致吗？
