# 编辑页 `/editor/[id]` 优化评审报告

> 生成日期：2026-06-16 · 执行者：Claude Code · 方法：5 个并行 agent 只读分析（视觉 / 交互 / 功能 / 性能 / 竞品对标）+ codegraph 符号图谱
> 当前结构（已重构，比旧文档新）：`page.tsx`(518行编排) + 三栏(ScriptPanel左 / SceneList中 / SceneEditor右 各 w-1/3) + EditorHeader顶 + WorkflowPanel浮层 + TimelineEditor底(四轨道) + PreviewPlayer弹窗 + 3×MultiGenerateDialog

---

## 一、P0 — 必修缺陷（功能失效 / 数据不一致 / 资源泄漏）

| #   | 类别      | 问题                                    | 位置                                                                                                                                    | 后果                                                                        | 修法                                                                                                                                                                     |
| --- | --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 功能      | **三视图锁形象服务端失效**              | `api/generate/image/route.ts:55-66` 解构 body 漏 `referenceImages`；`:313` 只传单张                                                     | 前端发 front/side/back 三张，服务端只用一张，核心卖点(commit 6e49448)打对折 | 解构加 `referenceImages`；orchestrate 时 `referenceImages?.length ? referenceImages : referenceImage ? [referenceImage] : undefined`；积分预扣 `hasExplicitRef` 也算多张 |
| 2   | 功能      | **多配置生成绕过 prompt 构建 + 丢角色** | `page.tsx:394-405` 自己手拼 prompt，不传参考图                                                                                          | 同分镜，多配置并行 vs 单张生成，prompt 和角色数据不同，结果不一致           | 复用 `derivePromptInputs`/`buildFinalPrompt`，传 referenceImages                                                                                                         |
| 3   | 功能      | **批量生成丢失模型配置**                | `SceneList.tsx:299/376-387` mutate 不传 `imageConfigId`；`batchGenerateImagesMutation` 签名无 configId(`use-generation-actions.ts:251`) | 用户在 ModelSelector 选的模型被忽略，全走默认                               | mutate 透传 `mediaConfig.image.selected`；batch mutationFn 加 `imageConfigId?` 参数                                                                                      |
| 4   | 功能/交互 | **生成失败完全无反馈**                  | `SceneList/SceneEditor` 无 `imageStatus==="FAILED"` 分支；`use-generation-actions.ts:155` onError 只写 DB 不 toast                      | 失败=未生成长一样，无重试，积分不足/无配置也静默                            | 加 `FAILED` 红色 `AlertCircle` + 重试按钮；onError 调 `toast.error(error.message)`                                                                                       |
| 5   | 功能/交互 | **GripVertical 假拖拽**                 | `SceneList.tsx:169` 渲染拖拽手柄但零排序逻辑；全项目无 `deleteScene/addScene/duplicateScene`                                            | 分镜无法重排/删除/新增/复制，20 个是死序列                                  | 接 `@dnd-kit/sortable` 真排序；每卡加三点菜单(删除/复制/插入)                                                                                                            |
| 6   | 功能/交互 | **Workflow 完成不刷新**                 | `use-workflow.ts:58-60` completed 缺 `invalidateProject()`；`workflowIdRef` 内存 ref 刷新即丢                                           | Agent 全自动跑完分镜列表不更新，用户以为失败；中途刷新状态丢失              | completed 回调 `onComplete?.()` → page 传 `invalidateProject`；挂载时查 RUNNING workflow 重连 SSE                                                                        |
| 7   | 性能      | **导出轮询泄漏**                        | `page.tsx:111-152` 递归 `setTimeout` 无 clearTimeout                                                                                    | 关页面/弹窗后僵尸轮询每 2s 打 export API                                    | `useRef` 存 timer，cleanup/关弹窗 clearTimeout；或改 RQ `refetchInterval`                                                                                                |
| 8   | 功能      | **导出成功可能静默失败**                | `page.tsx:95/126` `window.open` 被浏览器拦截则无反应；R2 未配置 `videoUrl=null`                                                         | 用户找不到导出的视频                                                        | 弹窗内展示 `<a href download>` 下载链接作降级；taskId 存 localStorage 防刷新丢失                                                                                         |

---

## 二、P1 — 强烈建议（体验/性能显著改善）

### 性能

| 问题                                                                          | 位置                                                                 | 修法                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **全量 invalidate**：改一字符重拉整个 project，单次生图触发 3 次全量 refetch  | `use-editor-project.ts:166`；`use-generation-actions.ts:141/154/157` | `setQueryData` 乐观更新；或 queryKey 精确到 scene 级；`useQuery` 加 `staleTime:30000` |
| **keystroke 狂写 DB + 竞态**                                                  | `SceneEditor.tsx:254/273/287/302/318/339` 每输一字符 PATCH           | onChange 加 debounce 300-500ms                                                        |
| **批量并发撞连接上限**：视频/音频 forEach 全并发 20+ 请求，图像却串行(不一致) | `SceneList.tsx:401-415`；`use-generation-actions.ts:258`             | 统一 p-limit 3-5 并发                                                                 |
| **无 React.memo + 内联函数**：任一弹窗切换整页(20卡+时间轴)重渲染             | `page.tsx:36-58` 11个useState；`:264-313` 内联 mediaConfig/onXxx     | 子组件 memo；回调 useCallback；mediaConfig useMemo                                    |
| **重组件静态 import 进首屏**                                                  | `page.tsx:7-9` PreviewPlayer/MultiGenerateDialog                     | `dynamic(..., {ssr:false})`                                                           |
| **Math.random 在 render**：波形每 100ms 抖动                                  | `timeline-editor.tsx:371`                                            | `useMemo` 固定波形序列                                                                |
| **updateProject fire-and-forget 无 invalidate**                               | `use-editor-project.ts:254-257`                                      | 改 mutation 或 then 里 invalidate                                                     |

### 交互/工作流

| 问题                                                       | 位置                                                                     | 修法                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 三栏等分不合权重；右栏空状态无引导 CTA                     | 各组件 `w-1/3`；`SceneEditor.tsx:54-68`                                  | 中栏给更多宽度或可拖拽列宽；右栏空态放创作向导                                             |
| 时间轴/预览 → 中栏不自动滚动到选中分镜；播放中右栏不跟随   | `SceneList` 无 scrollIntoView；`timeline-editor.tsx` currentScene 未回传 | `useEffect` 监听 selectedSceneId `scrollIntoView`；播放时 `onSceneSelect(currentScene.id)` |
| 批量入口三处重复(顶部批量生成/底部批量图视音/单卡)职责混乱 | `SceneList.tsx:111/362/282`                                              | 合并入口，明确"快捷一键 vs 带配置精细"                                                     |
| WorkflowPanel 默认折叠，首次运行用户不知道面板出现         | `WorkflowPanel.tsx` expanded 初始 false                                  | isRunning 变 true 时强制展开                                                               |
| 世界观创作 vs 输入文本 两入口无关系说明                    | 左栏并列                                                                 | 加"(可选)AI 生成设定"/"(必须)粘贴小说" + 步骤序号                                          |

### 视觉

| 问题                                                                     | 位置                                                                                          | 修法                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **三色失控**：橙(导出)+绿(预览)+紫(Agent)+时间轴四彩；紫全硬编码绕 token | `EditorHeader:78` bg-green-600；`ScriptPanel:89`/`SceneList:234`/`timeline:241,294` purple-\* | globals.css 加 `--agent` token；预览改 outline；时间轴统一双色+透明度 |
| 暗色层级泥泞，bg→card→secondary 仅差 0.05L                               | `globals.css` `.dark`                                                                         | card→0.24L，secondary→0.32L；或加内阴影高光线                         |
| emoji 🎬 占位廉价                                                        | `SceneList.tsx:151`                                                                           | 换 lucide `Film` + 虚线边框空状态                                     |
| 圆角 4px~12px 混用                                                       | 多处 rounded/lg/xl                                                                            | 建立 token 档位：tag→sm，button/input→md，卡→lg，弹窗→xl              |
| 表单无 focus ring                                                        | `SceneEditor` select/textarea                                                                 | 统一 `focus:ring-2 focus:ring-primary`                                |

---

## 三、P2 — 锦上添花 + 竞品借鉴

**视觉精调**：间距"紧-宽-紧"节奏(header py-2.5/content py-6/action py-3)；缩略图 64px→72-80px 16:9；图标三档统一(顶栏18/行内14/装饰12)；标题加 `text-sm font-semibold tracking-wide`；选中态加 `ring-offset`。

**竞品可借鉴 Top5**（来源见对标报告）：

1. **分镜卡三状态标签** Queued/Generating(43%)/Ready + 骨架占位 — 对标 Boords/AI Storyboard pipeline
2. **分镜卡列数切换** 列表/2列/3列网格(默认网格点开详情) — 对标 Boords/Katalist/StudioBinder/InVideo Boards
3. **角色参考"一次上传全片锁"一级入口** — 对标 Runway Gen-4 References/Pika Scene Ingredients/即梦 Subject Ref
4. **时间轴轨道高度调节 + 缩略图密度控件 + Ctrl滚轮缩放 + 轨道 Hide/Lock/Mute** — 对标 CapCut Web
5. **模型选择 SplitButton 分镜卡内按场景切换**(速度/质量/费用三维分组) — 对标 Scenario/Framia

**功能补全**：导出历史列表；导出格式增 GIF/图片序列；PreviewPlayer 字幕 `[dialogue,narration].filter(Boolean).join(' / ')`；首帧+尾帧双端控制(行业新标配)。

---

## 四、落地建议批次

- **批次 1（修 bug，最高 ROI）**：P0 #1(三视图后端) + #3(批量配置) + #4(失败反馈) + #6(workflow刷新) + #7(轮询泄漏)。改动小、风险低、直接止血。
- **批次 2（性能）**：乐观更新替代全量 invalidate + debounce keystroke + 并发控制 + memo/useCallback。
- **批次 3（布局重排，走 Stitch 原型）**：分镜卡网格切换 + 三状态标签 + SplitButton 选模型 + 时间轴增强 + 三栏权重调整。
- **批次 4（视觉精调）**：token 化紫色 + 暗色层级 + 圆角/图标/间距规范 + 空状态。

> 落地改代码走 SSH 改线上 `/software/ai-comic-drama/`（端口 3100，systemd ai-comic-drama.service，prisma db push 无 migrate 历史），不本地 git push。
