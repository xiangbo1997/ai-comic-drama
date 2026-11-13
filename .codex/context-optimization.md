# 上下文快照（2026-11-13）

- 项目：Next.js 16 / React 19 / TypeScript / Prisma 的 AI 漫剧工作台。
- 核心路径：点子/小说 → 世界观/剧本 → 角色 → 分镜 → 图像 → 视频 → 配音 → 审片/导出；已有制片人向导、自动工作流、手动编辑三类入口。
- 现有质量模块：episode-structure、shot-timing、genre-matrix、角色定妆、narrative-review、review-report；优先修复链路不一致。
- 本地存在 node_modules 与构建产物；脚本包括 type-check、lint、test、test:coverage、build、e2e。
- 外部产品事实需标注官方来源与访问限制，爆款属于目标，不能作效果保证。
- 全局设置及 MCP 安装不在本轮必要范围；保留现有权限，不修改用户全局配置。

## 第二轮接续

- 三条并行交付：手机创作/分镜/编辑、制片人安全重试、文本/视觉审片输入版本。
- 主agent修复生产重复schema剥离连续性字段、分镜镜号校验/镜长校准、定稿仅存artifact未同步DB；独立审查补齐空字段覆盖源地点/换装/轴线的边界。
- 完整五步刷新恢复未实现，不用本地状态冒充服务端checkpoint；真实数据库并发、付费样片及完整受保护页面E2E不在已验证范围。
- 第二轮报告入口：docs/optimization-round2-2026-11.md，最终结果以verification.md为准。
