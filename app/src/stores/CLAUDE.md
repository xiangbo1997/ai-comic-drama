[根目录](../../../../ARCHITECTURE.md) > [app](../../../CLAUDE.md) > [src](../../CLAUDE.md) > **stores**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# stores — Zustand 客户端状态

## 模块职责

集中管理**纯客户端**的 UI 状态（与 React Query 管理的服务端数据互补）。遵循**不可变更新**原则：所有 setter 只产生新对象，绝不 mutate。

## 文件

| 文件 | 导出 | 说明 |
|------|------|------|
| `project.ts` | `useProjectStore` | 项目/场景/角色/选中态/生成锁 |
| `user.ts` | `useUserStore`（参考实现） | 用户级偏好 |

## `useProjectStore` 状态形状

```ts
interface ProjectStore {
  project: Project | null;
  scenes: Scene[];
  characters: Character[];
  selectedSceneId: string | null;
  isGenerating: boolean;

  // 项目
  setProject(project): void;

  // 场景
  setScenes(scenes): void;
  addScene(scene): void;
  updateScene(id, updates): void;
  removeScene(id): void;                 // 若删的是当前 selected，自动清空
  reorderScenes(fromIndex, toIndex): void; // 重排后 order 字段重新计算

  // 角色
  setCharacters(characters): void;
  addCharacter(character): void;
  updateCharacter(id, updates): void;
  removeCharacter(id): void;

  // UI
  setSelectedSceneId(id): void;
  setIsGenerating(isGenerating): void;

  reset(): void;  // 全部清空，退出项目时使用
}
```

## 使用约定

- **服务端数据优先 React Query**：本 store 只装载"当前页面需要共享"的派生/选中态。
- **不要把 React Query 的 data 直接灌进 store**：会导致双源真相。
- **不可变更新**：所有 `updateScene / updateCharacter / reorderScenes` 都要返回新数组/对象引用；禁止 `state.scenes[i].x = y`。
- **与编辑器 hooks 的分工**：`use-editor-project.ts` 内部仍主要用 React Query；Zustand 主要用于跨组件共享临时选中态（例如 `selectedSceneId`）。

## 关键依赖

- `zustand ^5.0.9`
- `@/types`（`Project / Scene / Character`）

## 扩展点

- 新增一个需要跨组件共享的 UI 状态时，**优先评估能否用 `useState + Context`**；若跨 5+ 组件才提升到 store。
- 跨路由的状态（例如 "上次查看的项目 ID"）可加 `persist` middleware 持久化到 localStorage。

## 常见坑

- **Server Component 误用**：`useProjectStore` 只能在 `"use client"` 组件内调用。
- **SSR 水合**：避免在 store 初始状态读 `localStorage`；应在 `useEffect` 中懒初始化。
- **与 React Query 不同步**：服务端改动后记得 `queryClient.invalidateQueries`，不要手工 `setScenes`。

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师） |
