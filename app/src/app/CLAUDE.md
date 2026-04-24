[根目录](../../../ARCHITECTURE.md) > [app](../../CLAUDE.md) > [src](../CLAUDE.md) > **app**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# app/src/app — Next.js App Router 根

## 模块职责

承载 Next.js 16 App Router 的**全部路由**：包括公共页面、受保护页面分组、以及所有 REST API。遵循文件系统即路由的 Next.js 约定，使用 Route Group `(auth)` / `(dashboard)` 做权限边界，使用 `api/` 集中后端端点。

## 入口与启动

| 文件 | 作用 |
|------|------|
| `layout.tsx` | 根布局：加载 Geist 字体 + `Providers`（React Query + Session） + 全局样式 |
| `globals.css` | Tailwind v4 全局样式（含 CSS 变量） |
| `page.tsx` | 首页（落地页） |

根布局关键代码：

```tsx
<html lang="zh-CN">
  <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
    <Providers>{children}</Providers>
  </body>
</html>
```

## 路由分组

| 分组 | 目录 | 说明 |
|------|------|------|
| **公共** | `(auth)/` | 登录/注册页（未登录可访问） |
| **受保护** | `(dashboard)/` | 需要 `auth()` 校验：`projects/`、`characters/`、`editor/[id]/`、`credits/`、`settings/ai-models/` 等 |
| **API** | `api/` | 所有服务端端点（详见 [api/CLAUDE.md](./api/CLAUDE.md)） |

## 对外接口

- **页面路由**：基于文件路径，如 `/editor/[id]` → `app/(dashboard)/editor/[id]/page.tsx`。
- **API 路由**：详见 [api/CLAUDE.md](./api/CLAUDE.md)。

## 关键依赖与配置

- `@/components/providers` —— 注入 `SessionProvider`（NextAuth）与 `QueryClientProvider`（React Query）。
- 字体：`next/font/google` 的 `Geist` + `Geist_Mono`。
- 页面元数据（`metadata`）：标题 "AI 漫剧 - 一键将小说转化为漫剧视频"。

## 测试与质量

当前仓库**未配置测试框架**；页面行为依赖 `pnpm type-check` + `pnpm lint` + `pnpm format:check` + `pnpm build`（等同 `pnpm ci`）保证。

## 常见问题 (FAQ)

- **新增受保护页面需要手动写 session 校验吗？**
  不需要在 `(dashboard)` 分组下创建页面；但 API 路由仍须显式 `const session = await auth()` 校验（项目约定）。
- **Route Group 会影响 URL 吗？**
  不会。`(auth)` 与 `(dashboard)` 仅用于组织，不出现在最终 URL 中。

## 相关文件清单

- `app/src/app/layout.tsx` —— 根布局
- `app/src/app/page.tsx` —— 首页
- `app/src/app/api/**/route.ts` —— API 路由
- `app/src/app/(dashboard)/**` —— 受保护页面
- `app/src/app/(auth)/**` —— 认证相关页面

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师） |
