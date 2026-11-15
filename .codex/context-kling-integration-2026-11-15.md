# 可灵视频接入上下文
用户要求：参考可灵官方鉴权文档接入视频模型。现有 Next.js/TypeScript/Prisma 项目已具备视频异步任务、Provider 工厂、加密配置与 safeFetch；Kling 预设未激活且工厂不支持。修改范围为协议注册、图生视频 Provider、凭据配置与只读连接测试、预设同步和回归测试；不改 schema。
初始工作区：.codex/{operations-log,plan,reasoning,verification}.md 已修改，context-server-resources-2026-11-15.md 未跟踪，必须保留。磁盘约3.3GB空余，避免大型复制与覆盖在线.next。
凭据仅保存在既有加密配置或环境变量，不写入代码/日志。校验 URL 继续使用 safeFetch。连接测试不提交视频任务，不代表模型权限或余额通过。
