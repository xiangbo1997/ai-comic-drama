# 内置背景音乐（BGM）曲库

本目录存放配乐功能的**内置曲库** mp3，按情绪分类。文件随构建发布，由 Next
static 直接服务，URL 形如 `/bgm/epic/rise.mp3`。

## 如何添加曲目

1. 把 mp3 放到对应分类目录（calm/tension/upbeat/suspense/epic/sad/romance）。
2. 文件名需与 `src/lib/bgm-library.ts` 的 `BGM_TRACKS[].url` 一致，例如清单里
   `url: "/bgm/epic/rise.mp3"` → 放 `public/bgm/epic/rise.mp3`。
3. 新增曲目时同步在 `bgm-library.ts` 的 `BGM_TRACKS` 追加一条（id/title/
   category/url/duration/credit）。

## 版权要求（重要）

**仅收录 CC0 / Pixabay License 等商用免授权、无需署名的曲目**，规避版权风险。
推荐来源：

- Pixabay Music（https://pixabay.com/music/ ，需登录后从页面下载，CDN 直链有防盗链）
- Free Music Archive 的 CC0 分类（https://freemusicarchive.org/）
- YouTube Audio Library 的「无需署名」筛选（部分曲目要署名，注意甄别）

在 `bgm-library.ts` 的 `credit` 字段留下来源/许可，便于合规留痕。

## 当前状态

清单 `bgm-library.ts` 已规划 14 首占位（文件名已定）。放入对应 mp3 后立即生效。
**未放入 mp3 不影响功能**：合成时 BGM 下载失败会被容错跳过（成片仍有对白）；
用户上传自己的音乐这条路径无需内置曲库即可工作。
