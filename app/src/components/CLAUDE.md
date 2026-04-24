[根目录](../../../../ARCHITECTURE.md) > [app](../../../CLAUDE.md) > [src](../../CLAUDE.md) > **components**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# components — UI 组件库

## 模块职责

放置**可复用的 React 组件**；按领域或形态做子目录。所有 UI 组件默认为 **Client Component**（`"use client"`），除非明确标注。

## 目录约定（推测 + 实际）

| 子目录 | 用途 |
|--------|------|
| `ui/` | shadcn/ui 生成的原子组件（Button / Dialog / Input / Select / Tabs 等），由 shadcn CLI 管理 |
| `ai-models/` | AI 模型配置相关组件（`MultiGenerateDialog` 等） |
| `providers.tsx` | 全局 Provider：`SessionProvider`（NextAuth）+ `QueryClientProvider`（React Query） |
| `timeline-editor.tsx` | 编辑器底部时间轴（分镜拖拽 + 时长调整） |
| `preview-player.tsx` | 预览播放器（逐分镜播放图像/视频 + TTS） |
| （其他领域组件） | 角色卡、场景卡、配置面板等 |

> 具体组件清单以实际目录为准；本索引仅给出已识别到的子集。

## 关键约定

1. **原子优先**：尽量用 shadcn/ui 原子组件拼业务组件，避免直接写原生 `<button>`。
2. **样式**：Tailwind v4；`class-variance-authority (cva)` 管理变体；`tailwind-merge` 合并冲突类；`clsx` 拼接条件类。
3. **图标**：`lucide-react`。
4. **表单**：`useState` 本地管理；复杂表单可引入 `react-hook-form` + `zod`（未统一，看具体组件）。
5. **数据获取**：组件内部尽量**不直接 fetch**；由上层 hooks（`use-*.ts`）注入数据/回调。

## 几个值得关注的组件

| 组件 | 位置提示 | 作用 |
|------|---------|------|
| `MultiGenerateDialog` | `ai-models/` | 支持选择多个 AI 配置，串行/并行批量生成（图/视/音） |
| `TimelineEditor` | 根目录 | 底部时间轴，分镜横向滚动 + 时长调整 |
| `PreviewPlayer` | 根目录 | 按场景顺序播放生成的媒体资产 |
| `Providers` | 根目录 | 根布局中包装子树 |

## 添加新组件的流程（shadcn）

```bash
# 在 app/ 目录下运行
pnpm dlx shadcn@latest add dialog
# 或其他组件名：button / input / select / tabs / dropdown-menu / tooltip ...
```

## 常见坑

- **Server/Client 边界**：组件引用 Zustand/React Query/浏览器 API 时必须 `"use client"`。
- **Tailwind v4**：v4 的 `@import "tailwindcss";` 语法与 v3 不同；新增组件注意 class 是否生效。
- **Radix UI Portal**：`Dialog` 等组件默认挂载到 body，z-index 需注意；全屏遮罩常用 `bg-black/80 fixed inset-0 z-50`。

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师）；标注为 light 覆盖度，推荐后续对子目录逐一补扫 |
