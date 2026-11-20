# 热点体验与模块导航优化 — 2026-11-19

## 推理与范围

沿用当前鉴权、持久搜索任务、共用模型选择和幂等保存接口，不增加模型请求或数据库变更。已阅读根 AGENTS、frontend-patterns、tdd-workflow 及 /software/codex-bootstrap/codex/skills 下 init/taskflow/governance 协议；sequential-thinking 工具不可用，采用手工推理：先复现状态错误，再修改局部 UI，统一验证后发布；回滚只需还原本轮前端文件，已有任务和作品不受影响。共享 .codex 由主 agent 维护。

发现：首次读取最近任务前可发起新搜索；读取另一份简报会保留旧选题；保存 AI 简报和规则草案共用反馈；未知结果缺少操作指引；报表校验失败会直接抛错。原移动端表格必须横向滚动，JSON 是草案唯一编辑入口，导航缺少当前位置。

## 文件级计划

- `app/e2e/components/short-video-discovery-ux.spec.ts`：先覆盖读取期间阻止提交、切换简报清理草案、未知状态和可视化编辑、移动端无溢出。
- `app/src/components/short-video/hot-discovery.tsx`：防重复/状态隔离、稳健响应校验、错误与空态、可视化草案编辑、响应式结果卡片。
- `app/src/components/short-video/navigation.tsx`（新增）：客户端路由高亮，复用 Next Link 和 Lucide。
- `app/src/app/(dashboard)/short-videos/layout.tsx`：保留服务端权限检查，统一模块标题与导航。

浏览器 fixture 继续使用已有 short-video 页面，不新增生产路由。所有网络/收费模型在浏览器中拦截；不触及生产数据。

## 验证

待实现后补充具体结果。

## 2026-11-20 主agent整合

已完成工作台/热点及导航整合，第二轮22项短视频浏览器通过。补齐模板选择、POST任务固定读取、select显式标签、JSON结构防御以及指标数字表单和跨刷新幂等重试。最终完整回归与发布结果见optimization-release-2026-11-20.md；此前手工推理之后，恢复会话已调用可用的sequential-thinking。
