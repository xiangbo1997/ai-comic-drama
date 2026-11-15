# 项目 AI 助手上下文（2026-11-14）

后续状态：用户追加明确“部署”，已于2026-11-14 11:55:41 UTC完成生产迁移和应用上线。版本`508e22b-assistant-d3ddbf544ff6`，备份及14项线上验收见verification.md。下文“不自动部署”是开发阶段边界，已被该明确授权覆盖。

- 用户要求：集成项目内 GPT/文字模型助手，辅助决策、关联本地剧情数据，每部剧独立记忆，并明确要求多 agent 分析讨论和实施。
- 初始化审计：sequential-thinking 工具不可用；此前检索确认 codex-init-protocol、codex-taskflow-protocol、codex-governance-communications 技能缺失。使用人工分析、阶段文件、最小补丁和实际验证；不安装未知技能或修改全局权限。
- 人工推理：Series 是跨集容器，Project 是单集或独立作品。因此服务端按用户+Series/独立Project解析唯一助手范围；当前集上下文单独标明。聊天与用户确认的长期记忆分离，避免把模型猜测写入 storyBible。
- 并行分工：assistant_product_ui 负责组件、入口和浏览器测试；assistant_backend_memory 负责三表持久化、归属校验、租约、幂等、API、迁移文件及隔离 PostgreSQL 测试；assistant_context_model 负责有预算的真实上下文和既有文字模型接入；root 负责契约、集成审查和验收。
- 方案：GET /api/assistant；POST /api/assistant/messages；PATCH /api/assistant/memory；DELETE /api/assistant/messages。projectId/seriesId 恰好其一。显式记忆可编辑、版本锁；成功对话原子保存、请求幂等、同范围并发锁、失败释放和过期回收。
- 模型：复用现有文字配置，显式模型选择必须验证权限、类别及模型清单；单次75秒、有限输出，限流，无自动付费重试。
- 安全：服务器授权查询上下文，禁止接受客户端伪造项目资料，不传凭证、配置、素材二进制；资料作为数据，助手只提供建议，不执行剧情写入或生成。
- 验收：类型/格式/lint，核心单测与路由测试，临时 PostgreSQL 真数据库并发与迁移测试，真实 Chromium 组件交互。测试不使用线上数据库或付费模型。
- 回退：保留本任务之前所有未提交修改；只按本任务文件还原。新表迁移为增量，未经运行环境确认不执行生产迁移；本轮不自动部署，避免生产旧构建和新schema错配。若集成需要线上启用，再使用备份、迁移核验和服务健康检查流程。
