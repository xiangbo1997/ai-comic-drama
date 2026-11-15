# 可灵 Kling 图生视频接入

已接入现有视频任务队列、Provider 工厂及分段生成链路。设置页选择「可灵 Kling」或在自定义视频提供商中选择 kling 协议即可配置。无需 Prisma schema 迁移。

## 配置与启用

新数据库随常规 seed 创建可用的可灵预设。已有数据库可在目标环境部署代码后，从 app 目录执行：

```bash
pnpm db:seed:kling
```

该命令只 upsert slug=kling 的提供商元数据（启用状态、默认地址、协议、模型列表、表单），不修改其他提供商、标签或用户密钥/默认配置。运行前确认 DATABASE_URL 指向预期数据库；该命令不触发视频生成。

在「设置 → AI 模型 → 视频」中添加配置：

- 新版 API Key：填入「API Key / Access Key」，Secret Key 留空。
- 旧版 AK/SK：主字段填 Access Key，Secret Key 填对应密钥。服务端生成 HS256 JWT（iss=AK，exp=当前秒+1800，nbf=当前秒−5），轮询时重新签发。
- 从旧版 AK/SK 切到 API Key 时，清空 Secret Key 并保存；非空 Secret Key 表示使用 JWT。
- 默认地址为中国区官方鉴权页给出的 https://api-beijing.klingai.com；其他区域/中转按账号实际域名填写，可带 /v1，拼接时去重。
- 默认模型 kling-v2-6，另提供 kling-v2-5-turbo；模型 ID 来自官方图生视频说明。现存已选旧模型不会被改写，可按账号权限手动调整。未填入未经核实的模型单价。
- mode 支持 std/pro，默认 std；实际模型/模式权限、余额和上游计费以可灵账号为准。

主密钥沿用 apiKey 加密存储；Secret Key 和旧 accessKey 扩展字段沿用 extraConfig 加密与掩码。编辑连接测试会合并当前表单的密钥/模式，掩码字段还原为原值；测试未保存的修改不会把原配置标记为成功。

## 接口与范围

- 提交：POST /v1/videos/image2video；字段 model_name、image、prompt、mode、duration（字符串）。角色身份提示前置到 prompt，保留连续性约束。
- 查询：GET /v1/videos/image2video/{task_id}，submitted/processing 继续轮询，succeed 读取 task_result.videos[0].url，failed 返回失败原因。
- 连接测试：只调用 GET /v1/videos/image2video?pageNum=1&pageSize=1。成功仅表示鉴权和任务列表连通，不验证所选模型生成权限或余额，也不提交视频。
- 本次开放5/10秒片段，较长分镜沿用已有链式分段；不声明首尾帧插值、音视频同步、多镜头及4K能力。duration 会吸附到5/10秒，分段能力表保持一致。
- 默认门面总超时沿用5分钟，可通过 VideoGenerationOptions.timeoutMs 覆盖；Provider 轮询上限10分钟。取消会停止本地请求和轮询，上游已接受的任务不保证被取消，不应据此自动重提。
- 请求复用 safeFetch 的 DNS/IP 校验和重定向限制；非幂等提交使用 submit 重试策略，避免5xx或中途断流造成重复付费任务。
- image 使用可灵服务器可访问的图片 URL（或原始 Base64），不得传浏览器本地 blob URL。图片格式、大小、宽高比按官方限制。

## 可选环境变量兜底

用户配置优先。调用服务门面且未提供用户配置时，可配置 KLING_API_KEY；或者同时配置 KLING_ACCESS_KEY 和 KLING_SECRET_KEY。两种均存在时 API Key 优先。KLING_BASE_URL、KLING_MODEL 可覆盖默认地址和模型；完整 Kling 配置优先于原有 RUNWAY_API_KEY 兜底。示例见 app/.env.example。不要提交真实密钥到仓库。

## 官方参考与验证边界

核对日期：2026-11-15。已读取以下官方文档的站点公开正文资源，未执行远端文档脚本：

- 鉴权：https://klingai.com/document-api/api/get-started/authentication
- 图生视频：https://klingai.com/document-api/api/video/image-to-video

单元/路由测试使用模拟上游；浏览器组件验收使用本地配置页面与网络替身，不连接生产作品。没有使用有效用户凭据完成真实付费视频生成，模型实际权限与出片效果仍需配置后验证。具体命令和结果记录于 .codex/verification.md。
