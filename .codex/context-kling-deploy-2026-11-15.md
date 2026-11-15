# 可灵模型部署上下文
用户授权部署并提交Git；复用本机systemd服务，使用生产配置独立构建。沿用上一轮2529单元、6浏览器、类型/全量ESLint及隔离构建通过的源码；仅新增发布记录与必要文档。新预设需要执行仅Kling的seed以启用旧数据库。禁止调用真实付费生成，不提交环境文件或密钥，不推送。原四份.codex修改及context-server-resources记录需保留。

基线：
{
  "recordedAt": "2026-11-15T15:43:02.518662+00:00",
  "activeTasks": {
    "generationTasks": 0,
    "assistantRuns": 0,
    "assistantReplies": 0
  },
  "health": {
    "ok": true,
    "uptime": 9582.727662974,
    "commit": "edf1d2b"
  }
}

发布结果：2026-11-15 23:48:31 CST，生产版本880bdcf，60项冒烟通过，Kling预设启用，其他提供商及用户AI配置保持不变。独立构建670文件SHA一致，133路由/29技能/21首音乐完整。无迁移、无付费出片、无push。回退与验证证据：/tmp/ai-comic-deploy-kling-20261115T154323Z-q1udp5b4。最新详细记录见verification.md。
