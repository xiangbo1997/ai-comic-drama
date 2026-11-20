# 抽象短视频后端优化 — 2026-11-19

## 推理与边界

已按根AGENTS读取init/taskflow/governance项目技能及ECC TDD、安全审查；由主agent统一初始化与更新.codex。本分工检查作品、脚本、计划、worker、素材、审核、排期、回填与指标。sequential-thinking当前不可调用，采用代码/测试证据和手工推理。无需新增schema、依赖或生产数据变更。回滚为正常revert本轮代码，不删除已生成凭证或数据库行。

## 文件级计划

1. `services/short-video/runs.ts`：允许已完成全部模型步骤、只剩本地合成的暂停任务在付费开关关闭后恢复；含未完成模型步骤仍阻止恢复。
2. `services/short-video/store.ts`与`lib/short-video/contracts.ts`：作品列表q检索标题/brief，status为现有当前脚本/真实成片推导的DRAFT、SCRIPTED、READY，保持归属与分页约束。
3. `tests/integration/short-video.postgres.ts`：先复现本地合成恢复失败、检索/进度过滤缺失；补封面不能冒充成片的审核防护。仅使用显式本机隔离PG测试库；模型/平台调用为替身，存储和FFmpeg真实。

## 审查发现

- 恢复入口无条件要求付费开关开启，但worker本地COMPOSE路径本已允许付费关闭后运行，导致已生成素材被困在暂停任务。
- 作品列表忽略q/status参数，前端筛选无法跨页正确工作。
- 审核快照已有严格的VIDEO/verifiedAt/archivedAt校验；需回归证明COVER传为成片会拒绝。

## 验证

- 红灯复现：新增4项隔离PG回归，恢复/筛选2项按预期失败，待生成任务禁用/封面防护2项通过。证据`/tmp/short-video-backend-red.log`。首个编辑命令误用app为工作目录、相对docs路径不存在而退出；未修改文件，已改用仓库根目录重执行。
- 基础修复后：原整文件与新增回归共28/28通过，`/tmp/short-video-backend-green.log`。
- 最终PG：29/29通过，42.34秒，`/tmp/short-video-backend-final.log`。只连接`127.0.0.1:55439/ai_comic_verify_short_video_final`，配置拒绝非本机或非ai_comic_verify前缀数据库。
- 快速单元/API/上传边界：3文件20/20通过，`/tmp/short-video-backend-unit.log`。
- 改动源码/PG的ESLint与Prettier、git diff --check通过；完整类型/构建由主agent统一在隔离构建目录运行，不碰生产.next。覆盖率与发布验收由主agent汇总。

## 列表API合同

`GET /api/short-videos/videos`沿用limit/cursor，新增q（trim后最多200字符，标题或brief不区分大小写包含检索）、status（可选DRAFT/SCRIPTED/READY）。服务端先按归属、归档、关键词、进度筛选再分页；下一页必须保留筛选参数。每个作品返回workflowStatus，与筛选使用相同进度定义：

- READY：currentArtifact为当前用户已验证且未归档的VIDEO。封面、未验证或失效视频不会误报成片。
- SCRIPTED：没有上述有效成片且currentScriptVersionId非空。
- DRAFT：没有上述有效成片且没有当前脚本。

这里表示创作进度；最新任务的PLANNED/RUNNING等状态继续保留在runs，互不冒充。恢复仅放行没有未完成模型步骤的本地合成；计划指纹、场景校验、租约与费用约束继续执行。

## 同一作品完整流程证据

新增PG用例`completes one source-to-publication journey with real composition, receipts, metrics and export SHA`：同一用户/作品依次导入来源、关联作品、保存不可变脚本、生成含配音计划、明确确认、worker执行IMAGE/VIDEO/TTS/COMPOSE、取得已验证成片、验证3笔积分账与支出一致、建立人工账号和发布草稿、审核hash、排期、到点进入AWAITING_MANUAL、回填作品链接和发布时间、记录指标、导出ZIP并解包video.mp4验证SHA256等于成片摘要。最后再次driveRun证明模型只各调用一次、积分账不重复。

生成模型和外部平台使用测试替身，媒体探测、FFmpeg、文件存储、Prisma/SQL事务、积分账和ZIP使用真实实现。隔离用例推进scheduledAt避免真实等待；回填证据明确为USER_REPORTED。未真实调用付费模型、未向外部平台投稿，本测试不证明模型视觉质量或平台官方自动发布能力。
