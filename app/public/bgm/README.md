# 内置背景音乐（BGM）曲库

配乐功能的**内置曲库** mp3，按情绪分 7 类，各 3 首，共 21 首。曲源
**FreePD（CC0 公共域，商用免授权、无需署名）** 经 Internet Archive 镜像。

## 重要：mp3 不入 git

为避免 ~120MB 二进制污染 git 历史，`*.mp3` 已在根 `.gitignore` 忽略
（与 `public/uploads/` 同策略）。git 只跟踪：

- 曲目清单 `src/lib/bgm-library.ts`
- 下载脚本 `scripts/fetch-bgm.mjs`
- 本 README

## 在新环境填充曲库

```bash
cd app
node scripts/fetch-bgm.mjs   # 下载 21 首到 public/bgm/<分类>/
pnpm build                   # 必须！见下方说明
# 重启服务
```

**⚠️ 下载后必须重新 build**：Next.js 生产模式（`next start`）只服务 build
时刻的 `public/` 快照。build 之后才放进空目录的文件不会被识别（404）。
所以填充曲库的正确顺序是 **下载 mp3 → build → restart**，缺一不可。

## 添加新曲目

1. mp3 放到对应分类目录（calm/tension/upbeat/suspense/epic/sad/romance）
2. 在 `src/lib/bgm-library.ts` 的 `BGM_TRACKS` 追加一条（id/title/category/
   url/duration/credit），url 须与文件路径一致
3. 重新 build

## 版权

仅收录 CC0 / 公共域曲目。当前曲库全部来自 FreePD（CC0）。
