# 热点联网模型审查与升级

用户提出/software/chatgpt2api有搜索模型，随后明确“我只要效果最好，不用担心付费模型”，授权本任务搜索/文案模型真实调用，不授权平台公开投稿。sequential-thinking仍不可用，人工推理：先核查实际运行镜像与代码，再对同一问题实测，不把模型输出的链接自动作为搜索来源证明；保留公开热榜事实与更新时间，比较模型改编效果，再确定最小增强路径。只读审查chatgpt2api，保留该仓库docker-compose.yml与.codex原dirty项，不改网关或账号全局配置。现有漫剧开发5808536，线上独立d992a66，仍保留并行Seedance代码。

代码事实：chatgpt2api 2.0.0运行镜像upstream-20261119-89a8ad0；WebSearchRequested识别tools.web_search/web_search_options及搜索模型别名；AIService.Text搜索模式强制改用配置DefaultModel，响应中model回显不证明实际后端。SearchAnnotations仅从最终文本URL提取，非独立搜索工具调用凭据。现有漫剧默认LLM sub2api/gpt-6-sol，chatgpt2api现有配置仅IMAGE/TTS。实际联网查询通过本机正常API进行，秘密仅内存使用，日志只输出公开回复/模型名/耗时，无生产数据库测试/迁移/写入。本轮未确定效果前不替换线上能力。

回滚：审查/外部模型试调用不会改变业务代码或生产配置；若随后实施，单独提交且保留原免费热榜路径，构建和数据库测试仍隔离。模型失败/超时不自动重放收费请求，不把失败改写成无费用。

## 用户后续明确共用模型设置；已实施阶段

文件级计划docs/short-video/shared-model-search-plan.md。搜索作为LLM能力，通过既有extraConfig的webSearchTransport与可选webSearchReasoningEffort持久化，无schema变化。共享服务只接受Responses实际搜索完成记录+原生URL引用，返回正式答案及usage，safeFetch/180sec/2MiB/0重试/observeLLM。现有模型测试门面测试实际搜索；配置/协议/地址/推理强度变化使原测试失效，共用选择器可按能力过滤。HotBrief显式选择配置、保存原生分析/来源/用量，过期RUNNING收费任务标待核对而不重放；收藏简报为作品但不启动生成/发布。原规则路径保留且明确标记，AI为默认搜索方式。

验证：核心新服务先RED缺文件后GREEN5项，相关28项及新配置/能力10项通过；独立PG新搜索文件10项通过（原6+新4）；浏览器12项通过（新增共用LLM能力与AI搜索、原热点/短视频/语音配置）。完整类型检查通过。新服务真实使用既有用户配置gpt-6-sol+high，53.3秒完成7次搜索工具/3来源/1275字可执行改编；usage输入45884/输出2200/总48084，供应方金额未取得。此前chatgpt2api带high请求422，去掉参数41.9秒返回重复文本、19个未解析Link引用、0个URL；现有sub2api原生Responses73.3秒/10搜索记录/4引用实际成功。3份引用页面独立GET200、话题与日期时间匹配；小红书取得第三方快照，不是官方平台授权。本轮至此4次真实模型请求（1拒绝、3成功），并非0付费调用；未公开投稿，生产代码/配置此阶段尚未切换。全量回归/发布待完成。
