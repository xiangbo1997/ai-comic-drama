# 共用模型设置与联网热点搜索 — 2026-11-19

用户明确优先效果并授权付费模型，随后要求搜索纳入完整项目的共用模型设置。基线5808536/线上d992a66；保留原并行整合。项目协议与ECC TDD/security沿用，缺失sequential-thinking采用人工分析，见.codex/context-hot-model-search-2026-11-19.md。

1. `lib/ai-web-search.ts`：能力与结果共享合同。仍属于LLM，使用UserAIConfig.extraConfig.webSearchTransport（off/responses），不新增数据库分类或迁移，不靠名称推断搜索能力。
2. `services/ai/web-search.ts`：复用AIServiceConfig、safeFetch与observability，调用真实Responses+web_search；验证完成的搜索工具记录和URL引用，返回最后的正式回答、来源、模型和真实usage。单次请求有超时/流限额、禁止自动重试，不记录Key。chatgpt2api存在参数422/重复输出/引用丢失，不能伪装通过。
3. `services/ai/connectivity-test.ts`及模型configs接口、ConfigDialog：在共用设置中声明/测试联网能力，列表仅暴露非秘密能力；模型/地址/协议/能力变化使旧测试失效。测试遵循现有已保存/未保存表单状态语义。
4. 共用`components/ai-models/model-selector.tsx`增加可选能力过滤，不影响旧入口。热点HotInput支持显式searchConfigId，UI选择同一配置。未选择保持原免费榜单，选择后明确使用模型，不隐式换账号/接口。
5. 热点store复用SvDiscoveryJob及receipt；模型搜索提交前持久记录，延长租约，过期/未知不自动重放收费请求；结果保存AI回答/引用/usage，公开榜单事实继续保留。增加收藏AI简报为作品入口，不自动生成或投稿。
6. 热点UI优先展示真实AI回答与来源，原规则草案清楚标注。模型选择和调用记录都走共享模块，没有独立密钥设置页或写死/software路径。
7. TDD覆盖真假搜索/来源/usage/失败/上限、共享配置和旧功能、隔离PG幂等/未知不重放/归属、浏览器选择与结果。独立Web+worker构建，再按已有部署授权备份发布与只读验证；不做生产测试或迁移。
