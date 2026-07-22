# 剪映草稿导出批次 — 实施契约（主会话已定，勿改）

本文件是实施代理的唯一权威规格。所有「格式」问题一律以 `/tmp/pyJianYingDraft` 源码为准。
调研已完成，下方结论已交叉验证（capcut-cli schema cheat sheet + 社区权威源），实施时直接采用。

---

## 0. 背景与目标

导出对话框新增「导出剪映草稿」：服务端把项目组装成剪映草稿文件夹并打 zip
（草稿 JSON + 全部素材 + 使用说明.txt），用户解压到剪映草稿目录即可打开继续精修。
免费（不扣积分）。zip 即时返回，不落库（零 schema 变更）。

---

## 1. 剪映草稿格式（schema 唯一权威 = /tmp/pyJianYingDraft 源码）

### 1.1 顶层结构 draft_content.json

基线模板见 `/tmp/pyJianYingDraft/pyJianYingDraft/assets/draft_content_template.json`（5.9.0 明文，360000 版本）。
**以此模板为基底**，只改 `canvas_config` / `fps` / `duration` / `materials` / `tracks`。
`dumps()` 逻辑见 `script_file.py:109-135`：

- `content["canvas_config"] = {width, height, ratio: "original"}`
- `content["fps"] = fps`（数值）
- `content["duration"] = max(所有 segment.end)`（微秒）
- `content["materials"] = ScriptMaterial.export_json()`（见 `script_material.py:99-147`，**所有类目键都要在，空的给 []**）
- `content["tracks"] = [track.export_json() ...]`，按 track_order 排序后，
  **给每个 segment 写 `render_index = 该轨道导出序号`、`track_render_index = 0`**（见 `script_file.py:128-132`）

### 1.2 时间单位

微秒（μs）。1 秒 = 1_000_000。见 `time_util.py:6`（`SEC = 1000000`）。
本项目 scene.duration 是秒（可能是小数），换算 `Math.round(sec * 1_000_000)`。

### 1.3 素材（materials）

**VideoMaterial**（视频或图片，见 `local_materials.py:80-180`）export_json 字段（逐字段对齐）：

```
audio_fade: null, category_id: "", category_name: "local", check_flag: 63487,
crop: {upper_left_x:0, upper_left_y:0, upper_right_x:1, upper_right_y:0,
       lower_left_x:0, lower_left_y:1, lower_right_x:1, lower_right_y:1},
crop_ratio: "free", crop_scale: 1.0, duration: <μs>, height: <px>, id: <uuid>,
local_material_id: "", material_id: <uuid=id>, material_name: <文件名>,
media_path: "", path: <见§2 占位符路径>, type: "video"|"photo", width: <px>
```

- 视频 type="video"，duration=实测（见 §3 ffprobe）；图片 type="photo"，
  **duration 固定 10_800_000_000（≈3h，见 local_materials.py:154）**，width/height 用图片实际像素。
- id === material_id === 全局 uuid（32 hex，无连字符，`uuid4().hex` 等价 → TS 用 `randomUUID().replace(/-/g,"")`）。

**AudioMaterial**（见 `local_materials.py:182-247`）export_json：

```
app_id: 0, category_id: "", category_name: "local", check_flag: 3,
copyright_limit_type: "none", duration: <μs>, effect_id: "", formula_id: "",
id: <uuid>, local_material_id: <uuid=id>, music_id: <uuid=id>, name: <文件名>,
path: <占位符路径>, source_platform: 0, type: "extract_music", wave_points: []
```

**Text 素材**（`text_segment.py:384-457 export_material`，放进 materials.texts[]）关键字段：

```
id: <uuid>, content: <JSON字符串>, typesetting: 0, alignment: <0|1|2>,
letter_spacing: <n*0.05>, line_spacing: <0.02 + n*0.05>, line_feed: 1,
line_max_width: <0-1>, force_apply_line_max_width: false, check_flag: 7,
type: "subtitle"(auto_wrapping) | "text", global_alpha: <0-1>
```

content 是 **JSON-in-JSON 字符串**（`json.dumps` 的结果），结构见 text_segment.py:395-417：

```json
{"styles":[{"fill":{"alpha":1.0,"content":{"render_type":"solid",
  "solid":{"alpha":1.0,"color":[r,g,b]}}},"range":[0,<字符数>],
  "size":<字号>,"bold":false,"italic":false,"underline":false,"strokes":[]}],
  "text":"<字幕文本>"}
```

- color 是 [r,g,b] 三元组，0-1 浮点（白色 [1,1,1]）。
- range=[0, text.length]（JS string length；纯中文/ASCII 混排本项目可接受按 JS length，
  参考库 Python 也用 `len(self.text)`，无 UTF-16 特殊处理，对齐即可）。

### 1.4 片段（segments）

**通用字段**（`segment.py:55-77 BaseSegment.export_json`）：

```
enable_adjust: true, enable_color_correct_adjust: false, enable_color_curves: true,
enable_color_match_adjust: false, enable_color_wheels: true, enable_lut: true,
enable_smart_color_adjust: false, last_nonzero_volume: 1.0, reverse: false,
track_attribute: 0, track_render_index: 0, visible: true,
id: <uuid>, material_id: <素材id>, target_timerange: {start:<μs>, duration:<μs>},
common_keyframes: [], keyframe_refs: []
```

**MediaSegment 追加**（`segment.py:207-217`，视频+音频共用）：

```
source_timerange: {start,duration} | null, speed: <float>, volume: <float>,
extra_material_refs: [<speed.global_id>, ...], is_tone_modify: false
```

- 每个视频/音频片段**必带一个 Speed 对象**（`segment.py:79-98`），其 global_id 进
  `extra_material_refs[0]` 且 Speed 进 materials.speeds[]（`_script_file_segments.py:95,104`）：
  Speed.export_json = `{curve_speed:null, id:<uuid>, mode:0, speed:<float>, type:"speed"}`

**VisualSegment 追加**（`segment.py:282-289`，视频+文本）：

```
clip: {alpha:1.0, flip:{horizontal:false,vertical:false}, rotation:0.0,
       scale:{x:1,y:1}, transform:{x:0,y:0}},
uniform_scale: {on:true, value:1.0}
```

**VideoSegment 追加**（`video_segment.py:685-690`）：`hdr_settings:{intensity:1.0,mode:1,nits:1000}`
**AudioSegment 追加**（`audio_segment.py:206-212`）：`clip:null, hdr_settings:null`
**TextSegment**：走 VisualSegment（有 clip / uniform_scale），material_id 指向 texts[] 里的素材。

**source_timerange 语义**（video_segment.py:443-455 / audio_segment.py:122-134）：

- 视频：target_timerange.duration = scene.duration（μs）；
  source_timerange = {start:0, duration: round(target.duration \* speed)}；
  本批 speed 恒 1.0 → source = {start:0, duration: min(ffprobe实长μs, scene.duration μs)}。
  **主会话定案**：source duration 取 `min(ffprobe实长, scene.duration)`，target duration 取 scene.duration。
  若视频实长 < scene.duration，剪映会定格最后一帧铺满 target（可接受，用户会在剪映里调）。
  ⚠️ 硬约束：source_timerange.end **不得超过 material.duration**（否则参考库抛 ValueError，
  剪映也会异常）。故 source.duration = min(实长, scene.duration)。
- 图片：material.duration=3h，source_timerange={start:0, duration: scene.duration μs}，
  target={start:<镜起点>, duration: scene.duration μs}。
- 音频（配音）：material.duration=ffprobe实长；target={start:<镜起点>, duration:min(实长, scene.duration)}，
  source={start:0, duration:同 target.duration}。配音比镜头长时截断到镜头，短时只占实长（后段静音，可接受）。
- BGM：见 §4。

### 1.5 轨道（tracks）

Track.export_json（`track.py:180-189`）：

```
attribute: <int mute>, flag: 0, id: <uuid>, is_default_name: <name==""?>,
name: <轨道名>, segments: [...], type: "video"|"audio"|"text"
```

轨道顺序（track_order，值越大越靠上/前景）。本批固定 4 条轨道，从下到上（导出数组顺序 = track_order 升序）：

1. video（正片视频/图片）
2. audio（配音）
3. audio（BGM）—— **两条 audio 轨必须给不同 name**（如 "配音" / "背景音乐"），
   否则同类型多轨在参考库会 NameError（业务上剪映允许多音轨，给不同 name 即可）。
4. text（字幕）—— 前景最上。

**render_index**：dumps 时按导出序（0,1,2,3）写回每个 segment（script_file.py:128-132）。

### 1.6 最小文件集（草稿文件夹被剪映识别所需）

参考 `draft_folder.py:73-103 create_draft`：一个可被剪映打开的草稿文件夹**至少**含：

- `draft_content.json`（核心，上面组装的）
- `draft_meta_info.json`（拷贝自 `assets/draft_meta_info.json` 模板即可，见下方 §2.2 需改的字段）

素材文件放子目录（本批放 `material/`）。zip 根 = 草稿文件夹（文件夹名 = 项目名的安全化）。

---

## 2. 素材路径可移植性（硬要求 — zip 解压即开，无「媒体丢失」）

### 2.1 结论（已调研定案）

参考库把 path 写成 `os.path.abspath`（绝对路径），**不解决跨机迁移**。
剪映自包含机制 = path 用占位符 token：

```
##_draftpath_placeholder_<UUID大写>_##/material/<文件名>
```

剪映打开草稿时把 `##_draftpath_placeholder_<UUID>_##` 解析为**当前草稿文件夹绝对路径**，
故只要素材在草稿文件夹的 `material/` 子目录，解压到任意机器的剪映草稿目录都能正确定位，不弹「媒体丢失」。

- UUID 取一个稳定的大写 UUID（`randomUUID().toUpperCase()`），整个草稿的所有素材 path 共用**同一个** UUID。
- 路径分隔符用 `/`（剪映偏好 posix）。
- 把此结论写进代码注释（jianying-draft.ts 顶部）与回传报告。

### 2.2 draft_meta_info.json 需同步的字段

模板 `draft_fold_path` / `draft_root_path` 留空即可（剪映打开时自建）。
`draft_id` 给新 uuid（大写带连字符，如模板格式），`draft_name` 给项目名。其余保留模板值。
（draft_materials 数组结构保留模板，本批不逐条填素材 registry——剪映靠 draft_content.json 的
materials + 占位符 path 已足够定位；draft_materials 为空不影响打开。若对拍发现必须填，再补。）

---

## 3. 组装服务 src/services/jianying-draft.ts

流程（参考 services/cover.ts + video-synthesis.ts 的 downloadFile/ffprobe 模式）：

1. 建临时目录 `os.tmpdir()/ai-comic-jianying/<ts>_<rand>/<草稿文件夹名>/material/`
2. 下载每个素材（视频/图片/音频/BGM）到 material/：走 `@/lib/url-guard` 的 `safeDownload`
   （钉 IP 防 SSRF），URL 先 absolutize（对齐 cover.ts:46-57 / video-synthesis absolutizeUrl）。
   素材 URL 来源：scene.videoUrl / scene.imageUrl / scene.audioUrl / BGM url（都是本项目已落库产物）。
   文件名去重 + 安全化（同一 URL 只下一次，多镜复用同素材共享一份 material + 一个 VideoMaterial）。
3. ffprobe 视频/音频实测时长（复用 video-synthesis 的 `getMediaDuration(mediaPath)`，已 export，
   见 video-synthesis.ts:2306；失败回退声明值，别阻塞）。图片用 sharp 读宽高（项目已装 sharp）。
   视频宽高：ffprobe 拿不到就给合理缺省（按 aspectRatio 推 1080×1920 / 1920×1080 / 1080×1080）。
4. 调 lib 纯函数 `buildJianyingDraft(timeline)` → draft_content.json 对象（见 §5）。
5. 落盘：draft_content.json + draft_meta_info.json 到草稿文件夹根；素材已在 material/。
6. zip（archiver）：archive 根 = 草稿文件夹（即 zip 解压出一个「项目名」文件夹，内含
   draft_content.json / draft_meta_info.json / material/ / 使用说明.txt）。
7. `storage.uploadFile(zipBuffer, {fileName:"<项目名>_剪映草稿_<ts>.zip", contentType:"application/zip",
fileType:"video", userId, projectId})` → 返回 zipUrl。**fileType 只有 image|video|audio，
   zip 借用 "video"**（仅决定存储路径分类，不影响功能）；contentType 用 application/zip。
8. finally 清理临时目录（rm -rf，对齐 cover.ts:170-172）。
9. 返回 `{zipUrl, sizeBytes}`。

**使用说明.txt 内容**（写进草稿文件夹根，UTF-8）：

- 如何使用：解压整个文件夹到剪映草稿目录
  （Windows: `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft`；
  macOS: `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft`），重启剪映即见草稿。
- 兼容性：剪映专业版 5.9+ 与 CapCut；新版剪映可直接打开，**保存后草稿会被剪映加密属正常现象**。
- 明确不含（留给用户在剪映里加，或用成片导出）：转场/滤镜/LUT/片头尾卡/Ken Burns/SFX/水印。

文件 ≤800 行。中文注释写意图。无 any。immutability。

---

## 4. 时间轴映射（主会话已定，勿改）

- **视频轨**：逐镜一段。有 videoUrl → 视频素材（§1.4 语义）；否则 imageUrl → 图片素材铺满 scene.duration。
  逐镜 target.start = 前面所有镜 scene.duration 之和（μs 累加），闭合无缝。无 videoUrl 且无 imageUrl 的镜跳过。
- **音轨①配音**：逐镜若有 audioUrl → 一段 AudioSegment，start 对齐该镜起点（§1.4 音频语义）。
- **音轨②BGM**：项目 BGM。取自 `project.generationParams.backgroundMusic`（BackgroundMusic 类型，
  见 types/export-style.ts:434；enabled=true 且 url 非空才加）。一段 AudioSegment：
  target={start:0, duration: 全片总时长μs}，source={start:0, duration: min(BGM实长, 全片总时长)}。
  ⚠️ source.end 不得超 material.duration：若 BGM 实长 < 全片，source.duration=BGM实长（剪映不循环，
  后段静音——剪映草稿无法表达「循环铺满」，用户在剪映里自行延长；写进使用说明可选）。volume=BGM.volume
  （缺省 0.25，与导出混音 BGM 缺省增益一致，见 DEFAULT_BACKGROUND_MUSIC）。
- **文本轨字幕**：逐句。复用 `@/lib/subtitle-segments` 的 `splitSubtitleSegments` +
  `allocateSubtitleWindows`（与预览/导出同一真源）。每镜取 dialogue||narration 文本，
  splitSubtitleSegments 切句，allocateSubtitleWindows(segments, scene.duration秒, 配音实长秒?) 得逐句窗，
  每句一个 TextSegment：target={start: 镜起点μs + window.start*1e6, duration:(window.end-window.start)*1e6}。
  样式给合理缺省（白字，size 用参考库缺省，auto_wrapping=true → type="subtitle"；用户会在剪映里重排）。
- **明确不做**（写进使用说明.txt）：转场/滤镜/LUT/片头尾卡/Ken Burns/SFX/水印。

---

## 5. 纯逻辑 src/lib/jianying-draft.ts（无 IO，可单测）

导出纯函数 `buildJianyingDraft(input): JianyingDraftContent`（返回 draft_content.json 对象）。
**lib 不依赖 services**（依赖分层硬约束）。可依赖 `@/lib/subtitle-segments`（同为 lib）。

### 输入类型（TS interface，实施代理定稿字段名，语义如下）

```ts
interface DraftTimelineInput {
  width: number; // 画布宽 px
  height: number; // 画布高 px
  fps: number; // 缺省 30
  pathPlaceholderUuid: string; // 大写 UUID（全草稿共用，见 §2.1）
  videoShots: Array<{
    // 逐镜（视频/图片），按顺序
    kind: "video" | "photo";
    materialFileName: string; // material/ 下文件名（拼占位符路径）
    materialWidth: number;
    materialHeight: number;
    materialDurationUs: number; // 视频=ffprobe实长μs；图片=10_800_000_000
    startUs: number; // 镜在轨道上的起点
    durationUs: number; // = scene.duration μs（target duration）
  }>;
  voiceClips: Array<{
    // 配音
    materialFileName: string;
    materialDurationUs: number;
    startUs: number;
    durationUs: number; // min(配音实长, scene.duration)
  }>;
  bgm?: {
    // 可选
    materialFileName: string;
    materialDurationUs: number;
    totalDurationUs: number; // 全片总时长
    volume: number;
  };
  subtitles: Array<{
    // 逐句（已切分+分配窗）
    text: string;
    startUs: number;
    durationUs: number;
  }>;
}
```

- 素材去重：videoShots 里多镜引用同一 materialFileName 时，materials.videos[] 只出一条
  （按 fileName 去重），但每镜各自一个 VideoSegment 指向同一 material id。voice/BGM 同理。
- id/uuid 生成：TS 用 `crypto.randomUUID().replace(/-/g,"")`（对齐参考库 `uuid4().hex` 32hex 无连字符）。
- path 拼接：`##_draftpath_placeholder_${uuid}_##/material/${fileName}`。

### 输出

draft_content.json 对象（以 §1.1 模板为基底，深拷贝后覆盖 canvas_config/fps/duration/materials/tracks）。
duration = 所有轨道所有 segment.end 的最大值。

---

## 6. tests/lib/jianying-draft.test.ts（vitest，node 环境）

至少覆盖：

- 微秒换算（秒→μs round）
- 视频镜 / 图片镜 segment 结构（type、source/target_timerange、图片 duration=3h、source.end≤material.duration）
- 素材去重（同 fileName 多镜 → materials.videos 一条 + 多 segment 同 material_id）
- 每个 media segment 带 Speed 且进 materials.speeds + extra_material_refs[0]=speed.id
- 字幕 TextSegment：content 是可解析 JSON、range=[0,len]、材料进 materials.texts、segment.material_id 命中
- 四轨结构：两条 audio 轨 name 不同、track type 正确、render_index 按导出序
- duration = max segment end
- BGM source.duration = min(BGM实长, 全片)
- materials 所有类目键都存在（哪怕空数组）

---

## 7. API POST /api/projects/[id]/draft-export

对齐 export/route.ts + cover/route.ts 模式：

- `export const maxDuration = 300;`
- session + `prisma.project.findFirst({where:{id, userId}})` 归属校验（404 若无）。
- `rateLimiters.export(request, userId)`（429 + rateLimitHeaders）。
- 载入 scenes（orderBy order asc）+ generationParams（取 BGM）。免费不扣积分。
- 无可用素材（零「有图/有视频」分镜）→ 400 `{error:"没有可导出的素材，请先生成分镜图或视频"}`。
- 调 `assembleJianyingDraft({projectId, userId, project, scenes})`（services/jianying-draft）。
- 返回 `{zipUrl, sizeBytes}`。失败 catch → 500 `{error:"剪映草稿导出失败"}` + log.error。

---

## 8. UI：ExportDialog 加「剪映草稿」区块

在 ExportForm 的可折叠分节里加一节 `<CollapsibleSection title="剪映草稿">`
（放在「专属封面」之后、「成片包装」之前，或末尾，实施代理择合理位置）。
一个新组件 `JianyingDraftPanel`（同文件内，风格对齐 CoverPanel）：

- React Query `useMutation` → `POST /api/projects/${projectId}/draft-export`。
- pending 态按钮「导出剪映草稿」（Loader2 转圈）；成功 → 下载链接。
- 下载：zipUrl 若 `/uploads/...`（本地降级）→ 直接 `<a href={zipUrl} download>`；
  若 R2 外链 → 走 `/api/download?url=`（但 download 代理仅放行 R2_PUBLIC_URL 前缀，zip 走 video 分类
  也在 R2 公开域下，OK）。实施代理判断：startsWith("/") → 直连，否则走 /api/download 代理。
  （对齐 ExportDialog.handleDownload 已有逻辑，可复用。）
- 一行兼容性说明：「兼容剪映专业版 5.9+ 与 CapCut；新版剪映可直接打开，保存后草稿会被剪映加密属正常现象」。
- 错误态显示 mutation.error.message。

不改 ExportDialog 的 props 契约（自包含，只需 projectId，已有）。

---

## 9. 红线约束

- 类型安全无 any（个别第三方无类型处可 `as` + 注释，但业务数据结构必须显式类型）。
- immutability（新对象，不 mutate）。中文注释写意图。
- lib 不依赖 services（jianying-draft.ts lib 版只依赖 lib）。
- 新依赖仅 `archiver`（+`@types/archiver`）：`pnpm add archiver && pnpm add -D @types/archiver`。不引 Python 进运行时。
- 自验 `pnpm run ci` 全绿（type-check + lint + format:check + test + build）。format:check 前车之鉴，务必 `pnpm format` 后再 check。
- 不 commit / 不 push / 不 db push。零 schema 变更。

---

## 10. 黄金样本对拍验证（一次性，不进 CI）

本地 python3.11 可用。步骤：

1. 用 ffmpeg 造最小素材：1 段 2s 视频、1 张图片、1 段 3s 音频（放 /tmp/jy-golden/）。
   例：`ffmpeg -f lavfi -i color=c=red:s=1080x1920:d=2 -y v.mp4`；
   `ffmpeg -f lavfi -i color=c=blue:s=1080x1920 -frames:v 1 -y img.jpg`；
   `ffmpeg -f lavfi -i sine=frequency=440:duration=3 -y a.mp3`。
2. `python3 -m pip install pyJianYingDraft`（或直接用 /tmp/pyJianYingDraft，`pip install -e /tmp/pyJianYingDraft`；
   注意它依赖 pymediainfo，装不上就用 -e 本地并确保 libmediainfo，或退而用 ffprobe 数据手填）。
   用参考库生成一个草稿：1 视频段 + 1 图片段（video 轨）+ 1 音频段（audio 轨）+ 2 条文本（text 轨），
   dump draft_content.json。
3. 用你的 TS `buildJianyingDraft` 生成**同一时间轴**的 draft_content.json（写个临时 tsx 脚本，
   `npx tsx` 跑，喂同样的时长/尺寸/文本）。
4. 逐字段结构对比两份 JSON（允许 id/uuid/path 随机差异）：差异逐条解释归类（等价/缺失/多余）。
5. 对拍结果 + 对齐率写进回传报告——**这是格式正确性的主要证据**。

---

## 11. 回传报告（SendMessage 给 main，硬要求）

- 改动文件清单（每文件一行，绝对路径）
- 草稿最小文件集 + 素材路径可移植机制结论（占位符 token）
- 黄金样本对拍结果（对齐率 + 差异逐条解释）
- `pnpm run ci` 结果（贴关键输出）
- 偏离契约的决定（若有）
- 遗留风险
