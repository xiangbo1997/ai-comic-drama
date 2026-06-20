# 配乐 / 背景音乐（BGM）功能 — 完整实施方案

> 作者：feat-bgm agent ｜ 日期 2026-06-19 ｜ 状态：可直接落地
> 范围：用户在编辑器选择歌曲作为整片 BGM，导出时混入成片，对标剪映/CapCut 音乐库。

---

## 0. 一句话结论

当前**完全没有 BGM 能力**。BGM 接入点是 `video-synthesis.ts` 的音频混配段（L692-716 生成 `audioFilters`，L842-849 / L898-909 用 `amix` 混合）。本方案：**内置 CC0 分类曲库（情绪标签）+ 用户上传**双轨；Project 级单条 BGM 配置存入 `generationParams.backgroundMusic`（**必须扩白名单**，否则重蹈 ffe4928/d128149 覆辙）；ffmpeg 用 `volume + aloop + atrim + afade` 处理，混音默认 `amix weights`，对白自动压低（duck）作为**可选** `sidechaincompress` 开关。

---

## 1. 现状诊断（file:line 证据）

### 1.1 音频混配现状 — BGM 的唯一接入点

`src/services/video-synthesis.ts`：

- **L692-716**：`if (options.includeAudio)` 逐分镜下载 `scene.audioUrl`，按变速后有效时长累计 `currentTime`，生成 `[N:a]adelay=ms|ms[aN]` 滤镜进 `audioFilters[]`。**这是对白/旁白配音轨**，没有任何 BGM 输入。
- **L842-849**（有水印/贴图分支，filter_complex 路径）：
  ```
  filterParts.push(...audioFilters);
  const mixInputs = audioFilters.map((_, i) => `[a${i}]`).join("");
  filterParts.push(`${mixInputs}amix=inputs=${audioFilters.length}[aout]`);
  ```
- **L898-909**（无水印分支，`-vf` + 独立 filter_complex 路径）：同样 `amix=inputs=${audioFilters.length}[aout]`。
- **结论**：BGM 只需作为**额外 `-i` 输入**，在两个分支里都把它的标签并入 `amix`，并把 `inputs` 计数 +1。`amix` 默认 `duration=longest` —— 这点对 BGM 极关键（见 §3.4）。

### 1.2 ExportOptions 接口 — 需加字段

`src/services/video-synthesis.ts` L36-58：已有 `subtitleStyle / watermark / stickers / transitions / sceneEffects`。**缺 `backgroundMusic`**。

### 1.3 权威类型源 — 需加 BackgroundMusic 接口

`src/types/export-style.ts`：定义 `Watermark/Sticker/Transition/SceneEffect` + 各自 `DEFAULT_*`。**缺 `BackgroundMusic` + `DEFAULT_BACKGROUND_MUSIC`**。这是前端/导出 API/合成服务三方共享的单一权威来源。

### 1.4 ⚠️ 白名单陷阱 — 最高优先级（历史教训）

`src/app/api/projects/[id]/route.ts` 的 `normalizeGenerationParams()`（L140-309）是 `generationParams` 落库的**唯一闸门**。提交历史明确记录：

- `ffe4928`：字幕样式/水印因白名单未放行被**静默丢弃**（"白存"）。
- `d128149`：转场/滤镜同类问题。

**`backgroundMusic` 不加进这个白名单 → 前端怎么存都进不了 DB → 导出永远读不到 → 功能假死。** 这是本功能 P0 必做项。

### 1.5 导出 API 读取链 — 已就绪，照抄即可

`src/app/api/projects/[id]/export/route.ts`：

- L42 `select.generationParams`；L66 `genParams = project.generationParams`。
- L78-88 把 `stickers/transitions/sceneEffects` 从 genParams 读出。
- L141-152 组装 `ExportOptions`。
- **BGM 照 stickers 模式**：从 `genParams.backgroundMusic` 读出，放进 `exportOptions.backgroundMusic`。同步/异步两分支都用同一个 `exportOptions`，无需改两处。

### 1.6 上传链路 — 已就绪，加一个 fileType 即可

- `src/lib/upload-client.ts` L24-34：`fileType: "image" | "video" | "audio" | "watermark"`。BGM 上传用 **`"audio"`**（已存在，无需新增枚举），或为体验加 `"music"` 专用校验分支（推荐，见 §1.7）。
- `src/app/api/upload/route.ts` L15-20 `ALLOWED_FILE_TYPES` + L62 `toStorageFileType`。`storage.ts` 的 `FileType`（L32）只有 `image/video/audio`，BGM 走 `audio` 即可落 `…/audios/…` 路径，R2/本地自动切（`uploadFile` L287-295）。

### 1.7 预览必须反映（用户硬约束）

Memory `feedback_preview-must-reflect-all-effects`：导出侧任何视觉/听觉效果必须在 `preview-player.tsx` 可见/可听。当前 `preview-player.tsx` L88/L167/L345-346 只有**分镜配音 `<audio>`**，**无 BGM 轨**。本方案必须在预览器加一条循环播放的 BGM `<audio>`（见 §5.4），否则视为没做完。

---

## 2. 曲库来源方案（建议）

### 2.1 推荐：内置 CC0 分类曲库 + 用户上传 双轨

| 来源         | 选型                                                   | 理由                                                                                                                          |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **内置曲库** | **Pixabay Music** 与 **Free Music Archive (CC0)** 精选 | 商用免授权、无需署名（CC0 / Pixabay License），规避版权风险。YouTube Audio Library 部分曲目要求署名，做内置不省心，**不选**。 |
| **用户上传** | 走现有 `/api/upload` `fileType:"audio"`                | 满足"我有自己的 BGM"需求，零额外后端。                                                                                        |

**先内置一批，按漫剧情绪分类**（与剧情标签对齐，便于一键匹配）：

| 分类 id    | 中文 | 用途场景         |
| ---------- | ---- | ---------------- |
| `calm`     | 舒缓 | 日常、过渡、回忆 |
| `tension`  | 紧张 | 冲突前、追逐     |
| `upbeat`   | 欢快 | 喜剧、日常高光   |
| `suspense` | 悬疑 | 反转、揭秘       |
| `epic`     | 史诗 | 战斗、高潮、燃   |
| `sad`      | 悲伤 | 别离、failure    |
| `romance`  | 浪漫 | 感情线           |

每分类 3-6 首，首批 ~25 首即可铺满体验。

### 2.2 曲库文件存放方案

**内置曲库走 `public/bgm/`**（静态资源，不走 storage.ts）：

```
app/public/bgm/
  calm/morning-light.mp3
  tension/heartbeat.mp3
  epic/rise.mp3
  ...
app/src/lib/bgm-library.ts   # 曲库清单（id/title/category/url/duration/credit）
```

- 理由：内置曲是**固定静态资产**，随构建发布，CDN/Next static 直接服务，URL 形如 `/bgm/epic/rise.mp3`，`video-synthesis.ts` 的 `absolutizeUrl()`（L160-171）会自动补成绝对 URL 给 ffmpeg `downloadFile` 拉取——**与现有 watermark/sticker 资产同机制，零特殊处理**。
- **不入 DB、不走 uploadFile**：内置曲是代码资产，不是用户产物。

**用户上传走 `uploadFile` / 本地 `public/uploads`**（已有）：

- `fileType:"audio"` → `storage.ts` 落 `…/audios/…`，R2 配了走 R2，没配走本地盘（线上现状）。返回的 `fileUrl` 存进 `generationParams.backgroundMusic.url`。

**曲库清单数据结构**（`src/lib/bgm-library.ts`）：

```ts
export interface BgmCategory {
  id: string;
  label: string;
}
export interface BgmTrack {
  id: string; // 稳定 id，如 "epic-rise"
  title: string; // "Rise"
  category: string; // "epic"
  url: string; // "/bgm/epic/rise.mp3"
  duration: number; // 秒，用于 UI 显示 & 试听进度
  credit?: string; // 署名（CC0 可空），合规留痕
}
export const BGM_CATEGORIES: BgmCategory[] = [
  { id: "calm", label: "舒缓" },
  { id: "tension", label: "紧张" },
  { id: "upbeat", label: "欢快" },
  { id: "suspense", label: "悬疑" },
  { id: "epic", label: "史诗" },
  { id: "sad", label: "悲伤" },
  { id: "romance", label: "浪漫" },
];
export const BGM_TRACKS: BgmTrack[] = [
  /* 首批 25 首 */
];
```

---

## 3. 合成接入（核心）— 精确 FFmpeg 方案

### 3.1 数据建模（给 arch-data agent 的功能契约）

**Project 级单条 BGM**（MVP 单曲足够对标剪映"一首主 BGM"；多段 BGM 列为 P2）。
存于 `Project.generationParams.backgroundMusic`（Json，无需改 schema，与 watermark/stickers 同位）。

`src/types/export-style.ts` 新增：

```ts
/** 背景音乐（BGM）配置 — 全片单条主音乐 */
export interface BackgroundMusic {
  /** 是否启用，默认 false */
  enabled: boolean;
  /** 音乐来源：内置曲库 id 或用户上传 URL（二选一，url 优先） */
  trackId?: string; // 内置曲库 BgmTrack.id（用于回显选中态）
  url: string; // 实际拉取地址（内置 /bgm/… 或上传 fileUrl）
  /** 音量 0-1，相对原始 BGM，默认 0.25（行业经验：BGM 压到对白之下） */
  volume: number;
  /** 淡入秒数，默认 1.5 */
  fadeIn: number;
  /** 淡出秒数，默认 2.0 */
  fadeOut: number;
  /** BGM 比成片短时是否循环铺满，默认 true */
  loop: boolean;
  /** 对白时自动压低 BGM（sidechain ducking），默认 false（保守，amix weights 更稳） */
  ducking: boolean;
}

export const DEFAULT_BACKGROUND_MUSIC: BackgroundMusic = {
  enabled: false,
  url: "",
  volume: 0.25,
  fadeIn: 1.5,
  fadeOut: 2.0,
  loop: true,
  ducking: false,
};
```

> `startTime/endTime`（裁剪 BGM 起止）列为 P2，先不做，避免首版复杂度爆炸。

### 3.2 ExportOptions 加字段

`src/services/video-synthesis.ts` L13-23 的 import 加 `BackgroundMusic`，L36-58 接口加：

```ts
  /** 背景音乐（BGM）配置；缺省或 enabled=false 时不混入 */
  backgroundMusic?: BackgroundMusic;
```

并在 L23 `export type { ... }` 补 `BackgroundMusic`。

### 3.3 合成总时长 — 必须先算出来（loop/fade 依赖）

afade 淡出的 `st`（开始时刻）= 成片总时长 − fadeOut；aloop 也需要知道铺多长。
成片总时长 = 各分镜**变速后有效时长**之和，与 L698-715 `currentTime` 累计逻辑完全一致：

```ts
// 在准备 BGM 前，先算 totalDuration（复用 resolveSceneEffect 的 speed）
let totalDuration = 0;
for (const scene of scenes) {
  const { speed } = resolveSceneEffect(scene.id, options.sceneEffects);
  totalDuration += scene.duration / speed;
}
```

> 注：转场 xfade 会让相邻片段重叠 `duration` 秒，使成片**略短于** `totalDuration`。但 BGM 用 `-shortest`/`amix=duration=first` 截断兜底（§3.4），即使估算偏长也不会拖尾。estimate 用于 afade 的 `st`，可接受 ±0.3s 误差。

### 3.4 BGM 滤镜链（核心）

**输入**：BGM 作为额外 `-i bgmPath`，索引 = 现有所有 `-i` 之后第一个（见 §3.5 索引计算）。

**单条 BGM 处理链**（设 BGM 输入标签 `[bgm:a]`，下面用占位 `[B]`）：

```
[B]volume=0.25,                            # 整体压低到对白之下
   aloop=loop=-1:size=2e9,                 # 无限循环（仅 loop=true 时加；size 给足样本数）
   atrim=0:TOTAL,asetpts=N/SR/TB,          # 截到成片时长（loop 后必须 atrim，否则无限长）
   afade=t=in:st=0:d=1.5,                  # 淡入
   afade=t=out:st=TOTAL-2.0:d=2.0          # 淡出（st = totalDuration - fadeOut）
[bgmout]
```

- `aloop`：仅当 `loop=true`。`size` 是**采样数**上限，给 `2e9`（约 12 小时 @44.1k）足够；`loop=-1` 无限循环。**必须紧跟 `atrim` 截断**，否则 aloop 产生无限流。
- `atrim=0:TOTAL` + `asetpts`：把（循环后的）流截到 `totalDuration` 并重置时间戳。`loop=false` 时也保留 atrim（BGM 比片长时截断；比片短时下面 amix 兜底）。
- `afade out` 的 `st` 用 `(totalDuration - fadeOut)`，代码里算好填字面量，**不在滤镜里写算术表达式**（afade 的 st 不支持表达式，必须是常量秒数）。

**混音两条路线：**

**路线 A（默认，稳）— amix weights：**
把 `[bgmout]` 并入现有 amix，BGM 给低权重让对白突出：

```
[a0][a1]...[aK][bgmout]amix=inputs=K+1:duration=first:dropout_transition=0:weights='1 1 ... 1 0.6'[aout]
```

- `duration=first`：以**第一路（对白配音轨 a0）**为基准？——不行，对白往往比片短。**改用 `duration=longest` + 外层 `-t totalDuration` 或 `-shortest`**。最稳妥：`amix=...:duration=longest`，然后输出阶段加 `-t ${totalDuration}`（见 §3.6），由总时长兜底截断。
- `weights`：对白轨权重 1，BGM 权重 0.6（再叠加前面 `volume=0.25`，实际 BGM ≈ 0.15 量级，对白清晰）。`weights` 需 ffmpeg ≥ 4.4；线上若旧版，退化为不带 weights（靠 BGM 的 `volume=0.2` 单独压低）。
- ⚠️ `amix` 会按 `1/inputs` 归一化，输入越多整体越轻。补 `,volume=${inputs}` 或 `normalize=0` 还原响度。**推荐 `amix=...:normalize=0`**（ffmpeg ≥ 4.4），各轨保持自身电平，对白不会因为加了 BGM 变小。

**路线 B（可选开关 ducking=true）— sidechaincompress：**
对白响时自动把 BGM 压下去（专业级"闪避"）。需先把所有对白轨合成一条 sidechain key：

```
# 1. 对白轨先 amix 成一条 [voice]
[a0][a1]...[aK]amix=inputs=K:normalize=0[voice];
# 2. 用 [voice] 作为侧链压 [bgmout]
[bgmout][voice]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300:makeup=1[bgmducked];
# 3. 再把压好的 BGM 与对白混合
[voice][bgmducked]amix=inputs=2:normalize=0[aout]
```

- `sidechaincompress`：`[main][sidechain]` 两路输入，main=BGM、side=对白；对白能量超 threshold 就按 ratio 压低 main。`attack/release` ms 控制闪避快慢。**这是剪映"语音增强/自动闪避"的同款原理**。
- 复杂度高（多一次 amix + 一次 compress），且对白轨为空（用户没做配音）时要降级到路线 A。**首版默认 ducking=false 走路线 A**，开关打开才走 B。

**无对白配音时（audioFilters 为空但有 BGM）：**
直接 `[bgmout]` 当唯一音轨：`-map [bgmout]` 或单路 amix 透传。代码里判断 `audioFilters.length === 0 && bgm.enabled` 走简化分支。

### 3.5 输入索引计算（两个分支都要改）

现有索引规则（L769-776 注释）：`[0]=merged视频`，`[1..N]=音频配音轨`，之后是 overlay 图片（水印/贴图）。

**BGM 输入应排在哪？** 建议**排在所有音频轨之后、overlay 图片之前**，或**所有输入最后**。两者皆可，关键是算对标签。最省心：**放在最后**（所有 `-i` 之后），用一个独立变量记录其索引：

```ts
// audioInputs 每轨 2 元素；merged 是 [0]；配音轨 [1..audioCount]
const audioCount = audioInputs.length / 2;
let bgmInputIndex = -1;
if (hasBgm) {
  ffmpegArgs.push("-i", bgmPath); // 在 audioInputs 之后、overlay 之前 push
  bgmInputIndex = 1 + audioCount; // 紧跟最后一条配音轨
  // 后续 overlay 图片的 nextInputIndex 要 +1（因为 BGM 占了一个输入位）
}
```

> ⚠️ **有水印/贴图分支**（L776 `nextInputIndex = 1 + audioInputs.length / 2`）：若 BGM 插在配音后、overlay 前，则 `nextInputIndex` 起点要 `+1`。最简单：**先 push BGM，再让 `nextInputIndex = 1 + audioCount + (hasBgm ? 1 : 0)`**，避免 overlay 图片索引错位。这是改动里最易错的一行，务必和 L794/L812 的 `nextInputIndex` 自增逻辑对齐。

### 3.6 输出阶段加总时长兜底

两个分支的编码参数（L860-875 / L912-927）在 `-map [aout]` 之后、`-y outputPath` 之前加：

```ts
if (hasBgm) {
  ffmpegArgs.push("-t", totalDuration.toFixed(3)); // BGM loop=longest 时截到成片时长
}
```

> 视频轨本身时长固定（merged），加 `-t` 主要防 `amix=duration=longest` 让 BGM 拖尾。也可用 `-shortest`，但 `-shortest` 会以最短流为准，对白轨短时会**误截视频**——所以用显式 `-t totalDuration` 更安全。

### 3.7 改动落点汇总（video-synthesis.ts）

1. L13-23：import + re-export `BackgroundMusic`。
2. L36-58：`ExportOptions` 加 `backgroundMusic?`。
3. 音频段（L692 后）：算 `totalDuration`；若 `backgroundMusic?.enabled && url` → `downloadFile(absolutizeUrl(url), "bgm.mp3")` 得 `bgmPath`，构建 `bgmFilterChain` 字符串 + `[bgmout]` 标签。
4. **有水印/贴图分支**（L766-877）：push BGM 输入（修正 `nextInputIndex`）；把 bgm 滤镜并入 `filterParts`；改 amix（路线 A：`inputs+1` + weights + normalize=0；或路线 B ducking）；`-map [aout]` 后加 `-t`。
5. **无水印分支**（L878-930）：同样 push BGM 输入；BGM 滤镜 + amix 改造；`-map [aout]` 后加 `-t`。
6. 提取 `buildBgmFilter(bgm, totalDuration, bgmInputIndex, hasVoice)` 辅助函数（返回滤镜片段字符串 + 输出标签 + 新 amix 表达式），两分支共用，避免重复。

---

## 4. API 透传（防白名单丢字段 — P0）

### 4.1 PATCH 白名单放行（`src/app/api/projects/[id]/route.ts` 的 `normalizeGenerationParams`）

在 L308 `return out` 之前、参照 watermark 段（L198-216）新增：

```ts
// 背景音乐（BGM）：校验后整体放行 —— 不加这段则前端存不进 DB（同 ffe4928 教训）
if (src.backgroundMusic && typeof src.backgroundMusic === "object") {
  const bm = src.backgroundMusic as Record<string, unknown>;
  out.backgroundMusic = {
    enabled: bm.enabled === true,
    trackId:
      typeof bm.trackId === "string" && bm.trackId.length <= 64
        ? bm.trackId
        : undefined,
    url: typeof bm.url === "string" && bm.url.length <= 2048 ? bm.url : "",
    volume: typeof bm.volume === "number" ? clampNumber(bm.volume, 0, 1) : 0.25,
    fadeIn: typeof bm.fadeIn === "number" ? clampNumber(bm.fadeIn, 0, 10) : 1.5,
    fadeOut:
      typeof bm.fadeOut === "number" ? clampNumber(bm.fadeOut, 0, 10) : 2.0,
    loop: bm.loop !== false, // 默认 true
    ducking: bm.ducking === true,
  };
}
```

> `trackId` 为 undefined 时不写键（与 sticker 的可选字段同风格），避免落 `null`。

### 4.2 导出 API 读取（`export/route.ts`）

- L88 后加：
  ```ts
  const resolvedBackgroundMusic =
    genParams.backgroundMusic && typeof genParams.backgroundMusic === "object"
      ? genParams.backgroundMusic
      : undefined;
  ```
- L141-152 `exportOptions` 加：`backgroundMusic: resolvedBackgroundMusic,`。
- 同步 + 异步分支共用一个 `exportOptions`，无需改两处。**无需改 `task.input`**（仅元数据）。

### 4.3 上传 route（可选优化）

`src/app/api/upload/route.ts`：BGM 走现有 `"audio"` 即可。若要给音乐**更大体积上限 + 格式白名单**（mp3/wav/m4a/ogg），可仿 watermark 加 `"music"` 分支（L22-31 的 `WATERMARK_*` 模式）：

```ts
const MUSIC_ALLOWED = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/ogg",
]);
const MUSIC_MAX_SIZE = 20 * 1024 * 1024; // 20MB
```

并把 `"music"` 加进 `ALLOWED_FILE_TYPES`、`toStorageFileType("music") => "audio"`、`upload-client.ts` 的 `fileType` 联合类型。**非必须**，首版直接用 `"audio"` 更快。

---

## 5. 前端 UI

### 5.1 入口位置（三处一致原则）

现有样式配置有**两个入口**：① 时间轴工具栏（独立弹窗 `WatermarkDialog/StickerDialog/...` → 存 generationParams）；② 导出弹窗 `ExportDialog`（表单初值来自 generationParams）。
**BGM 推荐主入口放时间轴工具栏的独立"配乐"弹窗**（`EditorHeader` 加 `onMusicClick`，L82/L90 旁加一个音乐按钮 `<Music />`），因为：

- 配乐是创作态决策（要试听、要循环预览），更适合独立面板而非塞进导出弹窗。
- 与 watermark/sticker 的弹窗模式一致，`page.tsx` L426-437 照抄 `WatermarkDialog` 接线即可。

**同时**在 `ExportDialog` 的折叠分节加一个**只读摘要 + 开关**（"背景音乐：史诗·Rise（已选）"），保持"导出弹窗能看到全部生效配置"的一致性（对标 §1.7）。

### 5.2 组件结构 — `BgmDialog` + `BgmPanel`（仿 WatermarkDialog/WatermarkPanel）

```
components/
  BgmDialog.tsx     # 弹窗壳（draft state + 完成保存），仿 WatermarkDialog.tsx 全文
  BgmPanel.tsx      # 配乐主面板（仿 WatermarkPanel.tsx）
```

`BgmDialog`：与 `WatermarkDialog.tsx`（共 61 行）结构 1:1 —— `useState<BackgroundMusic>(initialValue ?? DEFAULT_BACKGROUND_MUSIC)`，body 放 `<BgmPanel value={draft} onChange={setDraft} />`，底部"完成"调 `onSave(draft)`。

`BgmPanel`（核心 UI，仿 WatermarkPanel）：

```
┌─ 启用配乐 [开关]  (仿 WatermarkPanel L82-99 的 switch)
├─ 分类 Tab：舒缓|紧张|欢快|悬疑|史诗|悲伤|浪漫   (BGM_CATEGORIES)
├─ 曲目列表（当前分类）：每行 = 曲名 + 时长 + [试听▶/⏸] + 选中态高亮
│    点行 → onChange({...value, trackId, url, enabled:true})
├─ ── 或上传自己的音乐 ──
│    [选择音频文件]  (仿 WatermarkPanel handleFileChange，uploadFileViaApi fileType:"audio")
│    上传成功 → onChange({...value, url:fileUrl, trackId:undefined, enabled:true})
├─ 音量滑块 0-1 step .05   (仿 WatermarkPanel 透明度滑块 L198-217)
├─ 淡入滑块 0-10s / 淡出滑块 0-10s
├─ [开关] 循环铺满整片 (loop)
└─ [开关] 对白时自动压低音乐 (ducking)  + 小字"有配音时更清晰"
```

**试听实现**（纯前端，单例 `<audio>` ref）：

```tsx
const audioRef = useRef<HTMLAudioElement | null>(null);
const [playingId, setPlayingId] = useState<string | null>(null);
const toggle = (track: BgmTrack) => {
  if (!audioRef.current) audioRef.current = new Audio();
  if (playingId === track.id) {
    audioRef.current.pause();
    setPlayingId(null);
    return;
  }
  audioRef.current.src = track.url; // 内置 /bgm/… 直接可播
  audioRef.current.play().catch(() => {});
  setPlayingId(track.id);
};
// 卸载时 audioRef.current?.pause()
```

### 5.3 page.tsx 接线（仿 L426-437 WatermarkDialog）

```tsx
const [showBgmDialog, setShowBgmDialog] = useState(false);
// EditorHeader: onMusicClick={() => setShowBgmDialog(true)}
{
  showBgmDialog && (
    <BgmDialog
      initialValue={project.generationParams?.backgroundMusic}
      onSave={(backgroundMusic) =>
        editor.updateProject({
          generationParams: { ...project.generationParams, backgroundMusic },
        })
      }
      onClose={() => setShowBgmDialog(false)}
    />
  );
}
```

`editor.updateProject` → PATCH `/api/projects/:id`（已有），白名单放行后即落库。

### 5.4 预览器 BGM 轨（硬约束 §1.7）

`preview-player.tsx`：

- props 加 `backgroundMusic?: BackgroundMusic`（L30 旁）。
- 加第二个 ref `const bgmRef = useRef<HTMLAudioElement>(null)`。
- 渲染：`{backgroundMusic?.enabled && backgroundMusic.url && (<audio ref={bgmRef} src={backgroundMusic.url} loop />)}`（L345-346 旁）。`loop` 属性对应 BGM 循环。
- 播放控制：在 `isPlaying` 的 effect（L161-179）里 `bgmRef.current?.play()` / `.pause()`；音量 `bgmRef.current.volume = backgroundMusic.volume`；静音 effect（L195-203）同步 `bgmRef.current.muted = isMuted`。
- `page.tsx` L523-525 给 `<PreviewPlayer>` 传 `backgroundMusic={project.generationParams?.backgroundMusic}`（与 watermark/stickers 同处）。
  > 预览的 ducking 不必模拟（前端做闪避成本高），但音量/循环/淡入可近似（HTMLAudio 无 afade，可忽略淡入或用 Web Audio gain ramp，P2）。核心是**让用户在预览里听到 BGM**。

---

## 6. 行业标杆对标

| 能力                     | 剪映/CapCut    | 本方案首版                   | 差距/P 级                 |
| ------------------------ | -------------- | ---------------------------- | ------------------------- |
| 分类情绪曲库             | ✅ 海量 + 卡点 | ✅ 7 类 ×~25 首 CC0          | 量级差，但够用（P2 扩库） |
| 用户上传                 | ✅             | ✅ `fileType:audio`          | 持平                      |
| 试听                     | ✅             | ✅ 前端 `<audio>`            | 持平                      |
| 音量调节                 | ✅             | ✅ volume 滑块               | 持平                      |
| 淡入淡出                 | ✅             | ✅ afade                     | 持平                      |
| 循环铺满                 | ✅             | ✅ aloop+atrim               | 持平                      |
| 对白自动闪避(ducking)    | ✅"语音增强"   | ✅ sidechaincompress（开关） | 持平（可选）              |
| 卡点/踩拍(beat sync)     | ✅             | ❌                           | P2，需节拍检测，暂不做    |
| 多段 BGM(不同片段不同曲) | ✅             | ❌ 单条主 BGM                | P2                        |
| BGM 起止裁剪             | ✅             | ❌（startTime/endTime）      | P2                        |
| 音效库(SFX)              | ✅             | ❌                           | 另立功能                  |

**结论**：首版做到单条主 BGM 全链路（曲库/上传/试听/音量/淡入淡出/循环/可选闪避）即达到"能与剪映同台"的核心体验；卡点、多段、裁剪为 P2 增量。

---

## 7. 实施优先级与工作量

| #   | 任务                                                                          | P 级 | 工作量 | 阻塞关系                   |
| --- | ----------------------------------------------------------------------------- | ---- | ------ | -------------------------- |
| 1   | `types/export-style.ts` 加 `BackgroundMusic` + `DEFAULT_*`                    | P0   | S      | 无（先做，全链依赖）       |
| 2   | **PATCH 白名单放行 `backgroundMusic`**                                        | P0   | S      | 依赖 1；不做则功能假死     |
| 3   | `bgm-library.ts` 曲库清单 + `public/bgm/*` 放 ~25 首 CC0                      | P0   | M      | 找曲+转码占大头            |
| 4   | `video-synthesis.ts`：ExportOptions+`buildBgmFilter`+两分支混音改造+`-t` 兜底 | P0   | M      | 依赖 1；本功能核心         |
| 5   | `export/route.ts` 读 `genParams.backgroundMusic` 入 exportOptions             | P0   | S      | 依赖 4                     |
| 6   | `BgmDialog`+`BgmPanel`（仿 Watermark\*）+ EditorHeader 入口 + page 接线       | P0   | M      | 依赖 1/2                   |
| 7   | `preview-player.tsx` BGM 轨（硬约束）                                         | P0   | S      | 依赖 1/6                   |
| 8   | ducking 路线 B（sidechaincompress 开关分支）                                  | P1   | M      | 依赖 4；首版可先只交路线 A |
| 9   | upload route `"music"` 专用校验（更大体积+格式白名单）                        | P1   | S      | 可选优化                   |
| 10  | 卡点/多段 BGM/起止裁剪/SFX                                                    | P2   | L      | 增量                       |

**关键路径**：1→2→4→5→6→7（全 P0），其中 3（曲库素材）与 4（ffmpeg）可并行。预计核心 P0 ≈ 1.5~2 人日（不含找曲）。

---

## 8. 易踩的坑（务必盯）

1. **白名单（§4.1）**——不放行 = 前端白存，导出永远无 BGM。**这是历史已踩两次的坑**（ffe4928/d128149）。
2. **输入索引错位（§3.5）**——有水印/贴图分支 BGM 占一个 `-i` 位，overlay 图片的 `nextInputIndex` 必须 +1，否则 ffmpeg `overlay` 引用错输入直接报错。
3. **aloop 不截断 = 无限流**——`aloop=loop=-1` 后**必须** `atrim=0:TOTAL`，否则 ffmpeg 永不结束。
4. **amix 归一化变小声**——加 `normalize=0`，否则对白会因为多了 BGM 输入被整体压低，用户以为"配音变小了"。
5. **afade out 的 st 不支持表达式**——`totalDuration - fadeOut` 在 TS 里算成字面量再拼进滤镜字符串。
6. **`-shortest` 误截**——对白轨比片短时 `-shortest` 会砍掉视频尾巴；用显式 `-t totalDuration` 兜底。
7. **预览必须出声（§1.7/§5.4）**——否则用户判定"没做完"。
