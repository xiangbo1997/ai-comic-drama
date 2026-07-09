---
name: a11y-systemic-gaps
description: Systemic a11y/responsive gaps found in ai-comic-drama app (HEAD 5f2831d) — aria-live/motion/hand-rolled-modals
metadata:
  type: project
---

审计 ai-comic-drama app 无障碍/响应式（HEAD 5f2831d，2026-07-04）发现三处**系统性**缺口，非单点：

1. **零 aria-live**：`grep aria-live|role=status|role=alert` = 0。Toast (`src/components/ui/toast.tsx`)、生成状态、批量进度、WorkflowPanel 进度对屏幕阅读器完全静默。修 toast 容器加 `role="status" aria-live="polite"` 收益最大（全局唯一出口）。

2. **零 prefers-reduced-motion**：`globals.css` 无 motion 媒体查询；全项目 37 个文件用 `animate-spin/pulse/in/out`。前庭障碍用户无豁免。一个 `@media (prefers-reduced-motion: reduce)` 全局块即可。

3. **~16 个手写模态绕过 Radix Dialog**：`src/components/ui/dialog.tsx`（Radix）已具备 focus trap/Esc/焦点返回，但 PaymentModal、CreateCharacterModal、ConfigDialog、editor 下多个 \*Dialog 用裸 `fixed inset-0` div，无 `role="dialog"`、无 Esc、无焦点陷阱。键盘用户被困。

**Why:** 团队已做过一轮 aria-label 补齐（icon-only 按钮），但结构性问题（动态播报/动效/模态语义）未覆盖。
**How to apply:** 下次做无障碍收口时，优先这三处「一处修全局」的杠杆点，而非逐个组件加 aria-label。

自定义下拉 `src/components/ai-models/model-selector.tsx` 用 button+div 手写，无 role=listbox/option、无方向键/Esc（应迁移到 `src/components/ui/select.tsx` 的 Radix Select）。

timeline-editor.tsx 拖拽手柄 `w-2`(8px) 且仅 onMouseDown（无 touch 事件）→ 触屏完全不可调时长。
