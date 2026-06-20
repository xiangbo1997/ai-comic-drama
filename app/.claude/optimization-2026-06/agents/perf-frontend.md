# 前端渲染性能与包体 — 诊断报告 (perf-frontend)

> 领域：React 渲染性能 / React Query 缓存与轮询 / 图片视频加载 / bundle 与 code splitting。
> 不含后端/DB（见 perf-backend）。所有结论引用 `file:line` 证据。
> 工作目录：`app/`，路径相对 `app/`。

---

## 1. 现状诊断（证据驱动）

### 1.1 编辑页 `memo` 被内联 props 整体击穿（最严重）

`SceneList` 与 `TimelineEditor` 都用 `memo` 包裹（`SceneList.tsx:824`、`timeline-editor.tsx:511`），注释自称"避免弹窗 state 变化时整列表重渲染"。但父组件 `EditorPage` 传入的 props 几乎全是**每次渲染都重建的新引用**，memo 浅比较必然失败：

- `page.tsx:331-347` `mediaConfig={{ image:{...}, video:{...}, audio:{...} }}` —— 整个对象 + 3 个嵌套对象 + 6 个内联箭头函数，每次渲染全新引用。
- `page.tsx:326-329` 传入 4 个 `generate*Mutation` —— `useMutation` 每次渲染返回**新的 result 对象**（React Query 设计如此），引用永远变。
- `page.tsx:348` `queryClient={editor.queryClient}` 稳定，但前面已经够击穿。
- `TimelineEditor`（`page.tsx:395-405`）同理：`scenes={project.scenes}` 在 `updateSceneMutation` 乐观更新时（`use-editor-project.ts:252` `setQueryData` 重建 `scenes` 数组）也变新引用。

后果：`EditorPage` 持有 **~17 个 `useState` 弹窗/选择标志**（`page.tsx:44-65`、`exportStatus` `page.tsx:66`）。点开**任意一个弹窗**（字幕/水印/贴图/转场/滤镜/预览/导出/多图/多视/多音/角色…）→ `EditorPage` 重渲染 → memo 全部失效 → **整条分镜列表（20-40 卡片）+ 整条时间轴（4 轨 × N 段）全量重渲染**。

### 1.2 `preview-player` 30ms `setInterval` × 3 个 setState（掉帧源）

`preview-player.tsx:131` `setInterval(..., 30)`（约 33fps），每 tick 调用：

- `setProgress`（`:134`）
- `setTransitionT`（`:141`，转场窗口内每帧）
- 边界处 `setCurrentIndex`（`:147`）

每帧触发整个 `PreviewPlayer`（504 行，含 SVG filter defs、字幕、水印、贴图 map）重渲染。`calculateOverallProgress()`（`:225-232`）+ `totalDuration`（`:108` reduce）+ `effDur`（`:106-107`，内部又 `find`）在每次渲染重算，O(scenes) 全量扫。33fps 下持续 GC 压力 + 主线程占用，长片预览明显掉帧。

`useEffect` 依赖数组（`:188`）含 `currentScene`/`scenes` —— `currentScene = scenes[currentIndex]`（`:91`）在每次父级 setQueryData 后是新引用，导致 interval **被反复 clear+重建**，计时基准 `startTime`（`:129`）重置，进度回跳。

### 1.3 批量生成：每张图后 `invalidateProject()`（N 次全量重拉 + N 次全树重渲染）

`use-generation-actions.ts:282` 和 `:303`：`batchGenerateImagesMutation` 的 `for` 循环里，**每处理一个 scene 就 `invalidateProject()` 两次**（标 PROCESSING 后一次、完成/失败后一次）。20 个分镜批量生成 = **~40 次 `GET /api/projects/:id`**（每次拉回全部 scenes + characters + 所有媒体 URL），每次 resolve 都触发 `EditorPage` → memo 击穿 → 全树重渲染。串行批量本就慢，再叠加 40 次全量刷新放大卡顿。

### 1.4 图片：24 处裸 `<img>`，0 处 `next/image`，0 处 `loading="lazy"`

`grep` 统计：`<img` 24 处、`next/image` 0 处、`loading="lazy"` 0 处。典型热点：

- `SceneList.tsx:377` 分镜大缩略图（每卡 1 张，列表 N 张）—— 加载**原始全分辨率**图，CSS 缩到 `w-32`（128px）。
- `timeline-editor.tsx:413` 图片轨每段 1 张原图，再叠 `SceneList` 已加载的同图。
- `SceneList.tsx:447`、`SceneEditor.tsx:212`/`:260` 角色头像 / 定妆照同理。

30 分镜项目首屏 = SceneList 30 张 + Timeline 30 张原图**全部 eager 加载**，无 srcset、无尺寸压缩、无懒加载。`next.config.ts` 已配 `images.remotePatterns`（R2/replicate/fal/siliconflow）但**完全没用上** `next/image`。

### 1.5 bundle：0 `next/dynamic`，lucide-react 未做 `optimizePackageImports`

- `grep next/dynamic` = **0**。编辑页静态 import 全部 12 个弹窗组件（`page.tsx:7-31`：SubtitleStyleDialog/Watermark/Sticker/Transition/SceneEffect/Export/CharacterManager/MultiGenerate/Preview/Timeline…），即使用户从不点开也进首屏 chunk。`PreviewPlayer`（504行 + scene-filters SVG）、`MultiGenerateDialog`（344行）都该按需加载。
- `next.config.ts` 无 `experimental.optimizePackageImports`。`lucide-react` 被 **47 个文件** import；Next 16 默认对 lucide 有 barrel 优化，但未显式纳入 `optimizePackageImports` 保险，且 Turbopack 下需确认 tree-shaking 生效。
- `package.json` 列了 `zustand`（`^5.0.9`）但**全代码库零使用**（`grep "from 'zustand'"` = 0，`create<` = 0）—— 死依赖，进 lockfile 不进 bundle，但 brief 要求的"Zustand 选择器粒度"在本项目**不存在该问题**（状态全在 React Query + local useState）。

### 1.6 轮询无上限（资源泄漏风险，非掉帧）

- `credits/page.tsx:215` 订单 `setInterval(3000)` 无 max-attempts，用户停在弹窗不付款 → **无限轮询** `GET /api/payment/order/:no`（仅 modal 关闭才清）。
- `page.tsx:147-194` 导出 `setTimeout(poll, 2000)` 递归，无总时长上限（依赖后端最终返回 completed/failed 才停）。
- `use-editor-project.ts:62` 剧本解析轮询有 5 分钟兜底（已正确）。`use-drama-script.ts:53/88` 需复核是否同样兜底。

### 1.7 次要项

- `ModelSelector`（`model-selector.tsx`）编辑页同时挂 **4 个实例**（SceneList 批量区 3 + SceneEditor 1）。useQuery 共享 `["ai-configs"]`（`:60`）已正确去重 fetch；但每实例各注册 1 个 `document mousedown` 监听（`:80-90`）+ 每渲染重 `filter` configs（`:66`）。轻量，低优先级。
- `SceneList.tsx:189/318/685/701` 等多处在 render / handler 里 `project.scenes.map`/`.filter`/`.indexOf`，未 `useMemo`；配合 1.1 的全量重渲染被放大。

---

## 2. 问题分级

| 级别   | 问题                                                                                          | 影响面                               | 证据                                                               |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| **P0** | memo 被内联 `mediaConfig` 对象 + mutation 对象击穿，任意弹窗开关全量重渲染 SceneList+Timeline | 编辑页交互全程卡顿，分镜越多越明显   | `page.tsx:326-347`、`SceneList.tsx:824`、`timeline-editor.tsx:511` |
| **P0** | 批量生成每张图后 `invalidateProject()`，N 张 = ~2N 次全量重拉+重渲染                          | 批量图/视/音越多越卡，网络与渲染双爆 | `use-generation-actions.ts:282,303`                                |
| **P1** | preview-player 30ms interval × 3 setState + 每帧 O(scenes) 重算 + interval 反复重建           | 预览播放掉帧、进度回跳               | `preview-player.tsx:131,134,141,147,188`                           |
| **P1** | 全站裸 `<img>` 加载原图、无懒加载/无 next/image                                               | 编辑页首屏图片瀑布、流量与 LCP 差    | `SceneList.tsx:377`、`timeline-editor.tsx:413` 等 24 处            |
| **P1** | 编辑页 0 code splitting，12 弹窗 + PreviewPlayer 全进首屏 chunk                               | 编辑页 JS 首包偏大、TTI 慢           | `page.tsx:7-31`，`grep next/dynamic`=0                             |
| **P2** | 订单/导出轮询无 max-attempts 上限                                                             | 长尾资源泄漏、后端无谓压力           | `credits/page.tsx:215`、`page.tsx:180`                             |
| **P2** | lucide 未显式 `optimizePackageImports`；`zustand` 死依赖                                      | 包体边际、依赖卫生                   | `next.config.ts`、`package.json`                                   |
| **P2** | ModelSelector ×4 各注册 document 监听 + 每渲染重 filter                                       | 轻微                                 | `model-selector.tsx:66,80-90`                                      |

---

## 3. 具体优化方案（可落地）

### P0-A 修复 memo 击穿（编辑页交互卡顿根因）

1. **稳定化 `mediaConfig`**：在 `page.tsx` 用 `useMemo` 包裹，依赖只放真正会变的 selected 值与 setter（setter 引用稳定）：

```tsx
const mediaConfig = useMemo<MediaConfigControls>(
  () => ({
    image: {
      selected: selectedImageConfig,
      onChange: setSelectedImageConfig,
      onOpenMultiSelect: openMultiImage,
    },
    video: {
      selected: selectedVideoConfig,
      onChange: setSelectedVideoConfig,
      onOpenMultiSelect: openMultiVideo,
    },
    audio: {
      selected: selectedAudioConfig,
      onChange: setSelectedAudioConfig,
      onOpenMultiSelect: openMultiAudio,
    },
  }),
  [selectedImageConfig, selectedVideoConfig, selectedAudioConfig]
);
// openMulti* 用 useCallback 稳定
```

2. **隔离 React Query mutation 引用**：mutation 对象引用不稳定，不要直接当 memo 子组件 prop。两选一：
   - 在 SceneList 内部 `useGenerationActions`（把 hook 下沉到 memo 边界内），父级只传 `projectId`/`project`；或
   - 父级只传 `mutate` 函数 + `isPending` 布尔（`mutate` 引用稳定）：`onGenerateImage={generateImageMutation.mutate}` + `isGeneratingImage={generateImageMutation.isPending}`，避免传整个 result 对象。
3. **把弹窗 state 移出热路径**：17 个 dialog flag 可合并为一个 `useReducer` 的 `activeDialog: DialogKey | null`，或抽 `<EditorDialogs>` 子组件承载所有弹窗 + 其 state，使 `SceneList`/`Timeline` 的兄弟节点 state 变化不再触发它们的父级重渲染。

> 工作量：M。验证：React DevTools Profiler 录制"点开字幕弹窗"，确认 SceneList/TimelineEditor 不再出现在 commit 里。

### P0-B 批量生成去抖刷新

`use-generation-actions.ts` `batchGenerateImagesMutation`：删除循环内 `invalidateProject()`（`:282`、`:303`），改为：

- 乐观本地标 `imageStatus:"PROCESSING"`（`setQueryData`，不 invalidate）；
- 每张完成后**只 `setQueryData` 精确合并该 scene**（参考 `use-editor-project.ts:267-283` 已有模式），不整 project 重拉；
- 循环结束 `onSettled`（`:308`）做**一次**最终 `invalidateProject()`。

> 工作量：S。收益：20 张批量从 ~40 次全量刷新 → 1 次；中途不再全树重渲染。

### P1-A preview-player 改 rAF + 单一时间源

- 用 `requestAnimationFrame` 替代 30ms `setInterval`；播放进度存 `useRef`（不进 state），仅在需要驱动 UI 的最小粒度 `setState`（如进度条可用 `requestAnimationFrame` 直接写 DOM `style.width`，或节流到 ~10fps setState）。
- `totalDuration`/`effDur` 用 `useMemo(() => …, [scenes, sceneEffects])` 缓存；`resolveEffect` 结果建 `Map` 避免每帧 `find`。
- 修 `useEffect` 依赖（`:188`）：去掉 `currentScene`/`scenes` 这类高频变引用，改用 `currentIndex` + ref 读最新 scenes，避免 interval/rAF 反复重建。

> 工作量：M。

### P1-B 图片改 `next/image` + 懒加载

- 列表/时间轴缩略图换 `next/image`，给定 `width`/`height`/`sizes`，自动 srcset + lazy + AVIF/WebP。`next.config.ts` 已配 remotePatterns，开箱即用。
- 本地降级盘（`public/uploads`）的图同样受益。Timeline 轨道图可加 `loading="lazy"` + `sizes` 限制，避免 N 张原图并发。
- 退而求其次（若不引 next/image）：至少给所有缩略 `<img>` 加 `loading="lazy" decoding="async"`，并让后端/storage 产出缩略图尺寸（与 perf-backend 协作）。

> 工作量：M（含逐个 `<img>` 迁移）。

### P1-C 编辑页 code splitting

```tsx
const PreviewPlayer = dynamic(() => import('@/components/preview-player')
  .then(m => m.PreviewPlayer), { ssr: false });
const MultiGenerateDialog = dynamic(...);
// 同理 Subtitle/Watermark/Sticker/Transition/SceneEffect/Export/CharacterManager 弹窗
```

弹窗本就 `{showX && <Dialog/>}` 条件渲染，配 `dynamic` 后未点开不进首包。

> 工作量：S-M。

### P2 收尾

- `credits/page.tsx:215` 加 `maxAttempts`（如 100 次 = 5 分钟）后停轮询并提示"超时请刷新"；`page.tsx` 导出轮询同样加总时长上限。
- `next.config.ts` 加 `experimental: { optimizePackageImports: ['lucide-react'] }`。
- 移除 `package.json` 的 `zustand` 死依赖（确认 0 引用后）。
- `ModelSelector` 用 `useMemo` 缓存 `configs` filter 结果。

---

## 4. 行业标杆对标（前端渲染/加载维度）

| 能力         | 本项目现状                        | 剪映/CapCut Web · Runway · Pika           | 差距                    |
| ------------ | --------------------------------- | ----------------------------------------- | ----------------------- |
| 时间轴重渲染 | memo 失效，弹窗即全量重渲         | 虚拟化轨道 + 局部 commit，只重渲变化片段  | 大：长片(50+镜)会明显卡 |
| 预览播放     | 30ms setInterval 驱动 React state | rAF + Canvas/WebGL 合成，state 与渲染解耦 | 大：掉帧、进度回跳      |
| 媒体加载     | 原图 eager，无懒加载/缩略图       | 缩略图金字塔 + 懒加载 + 视口外释放        | 中-大                   |
| 首屏 JS      | 编辑页所有弹窗进首包              | 路由级 + 交互级 code splitting            | 中                      |
| 轨道虚拟化   | 无（`scenes.map` 全量 DOM）       | 横向 virtualize，仅渲染可视片段           | 中（>50 镜时显著）      |

补充标杆建议（超出当前缺陷、面向"行业标杆"目标）：

- **时间轴轨道虚拟化**：分镜 >30 时 `timeline-editor` 的 4 轨 × N 段 DOM 量级大，引入横向虚拟滚动（只渲染可视 + buffer 片段）。
- **预览与导出共用一套合成描述**：当前 preview 用 CSS/SVG 近似 FFmpeg（`scene-filters`），长期可上 Canvas/WebCodecs 让预览与成片像素级一致且高帧率。

---

## 5. 实施优先级与工作量

| 顺序 | 任务                                                                            | 级别 | 工作量 | 收益                               |
| ---- | ------------------------------------------------------------------------------- | ---- | ------ | ---------------------------------- |
| 1    | P0-A memo 击穿修复（mediaConfig useMemo + mutation 引用隔离 + 弹窗 state 收口） | P0   | M      | 编辑页全程交互流畅，去掉最大卡顿源 |
| 2    | P0-B 批量生成去抖刷新（循环内移除 invalidate，末尾一次）                        | P0   | S      | 批量场景网络-40×、渲染-N×          |
| 3    | P1-C 编辑页 dynamic import 弹窗/PreviewPlayer                                   | P1   | S-M    | 首屏 JS 显著下降、TTI 改善         |
| 4    | P1-A preview-player rAF 重写 + useMemo                                          | P1   | M      | 预览播放不掉帧、进度稳定           |
| 5    | P1-B 图片 next/image + 懒加载                                                   | P1   | M      | 首屏图片瀑布、LCP、流量改善        |
| 6    | P2 轮询上限 + optimizePackageImports + 删 zustand + ModelSelector useMemo       | P2   | S      | 资源卫生、边际包体                 |

**建议先做 1+2**（同属编辑页核心、互不冲突、收益最大、风险最低，可一个 PR 内交付并用 Profiler 量化前后）。
其后 3（纯增量、零行为变更）、4、5 依次。

> 注：本项目实际**不使用 Zustand**，brief 中"Zustand 选择器粒度/整树重渲染"在此不成立；客户端状态由 React Query（服务端）+ local `useState`（UI）承担，真正的整树重渲染来自 P0-A 的 memo 击穿，已在上文定位。
