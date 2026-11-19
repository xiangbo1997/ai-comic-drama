# AI 抽象短视频文件级实施计划

2026-11-19；D0 基线：工作区干净，`git fetch origin main` 后 `git merge --ff-only origin/main`，HEAD=82865ea，包含指定提交。无用户改动被覆盖。不执行付费调用、公开发布、生产数据库操作或部署。

## 指令与推理

已读根与 `.codex/AGENTS.md`、START-HERE、完整规格、project-ai-assistant 和相关源码。工作区无更深 AGENTS。指定 `skills/codex-init-protocol`、`codex-taskflow-protocol`、`codex-governance-communications` 在仓库及本机技能目录缺失；sequential-thinking 未提供。采用手工推理：先确认证据与边界，再新增隔离模型，显式确认后由持久 worker 执行，任何不明确的外部结果保守暂停。补充使用 tdd-workflow/security-review/verification-loop。保持项目级配置，不改全局权限、不安装 MCP。回滚为关闭开关、排空/核对在途任务并停止新 worker、回退代码，保留新增表。

## 实际复用与边界

- `services/generation/jobs/operation.ts` 已有 operationKey advisory lock、task callback、PENDING CAS。扩展明确 shortVideoRunId/leaseToken 父任务范围，不挪用 executionRunId，保留 assistant guard。
- `jobs/image.ts`、`video.ts` 已有异步生成、持久化与逐成功结算；新 worker 以原 taskId 核对，不再扣同笔费用，不在未知状态重新提交。
- `assistant-execution/{store,runner,tools,worker}.ts` 参考租约、恢复与只读核对机制，不创建伪 assistant run。
- `lib/ai-config.ts`、`system-config.ts`、`credits.ts`、`services/ai` 为唯一配置、报价、计费路径。
- `services/storage.ts` 扩展 key 解析/重新签名能力；`video-synthesis.ts` 复用路径消费，ffprobe 检查产物。
- Prisma 7/Next 16，现有 migrations 缺初始全表基线：隔离测试先从旧 schema 建基线再应用新增 SQL，生产禁止 db push，必须另核迁移历史。

## 文件级阶段

| 阶段 | 文件 | 内容/验证 |
|---|---|---|
| D0 | 本文件、connector-matrix.md、implementation-log.md、.codex/context-short-video.md、reasoning/plan/verification/operations-log | 基线、能力证据、测试旧失败、回滚边界 |
| D1 | app/prisma/schema.prisma、prisma/migrations/20261119000000_add_short_video/migration.sql | SvSource/Template/Video/VideoSource/ScriptVersion/Run/RunStep/Artifact/Account/Publication/Event/Metric/Discovery/Receipt/Worker；仅新增表和索引 |
| D1 | app/src/lib/short-video/{contracts,config,errors,hash,source,api}.ts；services/short-video/{store,connectors/contracts,connectors/index}.ts | 共享 Zod、开关、归属、事务收据、规范化、模板与作品、真实不可用能力 |
| D1 | app/src/app/api/short-videos/[...path]/route.ts、(dashboard)/short-videos/{layout,page,trends/page}.tsx | 统一分派薄路由、鉴权限流同源、列表与热点导入 |
| D2 | services/short-video/{scripts,plans,runs}.ts、lib/short-video/contracts.ts | 不可变脚本、原子版本、配置/价格/素材指纹、确认预算、专用 Project/Scene 映射 |
| D3 | services/generation/jobs/{types,operation,image,video}.ts、services/short-video/{executor,artifacts}.ts、services/storage.ts | 真实 jobs 适配、图/视频/TTS 凭证、持久化与探测、合成和上传 |
| D4 | services/short-video/{worker,leases}.ts、scripts/short-video-worker.ts、scripts/build-short-video-worker.mjs、package.json | 跨进程领取与资源锁、心跳、租约 fencing、未知核对、优雅退出；编译可运行产物 |
| D5 | services/short-video/{accounts,publications,metrics}.ts、(dashboard)/short-videos/{[id]/page,accounts/page,publications/page}.tsx、components/short-video/workbench.tsx | 审核摘要、人工账号、排期/CAS取消/迟到、人工包、回填与空指标 |
| D6 | services/short-video/connectors/*、connector-matrix.md | 逐平台能力合同；无核验渠道返回 BLOCKED，测试适配器仅测试注入，不开放伪 AUTO |
| D7 | app/tests/{lib,api,services}/short-video*.test.ts、tests/integration/short-video.postgres.ts、e2e/components/short-video.spec.ts | 单元/API/隔离PG竞争恢复/浏览器人工链路；回归原 assistant/jobs |
| D7 | app/deploy/ai-comic-short-video-worker.service、docs/short-video/{operations,implementation-log,acceptance}.md、app/.env.example | 配置、部署顺序、回滚、产物验证与第20节逐项状态 |

每阶段更新日志与验证。自动发现/发布/指标必须分别有真实官方权限与实测证据才标 VERIFIED；缺凭证不阻断内部链路。生产上线与真实外部调用另待用户确认。

## 实施中补充的实际文件

- `services/generation/segmented-video.ts`：现有一个VIDEO job可能提交多个分段，新增可选逐段guard，避免停止或租约失效后继续付费；旧调用不传时行为不变。测试先红后绿。
- `app/api/admin/cleanup/route.ts`、`app/api/generate/tasks/[taskId]/route.ts`、`lib/cleanup/attempt-retention.ts`：将shortVideoRunId加入长期凭证、僵尸回收和候选保留保护；只使用已有表/JSON字段，关闭功能且尚未迁移时旧路径仍兼容。
- `lib/env.ts`：新增可选短视频配置解析，不改变旧必填项或旧服务默认值。
- 本机发现原app/.next正由PID2198391的Next服务使用。所有Web构建转至独立临时副本，不覆盖运行中的构建。只读worker检查也在不含生产.env的副本中执行，显式连接隔离库。
