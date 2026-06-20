# 编辑器主工作流交互体验 — UX 诊断报告

> 执行者：Claude Code（编辑页 UX 专家）· 日期：2026-06-19
> 范围：`/editor/[id]` 主工作流（分镜编辑 / 拖拽 / 批量 / 状态反馈 / 预览导出所见即所得 / 时间轴 / 键盘 / 撤销 / 自动保存 / 移动端）
> 方法：逐文件只读审计（page.tsx 699 / SceneList 824 / SceneEditor / ScriptPanel / WorkflowPanel / ExportDialog / timeline-editor 511 / preview-player 504 + hooks）+ grep 验证 + API 路由存在性核对
> **重要前置**：历史报告 `OPTIMIZATION-REPORT.md` 列的 8 个 P0 经核对**多数已修**，本报告只列**当前仍存在**的问题，已修项见文末「已确认修复」清单，不重复。

---

## 1. 现状诊断（引用 file:line 证据）

### 已达到的基线（值得肯定，避免重复造轮子）

- 拖拽排序为**真实现**：`SceneList.tsx:312-320` 用 `@dnd-kit` + `SortableContext`，`handleDragEnd`(185-210) 调 `/scenes/reorder`；`reorder/insert/[sceneId]/duplicate/[sceneId]` DELETE 路由均存在（已核对文件系统）。历史「假拖拽」P0 已修。
- 三状态角标已落地：`SceneList.tsx:790-821` `SceneStatusBadge`（生成中/就绪/失败），FAILED 在缩略图、SceneEditor 预览(`SceneEditor.tsx:156-163`)、行内重试按钮(`SceneList.tsx:591-597`)三处都有红色 `AlertCircle`/`RotateCw`。历史「FAILED 无反馈」P0 已修。
- 批量/单卡生成已透传 `imageConfigId`（`SceneList.tsx:237-245/577/690`）；生成走统一 `derivePromptInputs`+`buildFinalPrompt`，多配置对话框也复用（`page.tsx:583-587`）。历史「批量丢配置 / 多配置绕过 prompt」P0 已修。
- 导出轮询用 `exportPollRef` + `stopExportPoll`，卸载/关弹窗均清理（`page.tsx:80-88/543`）；导出完成弹窗内有 `<a download>` 兜底（`ExportDialog.tsx:97-106`）。历史「轮询泄漏 / 导出静默」P0 已修。
- keystroke 防抖落库：`SceneEditor.tsx:82-96` 本地 draft + 400ms debounce；scene 更新走乐观更新 `setQueryData`（`use-editor-project.ts:245-283`）。历史「狂写 DB / 全量 invalidate」P1 已修。
- 预览所见即所得**很完整**：`preview-player.tsx` 已同步 滤镜(`renderMedia`277)、变速(`effDur`106)、转场双层叠化(`transitionLayerStyle`244)、水印(350)、贴图(381)、字幕样式(399)，且水印未上传 logo 有防呆提示(374)。这是项目强项。

### 当前仍存在的交互断点

- **时间轴播放与中/右栏不联动**：`timeline-editor.tsx:123` 算出 `currentScene`，但播放循环(`88-109`)**从不调用 `onSceneSelect`**。底部时间轴播放时，中栏 SceneList 高亮、右栏 SceneEditor 内容、底部播放头三者各走各的——播放头在动，但「选中分镜」不跟随。`page.tsx:397` 只在**点击**轨道时才 `onSceneSelect`。
- **选中分镜不滚动入视**：全项目无 `scrollIntoView`（grep 仅命中历史报告自身）。当分镜 >10 个、从时间轴/预览切换分镜时，中栏 `SceneList.tsx:290` 的滚动容器**不会滚到选中项**，用户得手动找。
- **WorkflowPanel 默认折叠且不自动展开**：`WorkflowPanel.tsx:41` `expanded` 初始 `false`，无 `useEffect` 监听 `isRunning`。点「Agent 全自动生成」后底部只冒出一行折叠摘要，首次用户极易以为「没反应」。历史 P1 未修。
- **无任何键盘快捷键**：grep 全编辑器仅 `EditorHeader.tsx:48` 标题输入框的 Enter。无 空格播放/暂停、←→ 切分镜、Delete 删分镜、Cmd+S 等。对标剪映/CapCut 这是基础缺失。
- **无撤销/重做**：grep `undo|redo|history` 零命中。删除分镜(`SceneList.tsx:151-165`)、拖拽排序、字段编辑全部不可逆；删除仅靠 `toast.confirm` 二次确认(153)，误删无救。
- **无自动保存状态指示**：标题旁永远写死「编辑中」(`EditorHeader.tsx:61`)，与真实保存状态无关。debounce 落库(`SceneEditor.tsx:89`)、乐观更新失败回滚(`use-editor-project.ts:261`)对用户**完全不可见**——保存中/已保存/保存失败无任何 UI。
- **完全无移动端/响应式适配**：三栏写死 `ScriptPanel w-[22%] min-w-[256px]`(`ScriptPanel.tsx:47`) + `SceneEditor w-[30%] min-w-[320px]`(`SceneEditor.tsx:100/127`)，中栏 `flex-1`。两侧 min-w 合计 576px，加中栏与时间轴，<1024px 即横向溢出/挤压，平板竖屏和手机不可用。全编辑器无 `sm:/md:/lg:` 断点。
- **批量入口三处重复、职责混乱**：顶部「批量生成」(`SceneList.tsx:226-259`，仅图片、自动跳过已有) + 底部三条「批量图片/视频/配音」(`SceneList.tsx:672-779`) + 单卡按钮(497-660)。同一「批量图片」语义出现两次（顶部 vs 底部），逻辑还不完全一致（顶部用 `batchGenerateImagesMutation` 串行，底部直接 `forEach` 全并发）。历史 P1 未整合。
- **批量视频/配音 forEach 全并发**：`SceneList.tsx:718-730/755-767` `project.scenes.forEach(... mutate())` 对 20+ 分镜同时发请求，无并发上限；而图片批量(`batchGenerateImagesMutation` `use-generation-actions.ts:275`)是串行 `for`。三类批量并发模型不一致，视频/配音易撞 provider 速率/连接上限。历史 P1 未修。
- **WorkflowPanel 失败无重试入口**：`WorkflowPanel.tsx:166` 失败只显示红字 error，无「重试/查看详情」按钮；用户得回左栏重新点。
- **时间轴「列宽固定、轨道不可调」**：`timeline-editor.tsx:40` `TRACK_HEIGHT=48` 写死，无轨道高度调节、无 Hide/Lock/Mute、缩放只有 range slider 无 Ctrl+滚轮。对标 CapCut Web 差距明显（历史 P2 未做）。

---

## 2. 问题分级（每条带影响面）

### P0（阻断 / 核心流程体验失效）

| #    | 问题                                          | 证据                                                                              | 影响面                                                                                 |
| ---- | --------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P0-1 | 时间轴播放时「选中分镜」不跟随，中/右栏不联动 | `timeline-editor.tsx:88-123` 播放循环不回传 `onSceneSelect`                       | 所有用户。播放预览时右栏不更新，无法边播边对照编辑，核心审片流程割裂                   |
| P0-2 | 选中分镜不自动滚动入视                        | 全局无 `scrollIntoView`；`SceneList.tsx:290`                                      | 分镜>10 的项目（即正常项目）。从时间轴/预览/搜索切分镜后中栏不动，用户「丢失当前位置」 |
| P0-3 | 无移动端/平板适配，<1024px 布局崩             | `ScriptPanel.tsx:47` / `SceneEditor.tsx:100` 写死 `w-[22%]/w-[30%]+min-w`，无断点 | 平板/手机用户 100% 不可用；笔记本小屏挤压。对短剧创作者（多移动办公）影响大            |

### P1（严重 / 显著体验损失）

| #    | 问题                                 | 证据                                       | 影响面                                                      |
| ---- | ------------------------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| P1-1 | WorkflowPanel 默认折叠、不自动展开   | `WorkflowPanel.tsx:41` 无 isRunning→expand | 用 Agent 全自动的新用户，误判「无反应」放弃                 |
| P1-2 | 无自动保存状态指示，「编辑中」写死   | `EditorHeader.tsx:61`；保存/失败无 UI      | 全体。改了不知有没有存，失败回滚无感知，信任缺失            |
| P1-3 | 无键盘快捷键（空格/←→/Delete/Cmd+S） | grep 仅标题 Enter                          | 重度用户效率低，与剪映/CapCut 基础体验断层                  |
| P1-4 | 批量视频/配音 forEach 全并发无上限   | `SceneList.tsx:718-730/755-767`            | 大项目批量时撞 provider 速率限制 → 大面积 FAILED + 积分浪费 |
| P1-5 | 批量入口三处重复、并发模型不一致     | 顶部 `:226` / 底部 `:672` / 单卡 `:497`    | 认知负担；同名按钮行为不一致引发困惑                        |

### P2（改进 / 锦上添花）

| #    | 问题                                           | 证据                                | 影响面                          |
| ---- | ---------------------------------------------- | ----------------------------------- | ------------------------------- |
| P2-1 | 无撤销/重做                                    | grep 零命中                         | 误删/误排序不可逆，高级用户痛点 |
| P2-2 | Workflow 失败无重试入口                        | `WorkflowPanel.tsx:166`             | 失败后操作绕路                  |
| P2-3 | 时间轴轨道不可调高/隐藏/锁定，缩放无 Ctrl+滚轮 | `timeline-editor.tsx:40,276`        | 对标 CapCut 的精修能力差距      |
| P2-4 | 预览弹窗无键盘控制、无全屏                     | `page.tsx:505-532` 弹窗壳无 keydown | 预览审片体验弱于播放器标准      |

---

## 3. 具体优化方案（可落地）

### P0-1 时间轴播放联动（S）

`timeline-editor.tsx` 播放 effect 内，当 `currentScene` 跨镜变化时回传选中。用 ref 防重复触发：

```tsx
// timeline-editor.tsx，新增
const lastEmittedRef = useRef<string | null>(null);
useEffect(() => {
  if (isPlaying && currentScene && currentScene.id !== lastEmittedRef.current) {
    lastEmittedRef.current = currentScene.id;
    onSceneSelect(currentScene.id); // 播放推进时同步选中 → 中/右栏跟随
  }
}, [isPlaying, currentScene, onSceneSelect]);
```

preview-player 已在切镜时回传(`preview-player.tsx:150/213/221`)，无需改。

### P0-2 选中分镜滚动入视（S）

`SceneList.tsx` 给每张卡挂 ref，监听 `selectedSceneId`：

```tsx
const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
useEffect(() => {
  if (selectedSceneId) {
    itemRefs.current
      .get(selectedSceneId)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}, [selectedSceneId]);
// 卡片根节点：ref={(el) => { if (el) itemRefs.current.set(scene.id, el); }}
```

### P0-3 响应式三栏（M）

- 断点策略：`lg:`(≥1024) 三栏并排；`md:`(≥768) 左栏抽屉化（ScriptPanel 改为可收起 drawer，默认收）；`<md` 单栏 + 底部 Tab 切「脚本/分镜/编辑」。
- 把 `w-[22%]`→`lg:w-[22%] w-full`，外层 `flex` 改 `flex-col lg:flex-row`。
- 时间轴 `<md` 默认隐藏（`showTimeline` 初值按 `window.matchMedia` 设）。
- 最小可落地版（不重排，仅止血）：外层加横向滚动容器，避免内容截断。

### P1-1 Workflow 自动展开（S）

```tsx
// WorkflowPanel.tsx
const [expanded, setExpanded] = useState(false);
const [prevRunning, setPrevRunning] = useState(false);
if (isRunning !== prevRunning) {
  // 渲染期同步，避免 effect 级联
  setPrevRunning(isRunning);
  if (isRunning) setExpanded(true); // 开始运行强制展开
}
```

### P1-2 自动保存状态指示（S-M）

`useEditorProject` 暴露聚合保存态（任一 mutation `isPending`/`isError`），Header 替换写死的「编辑中」：

```tsx
const isSaving = updateSceneMutation.isPending || updateTitleMutation.isPending || updateCharactersMutation.isPending;
const saveError = updateSceneMutation.isError || ...;
// EditorHeader: isSaving ? "保存中…" : saveError ? "保存失败" : "已保存"（带颜色/图标）
```

### P1-3 键盘快捷键（M）

page.tsx 顶层挂全局 keydown（输入框 focus 时跳过）：

- `Space` 播放/暂停预览或时间轴；`←/→` 上/下一镜（`setSelectedSceneId`）；`Delete` 删当前镜（走 confirm）；`Cmd/Ctrl+S` 阻止默认（已自动保存，给 toast「已自动保存」）；`Cmd/Ctrl+E` 导出。

```tsx
useEffect(
  () => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;
      // ...路由各快捷键
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  },
  [
    /* deps */
  ]
);
```

### P1-4 批量并发上限（S）

统一并发控制（轻量自写，无需引库）。把底部 forEach 与 `batchGenerateImagesMutation` 都改成并发度 3-5 的 pool：

```ts
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (it: T) => Promise<unknown>
) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!).catch(() => {});
    })
  );
}
```

视频/配音批量改用 `runPool(scenes, 3, ...)`；图片批量同步。

### P1-5 批量入口合并（S）

删顶部「批量生成」按钮(`SceneList.tsx:226-259`)，统一到底部三条带 ModelSelector 的批量区；单卡按钮保留为「单镜精修」。底部区加「智能：仅缺失 / 全部重做」下拉，覆盖顶部原语义。

### P2 项

- 撤销栈：维护本地 `Scene[]` 快照栈（最近 20 步），Cmd+Z 回滚 + 重放 PATCH；或先只对「删除」做 undo toast（删后 5s 内可撤销，最低成本）。
- Workflow 失败重试：`WorkflowPanel.tsx:166` error 块加按钮回调 `onRetry`（page 复用 `workflow.start`）。
- 时间轴增强：`TRACK_HEIGHT` 改 state + 拖拽手柄；Ctrl+滚轮 `onWheel` 调 `zoom`；轨道左侧加 Hide/Mute 图标（对标 CapCut）。
- 预览键盘+全屏：弹窗壳加 keydown（Esc 关、Space 播放）+ `requestFullscreen`。

---

## 4. 行业标杆对标

| 能力                 | 本项目现状                                      | 剪映/CapCut Web               | Runway / Pika | 差距                         |
| -------------------- | ----------------------------------------------- | ----------------------------- | ------------- | ---------------------------- |
| 播放头联动选中       | ❌ 播放不跟随(P0-1)                             | ✅ 播放头/选中/属性面板三联动 | ✅            | **关键差距**                 |
| 列表自动定位         | ❌ 无 scrollIntoView(P0-2)                      | ✅                            | ✅            | 关键差距                     |
| 键盘快捷键           | ❌ 仅标题 Enter                                 | ✅ 空格/JKL/分割/删除全套     | ✅ 基础       | 大                           |
| 撤销/重做            | ❌ 无                                           | ✅ 完整历史栈                 | ✅            | 大                           |
| 自动保存指示         | ❌ 写死「编辑中」                               | ✅ 云端自动保存提示           | ✅「Saved」   | 中                           |
| 移动端/平板          | ❌ 写死 % 宽溢出                                | ✅ 响应式+移动 App            | 部分          | **大**（短剧场景移动办公多） |
| 所见即所得预览       | ✅ 滤镜/变速/转场/水印/贴图/字幕全同步          | ✅                            | 部分          | **持平甚至领先**，是强项     |
| 分镜三状态/网格/重排 | ✅ 已具备                                       | ✅                            | ✅            | 持平                         |
| 多模型并行生成       | ✅（MultiGenerateDialog）但批量无并发上限(P1-4) | N/A                           | ✅ 队列管理   | 队列治理待补                 |
| 时间轴轨道治理       | ⚠️ 4 轨固定，无 Hide/Lock/调高                  | ✅ 无限轨道+治理              | N/A           | 中                           |

结论：**生成侧/所见即所得已接近标杆**，但**编辑器「时间轴-列表-属性」三联动、键盘、撤销、移动端**这几项「剪辑软件基本功」是与剪映/CapCut 的主要体验鸿沟。

---

## 5. 实施优先级与工作量估算

| 批次                             | 内容                                                                   | 工作量           | ROI                                                           |
| -------------------------------- | ---------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| **批次 1（联动止血，最高 ROI）** | P0-1 播放联动 + P0-2 滚动入视 + P1-1 Workflow 自动展开 + P1-2 保存状态 | **S×4 ≈ 半天**   | 极高：纯前端、零后端、风险低，直接补齐三联动核心断点          |
| **批次 2（效率/稳定）**          | P1-3 键盘快捷键 + P1-4 批量并发池 + P1-5 入口合并                      | **M+S+S ≈ 1 天** | 高：并发池防 FAILED 浪费积分；快捷键提效                      |
| **批次 3（移动端）**             | P0-3 响应式三栏（先抽屉化左栏 + flex-col 断点）                        | **M ≈ 1-1.5 天** | 高但工作量大：建议先做「<lg 横向滚动止血」(S)，再迭代真响应式 |
| **批次 4（精修对标）**           | P2 撤销栈 + Workflow 重试 + 时间轴轨道治理 + 预览键盘/全屏             | **L ≈ 2-3 天**   | 中：锦上添花，对标 CapCut                                     |

> 落地按项目约定走 SSH 改线上 `/software/ai-comic-drama/`（端口 3100，systemd），build 用 `NODE_OPTIONS=--max-old-space-size=1024`。

---

## 附：已确认修复（不重复历史报告，仅备查）

真拖拽(dnd-kit) ✅ / FAILED 三处反馈+重试 ✅ / 批量·多配置透传 imageConfigId ✅ / 生成统一 buildFinalPrompt+三视图参考图 ✅ / 导出轮询清理+download 兜底 ✅ / keystroke debounce ✅ / scene 乐观更新替代全量 invalidate ✅ / updateProject 补 invalidate ✅ / 波形 useMemo 固定 ✅ / 分镜网格密度切换(list/grid2/grid3) ✅ / 三点菜单(复制/插入/删除) ✅ / Workflow completed 回调 invalidate ✅ / 紫色 token 化(bg-agent) ✅ / Film 图标空状态 ✅ / 表单 focus ring ✅。
