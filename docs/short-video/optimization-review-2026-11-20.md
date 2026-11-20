# 短视频优化最终审查 — 2026-11-20

按项目 taskflow/governance 与 ECC TDD/security-review 补充规范检查。已调用 sequential-thinking；主 agent 统一维护 .codex 验证与生产部署。本轮不改 schema，不读写生产数据库，不调用付费模型或平台。

## 审查发现与修复

1. 默认 AI 热点简报收藏会创建无模板作品；详情脚本改编要求模板，且原更新合同不支持补模板，导致“AI搜索 → AI改编”无法接续。新增 `VideoPatchZ.templateId`（可空），`patchVideo` 在原请求收据事务、作品归属、空闲与版本 CAS 约束内检查模板归属/启用状态；允许选择与清除。详情模板 UI 由主 agent 实施。既有模板不自动替换，原不可变脚本和计划证据保留。
2. 工作台只防同任务版本回退；新任务 POST 后刷新拿到旧列表的另一任务 ID 仍可能覆盖新任务。已交主 agent 补保护与浏览器验证。
3. 指标重试的采集时间仅保存在组件内存，父请求收据虽在 sessionStorage，刷新后新时间仍导致新请求。已交主 agent 补持久化与刷新重试验证。
4. 热点未知请求确认“另建”时，若先前 POST 丢失响应导致 pending 请求号仍保留，同参数可能复用旧请求号而只读取旧任务。该行为不会重放收费，但不符合另建语义；已反馈主 agent。

## 已核查的保留防护

- 列表游标和关键词各含 OR，现用 AND 组合；所有查询仍联查当前 userId/archivedAt，READY只按同用户已验证未归档 VIDEO 推导。
- 发布审核现有 `reviewHash` 严格联查 userId/videoId/kind/verifiedAt/archivedAt，COVER不能作为成片，封面也必须归属同一作品。
- 本地合成恢复仅在所有未完成步骤均为 COMPOSE 时绕过付费开关；未知/提交中/处理中仍被恢复前置条件阻止，计划指纹、场景和租约检查保留。
- 可视化脚本编辑在独立放宽文本的结构合同下渲染，保存仍用完整 ScriptZ；高级 JSON 损坏不会直接当合法脚本执行。

## 验证记录

新增两项隔离 PG 测试先运行 RED：2项按预期失败，报不允许 templateId；另匹配 template 的原用例1项通过。日志 `/tmp/sv-template-review-red.log`。

新增用例验证：无模板作品补选后创建未确认脚本计划且无模型调用；同收据重放不增版本；跨用户模板/停用模板返回404；清除模板；旧版本CAS返回409；确认任务后变更模板返回ACTIVE_RUN。

最终整文件 PG **31/31通过**（32.26秒），日志 `/tmp/sv-template-review-green.log`。数据库严格使用 `127.0.0.1:55439/ai_comic_verify_short_video_final`。首次无效patch因测试describe名称不匹配而被拒绝，未改文件；随后按真实名称应用测试。第一次文档写入使用app工作目录相对路径而失败，未改文件，已改绝对路径写入。

回滚仅恢复本轮合同/store/UI；无数据库迁移，已保存的模板关联使用既有字段。
