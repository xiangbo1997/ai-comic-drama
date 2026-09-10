---
name: comic-drama-export-spec
description: 漫剧成片导出与剪辑的技术规格——竖屏 1080×1920 平台 UI 安全区、字幕安全落点、抖音/快手码率档位、中间产物近无损而只在末次编码定码率、90% 硬切的转场原则。当修改 ffmpeg 参数、导出管线、转场/运动滤镜、字幕水印定位、片头卡/封面、或剪映草稿导出时加载。涉及文件：src/services/video-synthesis.ts、src/services/video-synthesis/（filters/、ass/、ffmpeg-run.ts、media-ops.ts）、src/lib/safe-area.ts、title-cards.ts、color-grade.ts、jianying-draft.ts。
---

# 漫剧导出与剪辑技术规格

## 1. 竖屏平台 UI 安全区（1080×1920 / 9:16）

平台会在画面之上叠自己的 UI，落在这些区域的字幕/水印/AI 标识会被**整块盖住**，
而且**只有真机发布后才暴露**——网页预览里一切正常。

| 区域 | 像素 | 归一化 | 被什么遮挡 |
|---|---|---|---|
| 顶部 | 0-260px（13.5%）| `top = 0.135` | 状态栏 + 平台顶部 Tab（推荐/关注/同城）|
| 底部 | 下 20%（384px）| `bottom = 0.80` | 作者昵称 + 文案 + 话题 + 播放进度条 |
| 右侧 | 150px（14%）| `right = 0.86` | 右侧竖排互动按钮（头像/点赞/评论/收藏/分享）|

**内容可用区**：纵向 `[0.135, 0.80]`，横向 `[0.14, 0.86]`（左右对称）。

**字幕安全落点**（比通用安全区更保守，字幕是逐帧可读性要求最高的元素）：

```
y ∈ [0.16, 0.78]     x ≤ 0.82
```

**项目坐标**：单一真源在 `src/lib/safe-area.ts`
- `VERTICAL_SAFE` = `{ top: 0.135, bottom: 0.8, right: 0.86 }`
- `VERTICAL_SAFE_LEFT` = `1 - right`
- `clampSafeY()` / `clampSafeX()` — 所有贴边元素的默认位置与拖拽落点**都必须过这两个 clamp**

⚠️ 该文件的 clamp 范围比字幕推荐落点略宽（0.135/0.80 vs 0.16/0.78）。
字幕的**默认**位置应取更保守的 `[0.16, 0.78]`；`clampSafeY` 作为最外层兜底。

⚠️ 横屏/方形项目不做画幅分支——统一套同一安全区保证跨画幅一致，
代价仅是少量留白。**不要为 16:9 单开一套 clamp**，那会造成两套阈值漂移。

## 2. 码率与编码档位

### 交付码率（末次编码）

抖音/快手 1080p 推荐 **8-12 Mbps**。

| 档位 | 尺寸 | 码率 |
|---|---|---|
| 480p | 480×854 | 2M |
| 720p | 720×1280 | 5M |
| 1080p | 1080×1920 | **10M** ✅ 落在 8-12 区间 |

**反例——按点播长视频档位给（1M/2.5M/5M）**：漫剧画面线条纹理密集、
运镜快，低码率下大面积色块会糊；平台还要二次转码，交片码率越低损失越明显。
思路是「留给平台压」。

配套约束（`buildOutputEncodingArgs`，`src/services/video-synthesis.ts`）：
- `-maxrate` = 1.5× bitrate，`-bufsize` = 2× bitrate ——
  只给 `-b:v` 时 x264 的 ABR 在高动态段（快速运镜、转场、震屏）会瞬时超标
- `-profile:v high -level 4.1` —— 覆盖 1080p60，各平台与移动端通行档；
  不声明时 x264 可能选出老设备解不了的组合
- mp4 走 `libx264 + aac + faststart`；webm 走 `libvpx-vp9 + libopus`
  （**注意 webm 不支持 faststart，也不能用 libx264**）

### 中间产物：近无损，不定码率

**原则：中间产物用 `-crf` 近无损，只在最后一次编码定码率。**

每一次中间编码都会白掉一轮画质。分段拼接、变速、加字幕等中间步骤若走默认
CRF 23（面向交付的档位），到成片时已经叠了多轮损失。

行业目标值 **`-crf 16`**；项目当前 `CLIP_CRF = "18"`（`video-synthesis.ts:372`）。
18 已远好于默认 23，但**若中间编码轮次较多（≥3 轮），应收到 16**。
改这个常量时它同时影响多处（774/836/864 行），是单一真源，别在别处裸写 crf。

## 3. 转场原则：90% 硬切

**专业剪辑 ≈ 90% 硬切 + 少量有动机的转场。**

"有动机"指转场承担叙事功能：
- 时间跳跃 → 淡入淡出 / 白闪
- 空间转移 → 划像 / 推移
- 情绪转折 → 叠化

**反例——滥用 xfade**：给每两个镜头之间都加交叉溶解，是最典型的业余标志。
观众感知到的是"每个镜头都黏在一起"，节奏被抹平，冲突段完全失去冲击力。

判据：转场镜数 / 总镜数 > 10% 即应告警。尤其在高潮段，转场应趋近 0——
高潮靠硬切的速度感，任何溶解都是在踩刹车。

**项目坐标**：
- 运动/转场滤镜 `src/services/video-synthesis/filters/motion.ts`
  （注意帧率归一 `fps=30` 恒挂链尾，消除 xfade 因帧率不齐的抖动）
- 调色 `filters/color.ts` + `src/lib/color-grade.ts`
- ⚠️ **注入片头卡后 transitions 索引会位移**——`src/lib/title-cards.ts` 与转场
  数组是两个按镜序对齐的列表，插卡时必须同步偏移，否则转场全部错位

## 4. 导出管线结构

| 环节 | 文件 |
|---|---|
| 主编排 + 码率/尺寸/编码参数 | `src/services/video-synthesis.ts` |
| ffmpeg 进程封装 | `src/services/video-synthesis/ffmpeg-run.ts` |
| 媒体探测/下载/裁剪 | `media-ops.ts` |
| 音频混音链 | `filters/audio.ts`（见 `comic-drama-audio` 技能）|
| 运动/转场 | `filters/motion.ts` |
| 调色 | `filters/color.ts` |
| ASS 字幕渲染 | `ass/builder.ts` |
| 片头卡/编号位 | `src/lib/title-cards.ts` |
| 封面 | `src/lib/cover.ts` / `src/services/cover.ts` |
| 剪映草稿导出 | `src/lib/jianying-draft.ts` / `src/services/jianying-draft.ts` |
| 导出进度 | `src/lib/export-progress.ts` |

**时长必须以实测为准**：视频模型（如 Veo）常忽略请求时长，实出与请求不符。
全时轴要走 `ffprobe` 实测，不能信请求参数——否则 xfade 会坍塌。
这是本项目修过的真实缺陷。

## 5. 预览必须反映所有效果

用户把预览当调试窗口。**任何导出侧的视觉效果，必须同步在预览端可见**，
否则这个功能没做完。

导出侧（ASS / ffmpeg 滤镜）与预览侧（CSS / `preview-player.tsx`）
应共享同源常量——字幕样式、动效、安全区、调色都是如此。
只改一端 = 制造了一个只有导出后才能发现的差异。

## 6. 改这一域时的自检清单

- [ ] 新增的贴边元素过 `clampSafeX/Y` 了吗？
- [ ] 字幕默认落点在 `y ∈ [0.16, 0.78]`、`x ≤ 0.82` 内吗？
- [ ] 1080p 码率还在 8-12 Mbps 吗？
- [ ] 新增的中间编码步骤给 `-crf` 了吗（还是漏了走默认 23）？
- [ ] 加了几个转场？转场率超 10% 了吗？高潮段有转场吗？
- [ ] 改了片头卡插入逻辑，transitions 索引同步偏移了吗？
- [ ] 时长取的是 ffprobe 实测还是请求参数？
- [ ] webm 分支有没有误用 libx264 / faststart？
- [ ] 导出侧的视觉改动，预览端同步了吗？
