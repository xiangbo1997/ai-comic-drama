[根目录](../../ARCHITECTURE.md) > [app](../CLAUDE.md) > **src**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# app/src — 源码主目录

## 模块职责

Next.js 应用的全部 TypeScript 源码；按关注点拆分为 `app`（路由）/ `services`（业务服务）/ `lib`（基础设施）/ `stores`（客户端状态）/ `components`（UI）/ `types`（类型定义）。

## 子模块导航

| 子目录        | 职责                                                                | 文档                                           |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `app/`        | Next.js App Router：页面、布局、API                                 | [app/CLAUDE.md](./app/CLAUDE.md)               |
| `services/`   | 业务服务层：AI、队列、存储、支付、Agent                             | [services/CLAUDE.md](./services/CLAUDE.md)     |
| `lib/`        | 基础设施：认证、加密、DB、日志、限流、内容安全、Prompt              | [lib/CLAUDE.md](./lib/CLAUDE.md)               |
| `stores/`     | Zustand 客户端状态                                                  | [stores/CLAUDE.md](./stores/CLAUDE.md)         |
| `components/` | React 组件 + shadcn/ui                                              | [components/CLAUDE.md](./components/CLAUDE.md) |
| `types/`      | TypeScript 类型集中导出（`project` / `scene` / `character` / `ai`） | —                                              |

## 导入别名

`tsconfig.json` 中配置了 `@/*` → `./src/*`。所有 src 内部互相引用应**优先用 `@/` 别名**，避免相对路径层级过深。

## 依赖分层（强约定）

```
components  ─┐
stores      ─┼─> services ─> lib ─> types
app/api     ─┤            ─> lib
app/pages   ─┘
```

- **禁止反向依赖**：`lib` 不得引用 `services / components / stores / app`。
- **services 之间**允许相互引用；但建议通过 `index.ts` 的 barrel export 做门面。

## 变更记录 (Changelog)

| 日期       | 说明                               |
| ---------- | ---------------------------------- |
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师） |
