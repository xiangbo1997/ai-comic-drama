# 批次5 技术方案 — 字幕样式 / 贴图 / 原创商标水印

> 生成日期：2026-06-16 · 执行者：Claude Code · 性质：新增产品能力（差异化卖点）
> 决策：三个能力一起规划、逐个落地；字幕样式 **全片统一**（project 级）。
> 落地：SSH 改线上 `/software/ai-comic-drama/`，build + 重启 systemd。

## 0. 地基现状（已核实，三能力均可行且零 schema 变更）

| 现状                                                             | 位置                                          | 对批次5 的意义                                            |
| ---------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| 系统 `ffmpeg` spawn + `-vf` 滤镜链 + `filter_complex`(xfade)     | `services/video-synthesis.ts:362-412`         | 字幕/贴图/水印都挂在这条链上，无需重构                    |
| 字幕已用 `subtitles='x.srt'`（仅默认样式）                       | `video-synthesis.ts:376`                      | 加 `force_style` 即得样式调整，零新依赖                   |
| `Project.generationParams Json @default("{}")`                   | `schema.prisma:120`                           | 存字幕样式/水印/贴图配置，**无需改 schema、无需 db push** |
| `uploadToR2` / `getPresignedUploadUrl`                           | `services/storage.ts:58/149`                  | 贴图/logo 上传直接复用                                    |
| 导出 API: `request.json()` → `ExportOptions` → `synthesizeVideo` | `api/projects/[id]/export/route.ts:48/99/110` | 加字段即贯通前端→FFmpeg                                   |

**关键结论**：三个功能全部 = 纯 FFmpeg 滤镜参数 + 现有 R2 + 现有 JSON 字段。零新依赖、零 schema 变更。

---

## 1. 字幕样式调整（全片统一，最先做，ROI 最高）

### 数据

存 `Project.generationParams.subtitleStyle`：

```ts
interface SubtitleStyle {
  fontSize: number; // 默认 24
  fontColor: string; // hex，默认 #FFFFFF
  outlineColor: string; // hex，默认 #000000
  outlineWidth: number; // 默认 2
  position: "top" | "middle" | "bottom"; // 默认 bottom
  bold: boolean;
  backgroundBox: boolean; // 半透明底框
}
```

### FFmpeg 改法（video-synthesis.ts）

`ExportOptions` 加 `subtitleStyle?: SubtitleStyle`。L376 的 subtitles 滤镜改为带 `force_style`（ASS 样式语法）：

```ts
const hexToAss = (hex: string) => {
  /* #RRGGBB → &H00BBGGRR */
};
const alignment = { top: 8, middle: 5, bottom: 2 }[style.position];
const force = [
  `FontSize=${style.fontSize}`,
  `PrimaryColour=${hexToAss(style.fontColor)}`,
  `OutlineColour=${hexToAss(style.outlineColor)}`,
  `Outline=${style.outlineWidth}`,
  `Alignment=${alignment}`,
  style.bold ? "Bold=1" : "Bold=0",
  style.backgroundBox ? "BorderStyle=4" : "BorderStyle=1",
].join(",");
videoFilter += `,subtitles='${srt}':force_style='${force}'`;
```

注意：`force_style` 是 libass 的 ASS 样式语法；颜色是 `&HAABBGGRR`（BGR 顺序，含 alpha）。

### 前端

ExportDialog（或独立"字幕样式"弹窗）加样式表单：字号滑块、颜色选择器、描边、位置三选、加粗/底框开关 + 实时预览条。提交时写 `generationParams.subtitleStyle`（PATCH project）。
**全局一致性检查**：导出弹窗 + 时间轴选中字幕轨时的样式入口要指向同一份 project.subtitleStyle。

---

## 2. 原创商标 / 水印（全片固定角标，第二做）

### 数据

存 `Project.generationParams.watermark`：

```ts
interface Watermark {
  enabled: boolean;
  imageUrl: string; // R2 上传的 logo PNG（建议透明底）
  position: "tl" | "tr" | "bl" | "br" | "center"; // 角位
  opacity: number; // 0-1，默认 0.8
  scale: number; // 相对画面宽度百分比，默认 0.12
}
```

### FFmpeg 改法

logo 作为额外 `-i` 输入，在最终合成 filter_complex 加 `overlay`：

```ts
// 下载 logo 到本地 → 作为输入 [N:v]
// scale logo 到 主画面宽 * scale，再 overlay 到角位
// 形如: [logoIdx:v]scale=iw*S:-1,format=rgba,colorchannelmixer=aa=OPACITY[wm];[base][wm]overlay=X:Y
```

位置映射：tr=`W-w-20:20`，br=`W-w-20:H-h-20` 等。需把 videoFilter（字符串 -vf）改造成 filter_complex（因为要多输入 overlay）——这是字幕+水印共存时的合并点，需统一成一条 filter_complex 链。

### 前端

导出弹窗"品牌水印"分节：开关 + 上传 logo（复用 R2 `getPresignedUploadUrl`）+ 位置九宫格选择 + 透明度/大小滑块 + 预览。

---

## 3. 贴图（按分镜/时间点叠加，最复杂，最后做）

### 数据

存 `Scene` 级（每镜可不同贴图），或新 `generationParams.stickers` 数组：

```ts
interface Sticker {
  id: string;
  imageUrl: string; // R2 贴图 PNG
  sceneId: string; // 归属分镜（或 startTime/endTime 时间点）
  x: number;
  y: number; // 相对位置 0-1
  scale: number;
  startOffset?: number; // 在该镜内的出现时间
  duration?: number; // 持续时长
}
```

### FFmpeg 改法

比水印复杂：每个贴图是带时间窗的 overlay，用 `overlay=x:y:enable='between(t,start,end)'`。多贴图 = 多 overlay 串联进 filter_complex。

### 前端

时间轴新增「贴图」轨（v2a 原型已画）：拖拽贴图到轨道、调位置/大小/时长。这是三者里唯一需要**时间轴交互改造**的，依赖批次3 的时间轴重构，建议放批次3 之后。

---

## 4. 落地批次（建议顺序）

| 子批次  | 内容                                                                                                                              | 依赖              | 风险                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------- |
| **5.1** | 字幕样式（全片统一）：generationParams.subtitleStyle + FFmpeg force_style + 导出弹窗样式面板                                      | 无                | 低（改动集中，零依赖） |
| **5.2** | 商标水印：generationParams.watermark + R2 上传 logo + FFmpeg overlay + 导出弹窗水印面板。**此步把 -vf 改造成统一 filter_complex** | 5.1（共用滤镜链） | 中                     |
| **5.3** | 贴图轨：时间轴贴图轨 + 位置编辑 + 多 overlay enable 时间窗                                                                        | 批次3 时间轴      | 高                     |

## 5. 共性技术要点 / 坑

- **滤镜链统一**：现状字幕用 `-vf` 字符串，水印/贴图需要多输入 overlay 必须用 `-filter_complex`。5.2 时要把字幕+缩放+水印合并成一条 filter_complex，并正确串 `[base]→[s1]→[s2]→[out]` 标签。
- **颜色格式**：ASS 是 `&HAABBGGRR`（BGR + alpha），不是 web `#RRGGBB`，需转换函数。
- **logo 透明度**：用 `colorchannelmixer=aa=` 或 `format=rgba` + overlay。
- **预览一致性**：PreviewPlayer（前端 Canvas/DOM）要尽量模拟 FFmpeg 效果，但帧精确对齐做不到，标注"导出为准"。
- **存储**：贴图/logo 走 R2；generationParams 是 Project 上的 Json，PATCH project 即可，无 schema 变更。
- **积分**：带水印/贴图的导出是否额外计费？需产品决策（暂不计）。

> 关联 [[project_editor-page-optimization]]。落地走 [[feedback_remote_first]] SSH 流程。
