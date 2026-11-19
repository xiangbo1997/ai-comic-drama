# AI 抽象短视频功能：完整开发规格与实施交接

版本：1.0。日期：2026-11-19。基线：`ai-comic-drama`，本地 HEAD `1919b58`（`docs: record verified repository push`）。用户确认服务器部署此产品并已拉取最新代码；本次未连接服务器核验。本文为开发任务规格，不代表已经开发、具备平台权限或允许直接操作生产。

本文可单独交给开发 AI 使用，不依赖此前讨论。**MUST 表示必须实现或遵守；SHOULD 表示默认采用、偏离需记录理由；BLOCKED 表示外部条件未满足，必须明确披露。**实现细节以实际仓库为准；本文的新增名称与路由是约定，不表示已经存在。

## 1. 用户目标与完成标准

用户希望在现有 AI 漫剧产品增加：**发现抖音、快手、小红书热门视频与抽象梗 → 原创改编 → 使用已有 AI 工具生成视频 → 审核 → 定时发布到指定平台 → 查看反馈。**先供自己使用，后续可扩展，不在本期做独立收费 SaaS 或账号矩阵。

目标不是重建 AI 视频生成器，而是把现有生成能力组织成可追踪的创作与发布流程。新增独立“抽象短视频”入口，保留漫剧入口和原行为。热点来源平台与发布目标是两个维度，不能默认搜索过的平台就是发布平台。

完成分级：

- **L1 创作工作台可用**：真实链接或手动选题能生成/上传视频、合成、审核、排期及导出人工发布包。
- **L2 单平台自动闭环可用**：至少一个真实搜索来源与一个真实发布渠道通过授权验证；从发现到生成，再按排期实际提交并核对作品状态。搜索与发布可以是不同平台。
- **L3 多平台目标完成**：抖音、快手、小红书分别完成已约定的自动搜索与发布接入；每个平台、每项能力分别验收，不混称“已支持三平台”。

最终产品目标包含自动发现与自动发布；人工导入与人工发布仅是可用降级，不能把 L1 宣布成全部需求完成。缺凭证时可先完成 L1 和 L2 所需内部逻辑，把真实接入列 BLOCKED，继续所有不依赖凭证的开发。

## 2. 既有事实与本期默认决策

### 2.1 已查证代码事实

- 主应用在 `app/`，使用 Next.js、React、TypeScript、Prisma、PostgreSQL，已有 Tailwind、组件、日志与鉴权体系；不得另起 Python 后端。
- `app/src/services/ai/index.ts` 提供 `chatCompletion`、`generateImage`、`generateVideo`、`synthesizeSpeech`；配置来自 `app/src/lib/ai-config.ts`。
- `app/src/services/generation/jobs/` 已有 `image.ts`、`video.ts`、`operation.ts`、`types.ts`，含 `submitImageJob`、`submitVideoJob`、`createGenerationJob`、`claimGenerationJob`、归属校验和操作凭证。不可绕过这些业务直接调用模型后漏计费。
- `app/src/services/assistant-execution/` 已有 `store.ts`、`runner.ts`、`worker.ts`、`tools.ts` 等：计划确认、租约、预算、步骤凭证、未知结果核对。优先复用算法与生成服务，但不可伪造 assistant_execution_run 记录以兼容新业务。
- `createGenerationJob()` 可保存 `operationKey`、`executionRunId`、请求指纹与 task ID；`claimGenerationJob()` 对 assistant 父任务有特定检查。复用前 MUST 处理这个父任务类型边界，不能传新业务 ID 却让它按旧父任务查找。
- 已有 `GenerationTask`、`GenerationAttempt`、`Project`、`Scene`、User、CreditTransaction 等模型；新业务不应改变旧枚举语义。
- `services/video-synthesis.ts` 有 `SceneMedia`、`ExportOptions` 和 `synthesizeVideoToPath()`；`services/storage.ts` 有 `uploadFile`、`uploadFileFromPath`、`uploadFileFromUrl`，支持本地/R2；有时返回有效期有限的签名 URL。
- `lib/credits.ts` 通过事务维护余额与流水。`GENERATE_*` 扣费不能仅依赖 sourceId 获得幂等；新流程必须通过任务状态/CAS/结算标记保证至多扣一次。
- 旧 `services/agents/workflow-engine.ts` 的漫剧工作流仍有 Web 进程内异步执行；不要只看它就断言全项目没有恢复能力。旧架构导航里的 `services/queue.ts` 已不存在，不复活已删除队列。

### 2.2 本期默认值，允许后续配置

| 项目 | 默认决策 |
|---|---|
| 架构 | 现有全栈 TypeScript + PostgreSQL + 已有存储；独立短视频后台执行进程 |
| 访问 | 默认总开关关闭；启用后仅 ADMIN/SUPER_ADMIN 或服务端 allowlist 用户可访问 |
| 平台 | 数据支持 DOUYIN/KUAISHOU/XIAOHONGSHU；自动接入按能力配置，没验证的不开放自动执行 |
| 视频 | 9:16、720p、目标 15—30 秒，1—5 镜头；单镜与多镜都支持 |
| 创作 | 人选择选题、确认脚本/预算、审核成片；不默认无人审核发布 |
| 生成 | 共用现有模型配置；支持自动生成与手动上传；不新增默认付费供应商 |
| 搜索 | 手动导入必做；授权自动搜索适配器与任务系统必做，真实接入单独验收 |
| 发布 | MANUAL 与 AUTO 两种；AUTO 只有验证可用且账号已授权时允许选择 |
| 时间 | 数据库存 UTC 时间点，UI 默认 Asia/Shanghai，可选 IANA 时区 |
| 并发 | 新模块默认全局一个执行中的付费生成步骤，一个合成步骤，一个发布提交；均可下调 |
| 长任务 | HTTP 快速返回任务 ID，浏览器关闭后不停止已确认任务 |
| 自动重试 | 只对无副作用读取有限退避重试；付费提交/发布结果不明时先核对 |
| 非目标 | 自动盗搬、去除他人标识、验证码绕过、自动营销私信、投流、带货支付、复杂剪辑器 |

数字是首版工程默认值，不是平台限制。平台约束另由适配器提供，不能在未验证时声称符合平台标准。

## 3. 用户流程与验收故事

### U1 找到与收藏选题

用户打开“抽象短视频 → 热点”，按平台、关键词、时间范围搜索；看到已验证来源的数据、采集时间及原链接。没有可用连接器时，显示原因并可导入链接或直接填写梗摘要。重复导入同一来源返回原记录，不重复建单，不自动发起模型调用。

### U2 改编成脚本

选择来源或空白选题，选择系列模板，填写情绪/笑点，点击“生成脚本”。先展示该步骤使用的模型与费用说明并确认；模型输出经结构校验后成为脚本草稿，不自动启动视频生成。用户可编辑并保存新版本。

### U3 生成视频

选定脚本版本与模型配置，得到逐步计划：图片、视频、配音、合成、积分上限与可能的上游费用。确认后执行；页面可关闭再打开。未知结果时暂停且显示核对入口，不出现“一键重试全部”诱发重复费用。也可上传自己用免费工具生成的视频，沿用后续审核发布流程。

### U4 审核与排期

预览最终视频，填写平台文案、封面、话题和必要声明。指定一个或多个目标账号；每个平台目标都独立形成发布快照与审核记录。用户批准后选择时间。修改已批准内容不能悄悄覆盖旧任务，必须取消未提交任务并重新审核。

### U5 结果与反馈

到点按模式自动提交或转“待人工发布”。自动提交后显示平台处理中，核对成功才显示已发布；记录外部作品 ID/链接。一个平台失败不回滚另一个已发布作品。用户手填或通过已授权能力采集 24/72 小时指标，未知值保持空，不填零。

## 4. 代码地图与建议新增位置

先读根 `AGENTS.md`、适用子目录指令、`app/package.json`、`app/prisma/schema.prisma`、`docs/project-ai-assistant.md`。代码比旧导航文档优先。

| 位置 | 用途与复用要求 |
|---|---|
| `app/src/app/(dashboard)/dashboard-shell.tsx` | 增加受开关控制的导航，不破坏桌面/移动端现有入口 |
| `app/src/app/(dashboard)/short-videos/`（新增） | 列表、热点、详情创作、任务、账号与发布页面 |
| `app/src/app/api/short-videos/`（新增） | 所有新接口统一前缀；Node runtime，按现有 auth、限流和错误模式 |
| `app/src/services/short-video/`（新增） | source、script、plan、run、artifact、review、publication、metric 服务 |
| `app/src/services/short-video/connectors/`（新增） | 搜索与发布适配器；mock 仅测试使用 |
| `app/src/lib/short-video/` 与 `app/src/types/short-video.ts`（新增） | Zod、状态转换、哈希、错误与共享 DTO |
| `app/src/services/generation/jobs/` | 复用已有生成、凭证和结算；必要时小范围泛化父任务 guard，保留旧调用兼容 |
| `app/src/services/assistant-execution/` | 参考租约、心跳与核对；不修改旧计划或挪用旧业务 kind |
| `app/scripts/short-video-worker.ts`（新增） | 独立执行入口，复用 Prisma、配置与日志，负责任务扫描与恢复 |
| `app/deploy/` | 新 worker 的构建/启动说明、服务文件与停机顺序；不自动执行部署 |
| `app/tests/`、`app/e2e/` | 沿用 Vitest 与 Playwright；数据库并发测试放专用测试库 |

服务层接收纯参数，不发同站 HTTP 来调用已有 API；路由只负责鉴权、校验、限流与服务调用。不把长任务绑在页面 useEffect、HTTP 请求生命期或内存数组。

## 5. 页面与交互规格

### 5.1 路由

- `/short-videos`：作品列表，状态、缩略图、最新任务、创建/筛选/归档。
- `/short-videos/trends`：关键词搜索、平台过滤、导入、候选来源、选题创建。
- `/short-videos/[id]`：来源摘要 → 脚本版本 → 生成计划/进度 → 成片 → 审核排期，标签或步骤布局均可。
- `/short-videos/publications`：排期列表/日历、账号过滤、状态、取消、核对及人工发布回填。
- `/short-videos/accounts`：发布账号、连接方式、授权到期、能力与健康状态；不是站内登录账号管理。

### 5.2 必须显示的事实

每条来源显示来源平台、原链接、数据采集时间、真实可得指标与获取方式；每次调用显示实际选择的配置，不能 UI 显示 A 却默认调用 B。成片展示版本、时长、尺寸、文件大小与是否本地/R2持久化。任务展示“准备/执行/等待供应方/结果未知/需处理”等真实状态。

费用分开显示站内积分与供应方费用，后者未知写“未取得账单”，不是零。排期说明“计划提交时间”，不承诺精确公开时间。账号未授权/能力未验证时禁用 AUTO 并显示理由。

所有页面有空态、加载、失败、重新读取状态与权限不足处理；窄屏可操作。表单变更使用 version 防覆盖；按钮禁用只是交互，幂等必须在服务端实现。

## 6. 数据模型规格

以下为逻辑模型合同，不是可直接运行的 Prisma schema。开发 AI MUST 按实际 User/Project 关系补齐反向关系、枚举和 SQL，并生成经过审查的增量迁移。所有业务表含 `id`、`createdAt`、`updatedAt`，除明确例外均含 `userId`，归属从 session 推导。用户端不能修改租约、费用、审核事实、外部状态。

### 6.1 来源与作品

**SvSource**：`platform`（DOUYIN/KUAISHOU/XIAOHONGSHU/OTHER）、`originalUrl?`、`canonicalUrl?`、`canonicalKey`、`externalId?`、`title?`、`summary`、`authorDisplay?`、`observedAt`、`publishedAt?`、`metrics Json?`、`ingestionMode`（MANUAL/CONNECTOR）、`connectorId?`、`rightsNote?`、`rawMetadata Json?`、`archivedAt?`。

- 唯一 `(userId, platform, canonicalKey)`；有 externalId 优先用于去重，否则使用安全规范化后的 URL 哈希；纯文字选题可无来源，不制造假平台链接。
- 未解析短链时仅能按输入链接去重，不能声称跨短链已去重。去掉追踪参数使用平台白名单规则，不能删除影响作品身份的参数。
- 不保存完整第三方网页、cookies、签名 token 或无关个人信息。metrics 字段来源未知则空。

**SvTemplate**：`name`、`description`、`systemInstructions`、`characterPreset Json`、`stylePreset Json`、`version Int`、`enabled`。每用户创建默认两模板：打工动物、生活小事史诗化；模板版本保存到脚本快照，不用随时间变化的全局提示词覆盖历史。

**SvVideo**：`title`、`brief`、`sourceIds` 通过 SvVideoSource 关联、`templateId?`、`projectId?`（关联既有 Project）、`currentScriptVersionId?`、`currentArtifactId?`、`version Int default 1`、`archivedAt?`。项目一对一关联可用 unique projectId；首次提交创作计划时按 requestId 幂等创建专用 Project，复用 Scene 和生成服务。不要向原 ProjectStatus 强塞社交发布状态。

**SvVideoSource**：`videoId`、`sourceId`，唯一二元组；写入必须验证双方同用户。来源归档不删除历史作品证据。

### 6.2 版本与生成任务

**SvScriptVersion**：`videoId`、`version Int`、`schemaVersion=1`、`content Json`、`inputSnapshot Json`、`contentHash`、`origin`（MODEL/MANUAL）、`modelRef Json?`。唯一 `(videoId,version)`；不可变。原子分配版本号，不用并发不安全的 max+1。inputSnapshot 含来源摘要、模板版本和生成设置，禁止密钥。

**SvRun**：`videoId`、`kind`（SCRIPT/RENDER）、`scriptVersionId?`、`status`、`version Int`、`requestId`、`requestHash`、`plan Json`、`planHash`、`configFingerprint`、`priceFingerprint`、`maxCredits Int`、`spentCredits Int default 0`、`reservedCredits Int default 0`、`confirmedAt?`、`leaseOwner?`、`leaseToken?`、`leaseUntil?`、`heartbeatAt?`、`stopRequestedAt?`、`errorCode?`、`errorSummary?`、`startedAt?`、`completedAt?`。唯一 `(userId,requestId)`；索引 `(status,leaseUntil)`。同作品只允许一个活跃生成 run：在事务内以作品锁/条件更新保证，不把这一约束寄托在 UI。

**SvRunStep**：`runId`、`key`（例如 image:shot-1:attempt-1）、`kind`（SCRIPT/IMAGE/VIDEO/TTS/COMPOSE）、`status`、`operationKey` 全局唯一、`requestFingerprint`、`generationTaskId?`、`externalTaskId?`、`estimatedCredits`、`actualCredits?`、`settledAt?`、`input Json`、`output Json?`、`errorCode?`、`errorSummary?`、`startedAt?`、`completedAt?`。唯一 `(runId,key)`；input 不含 API key，output 只存必要凭证/素材引用。

**SvArtifact**：`videoId`、`runId?`、`version Int`、`kind`（IMAGE/VIDEO/AUDIO/COVER）、`storageBackend`（LOCAL/R2）、`storageKey`、`mimeType`、`bytes BigInt`、`sha256`、`durationMs?`、`width?`、`height?`、`metadata Json?`、`verifiedAt?`、`archivedAt?`。唯一 `(videoId,kind,version)`；版本不可变。DTO 把 BigInt 转字符串。引用对象存储 key 或受控本地 key，签名 URL 由读取时生成，不把临时 URL 当唯一身份。输入上传通过持久化和媒体探测后才可成为候选成片。

### 6.3 平台账号、发布与指标

**SvAccount**：`platform`、`externalAccountId`、`displayName`、`version Int default 1`、`mode`（MANUAL/OFFICIAL_API/BROWSER）、`status`（MANUAL/CONNECTED/EXPIRED/REVOKED/ERROR）、`connectorId?`、`credentialCiphertext?`、`credentialIv?`、`credentialExpiresAt?`、`capabilitySnapshot Json`、`lastVerifiedAt?`、`disabledAt?`。唯一 `(userId,platform,externalAccountId)`；手动账号 externalAccountId 使用服务端生成的 manual ID，可由用户填写昵称但不假装完成账号认证。授权凭据沿用现有加密封装、密钥配置和脱敏约定，不能放 API 响应或日志。浏览器会话只在该接入模式实际获准且实现时存储，不提前默认可用。

**SvPublication**：`videoId`、`accountId`、`artifactId`、`payload Json`、`payloadHash`、`version Int`、`status`、`mode`（MANUAL/AUTO）、`scheduledAt?`、`displayTimeZone`、`approvedById?`、`approvedAt?`、`approvedHash?`、`requestId`、`requestHash`、`operationKey` 全局唯一、`leaseToken?`、`leaseUntil?`、`submissionStartedAt?`、`externalSubmissionId?`、`externalPostId?`、`externalUrl?`、`submittedAt?`、`publishedAt?`、`nextCheckAt?`、`attemptCount Int default 0`、`errorCode?`、`errorSummary?`。唯一 `(userId,requestId)`；索引 `(status,scheduledAt)`、`(status,nextCheckAt)`。payload 保存标题、正文、话题、封面 artifact ID、AI/商业声明及已验证平台特有字段。

- 默认防重复：相同账号、artifact SHA、payloadHash 已存在活跃/已提交/已发布任务时返回已有任务或 409。新的 requestId 不能绕开业务重复检查。再次有意发布同内容须在独立后续需求中处理，首版不开放。
- 一个作品投三个账号生成三个独立 publication；批量接口必须返回逐目标结果，不承诺跨平台原子事务。
- `SvPublicationEvent`：publicationId、eventType、fromStatus、toStatus、actorType（USER/WORKER/CONNECTOR）、actorId?、detail Json、createdAt；仅追加，不存秘密与完整平台响应。
- **SvMetricSnapshot**：publicationId、`observedAt`、`windowLabel`（H24/H72/CUSTOM）、`source`（MANUAL/CONNECTOR）、`views?`、`likes?`、`comments?`、`shares?`、`saves?`、`attributedFollowers?`、`completionRate?`、`avgWatchMs?`。计数为非负整数，未知用 null；completionRate 统一 0—1。窗口以 publishedAt 为基准，记录真实采集时刻，不伪装精确 24 小时。

### 6.4 搜索任务与请求幂等

**SvDiscoveryJob**：userId、platform、connectorId、keywords Json、requestedAt、status（PENDING/RUNNING/COMPLETED/FAILED/BLOCKED）、requestId、requestHash、leaseToken?、leaseUntil?、resultSourceIds Json、errorCode?、errorSummary?。唯一 `(userId,requestId)`；connector 调用也要记录是否可能计费。

搜索输入默认每任务 1—5 个关键词、每关键词最多 80 字，至多接收 50 条结果；时间范围最多最近 30 天，仅在连接器真实支持筛选时生效。每用户最多一个执行中搜索任务，默认手动触发，不启用无限轮询抓取。连接器不支持的过滤条件显式返回不支持，不假装已经筛选。

所有其他写接口用 **SvRequestReceipt** 或等价通用收据：userId、scope、requestId、requestHash、responseRef/status、createdAt；唯一 `(userId,scope,requestId)`，与业务写入同事务提交。收据只存业务引用不存凭证。相同 requestId/相同参数返回原结果，参数不同返回 409；无业务写入且无外部副作用的确定失败可以明确结束，不自动产生第二个操作。

### 6.5 删除与保留

首版只归档作品、来源和素材。存在待发、提交中、未知结果或已发布引用时不得硬删除文件/账号。断开账号授权会阻止新提交，已提交任务仍保留核对证据；账号删除采用 disabledAt。用户删除等既有管理动作若影响在途任务，须先停止新提交、保留必要核对记录并记录审计，不能级联删除后声称已撤回平台内容。

## 7. 脚本 JSON 与内容生成合同

模型输出必须通过 Zod 校验，失败不保存成可执行计划，不从不完整文本猜字段。来源摘要是引用资料，不是系统指令；不能执行其中要求调用工具、泄露配置或发布内容的指令。

```json
{
  "schemaVersion": 1,
  "title": "水豚给会议安排午休",
  "hook": "新来的水豚接管了会议室",
  "premise": "让工作会议先睡午觉",
  "targetDurationSec": 20,
  "aspectRatio": "9:16",
  "characters": [
    {"key": "capybara", "name": "水豚同事", "appearance": "棕色水豚，蓝色工牌"}
  ],
  "shots": [
    {
      "key": "shot-1", "durationSec": 5,
      "description": "水豚推门进入会议室",
      "imagePrompt": "原创水豚办公室场景",
      "videoPrompt": "水豚慢慢推门，镜头轻微跟随",
      "dialogue": "开会前，会议先休息。",
      "narration": "", "subtitle": "会议先休息",
      "characterKeys": ["capybara"]
    }
  ],
  "ending": "全体会议进入午休",
  "suggestedCaption": "这位同事懂效率",
  "hashtags": ["原创动画"]
}
```

这是字段形状示例，不是完整可执行样例：示例只展示一镜，真实计划 MUST 校验 shots 时长之和与 targetDurationSec 一致。约束：title 1—80 字，brief 最多 4000 字；1—5 镜，每镜 1—15 秒，总目标 15—30 秒；shot key 唯一，角色引用有效；提示词分别最多 3000 字；dialogue/narration 各最多 500 字；hashtags 最多 10 个。UI/后端共享同一限制。输出实际时长可能受模型档位影响，计划阶段显示预计范围，合成后以 ffprobe 为准，不强行截断对白来凑目标。

计划生成时把镜头写入此作品专用 Project/Scene，并保存映射与快照。新脚本不覆盖已有运行中的 Scene；活动 run 结束后修改镜头形成新版本。手动修改旧编辑器导致资产指纹变化时，暂停新步骤，保留已产生素材，不能以晚到结果覆盖用户修改。

两个内置模板只提供结构与角色提示，不预置未经授权的知名 IP。模型生成脚本不自动触发图像、配音或视频调用。首版不要求生成多个候选图或付费视觉自修复，避免隐藏扩大调用预算。

## 8. API 规格

### 8.1 通用规则

前缀 `/api/short-videos`。所有业务请求使用现有 session；不接受 userId/role 作为身份依据。所有 ID 联查归属，跨用户返回 404。变更请求遵守现有同源/CSRF 防护；新增实现需验证 Origin，账号 OAuth 回调另按 state 验证。

列表统一 `{items:[],nextCursor:null}`，limit 默认 20，范围 1—100，稳定 `(createdAt,id)` 顺序。时间为带时区 ISO8601 字符串，数值单位明确。写请求带 UUID requestId；编辑带 expectedVersion。错误形状为 `{error:{code,message,retryable,details?},requestId}`，不暴露上游原始异常。401 未登录；403 功能未开放；404 不存在/不属于本人；409 幂等冲突、状态冲突、预算过期、版本过期；422 校验失败；429 限流；503 connector 不可用。已有旧 API 合同不修改。

| 方法与路径（相对前缀） | 请求要点 | 结果与副作用 |
|---|---|---|
| GET `/capabilities` | 无 | 当前用户功能开关、各平台 discovery/publish/metrics 能力、模式与不可用原因；不返回密钥 |
| POST `/sources/import` | requestId, platform, url?, summary, title?, rightsNote? | 规范化去重后来源；不调用模型 |
| GET `/sources` | platform?, q?, cursor?, limit? | 本人来源列表 |
| POST `/discovery` | requestId, platform, keywords[], connectorId | 202 discoveryJobId；无连接器则明确 503/BLOCKED，不伪造热点 |
| GET `/discovery/[id]` | 无 | 状态、来源 ID、错误与数据采集时间 |
| GET/POST `/videos` | POST: requestId,title,brief,sourceIds[],templateId? | 列表 / 创建草稿；无自动生成 |
| GET/PATCH `/videos/[id]` | PATCH: requestId,expectedVersion,title?,brief?,archived? | 详情 / 更新草稿；活动 run 期间限制影响执行的修改 |
| GET `/templates` | cursor?,limit? | 本人模板 |
| POST/PATCH `/templates[/id]` | requestId,expectedVersion? 与受限模板字段 | 创建/新版本，不修改历史脚本快照 |
| POST `/videos/[id]/script-runs` | requestId,llmConfigId,templateVersion,expectedVideoVersion | 202 未执行的 SCRIPT 计划，返回上游费用说明与配置指纹 |
| POST `/videos/[id]/scripts` | requestId,expectedVideoVersion,content | 保存手动或编辑后的不可变脚本版本 |
| POST `/videos/[id]/render-plans` | requestId,scriptVersionId,modelConfigIds,maxCredits,ttsEnabled | 创建 PLANNED run，返回 planHash、步骤、报价、风险说明；不调用付费模型 |
| GET `/runs/[id]` | 无 | 任务、步骤、预算、核对状态；不泄露租约 token |
| POST `/runs/[id]/actions` | requestId,action,expectedVersion,planHash? | confirm/stop/resume/reconcile；confirm 是唯一启动入口 |
| POST `/videos/[id]/artifacts/upload` | multipart file + requestId | 受限上传、媒体检查、归属素材记录；不自动审核 |
| GET `/artifacts/[id]/access` | 无 | 新鲜的短时访问地址或授权文件流；Cache-Control private/no-store |
| POST `/publications` | requestId,videoId,accountId,artifactId,payload,mode | 创建 DRAFT 快照，尚未审核/排期 |
| GET `/publications` | videoId?,accountId?,status?,from?,to?,cursor?,limit? | 发布列表/日历，返回实际状态 |
| GET `/publications/[id]` | 无 | 快照、状态、事件与核对入口 |
| PATCH `/publications/[id]` | requestId,expectedVersion,payload?,artifactId? | 只允许 DRAFT；变更后重算 hash |
| POST `/publications/[id]/actions` | requestId,action,expectedVersion,approvedHash?,scheduledAt?,timeZone?,externalUrl? | approve/schedule/cancel/reconcile/mark_manual_published，见状态机 |
| GET/POST `/accounts` | POST: requestId,platform,displayName,mode=MANUAL | 列表 / 创建人工账号；AUTO 账号只能走验证过的授权流程 |
| POST `/accounts/connect` | requestId,platform,connectorId | 返回真实授权入口；无能力则 503 |
| GET `/accounts/callback/[connector]` | provider code,state | 验证 state、用户绑定、重放保护后服务端交换凭证；不是通用无鉴权写口 |
| POST `/accounts/[id]/disconnect` | requestId,expectedVersion | 阻止新提交、撤销凭据；不伪称已撤回平台作品 |
| POST `/publications/[id]/metrics` | requestId,observedAt,windowLabel,metrics | 手填指标，source 服务端置 MANUAL |
| GET `/publications/[id]/metrics` | 无 | 快照与缺失项 |
| GET `/publications/[id]/export` | 无 | 人工发布包，含本人的视频、文案、封面和任务清单；不含凭证 |

action 名称统一：run 为 `confirm|stop|resume|reconcile`；publication 为 `approve|schedule|cancel|reconcile|mark_manual_published`。非法 action 返回 422，非法状态转换返回 409。创建/读取 publication 时返回 reviewHash（待审快照摘要）；approve 必须提交所预览的 reviewHash 与 expectedVersion，服务端重算后写 approvedHash。approve 和 schedule 分两步，schedule 必须引用当前 approvedHash。人工完成必须提供目标平台作品链接和 publishedAt，记录为用户回填，不能伪造平台核验成功。

审核摘要覆盖 artifact 内容 SHA、封面 SHA、平台、目标账号、标题正文话题、声明及全部平台特有字段，使用稳定序列化后 SHA-256；时间不包含其中，排期本身以 version 管理。封面和视频版本不可变，因此后续签名 URL 更新不改变审核摘要。来源导入不要求系统自动识别正文，url 可选但 summary 必须由用户填写或使用已授权取得的文本；搜索连接器的结果也必须有可解释摘要。

### 8.2 关键调用示例

```json
{
  "requestId": "69c258a8-17e9-48f5-92e8-ec7fc27eab8c",
  "scriptVersionId": "script_1",
  "modelConfigIds": {"image": "cfg_image", "video": "cfg_video", "tts": null},
  "maxCredits": 100,
  "ttsEnabled": false
}
```

这是 render-plans 请求示例；100 是示例预算，不是默认价格。响应返回 runId、version、planHash、configFingerprint、priceFingerprint、steps、estimatedCredits、upperBoundCredits 和上游费用说明。服务端校验所有配置属于本人、启用且类别正确；客户端传值不是授权。

```json
{
  "requestId": "b5c488b5-f899-4434-9033-c6b0c2fded95",
  "action": "confirm",
  "expectedVersion": 1,
  "planHash": "server-returned-sha256"
}
```

排期示例：`action=schedule`，expectedVersion 为当前版本，approvedHash 必须来自已批准快照，scheduledAt 如 `2026-11-20T12:00:00Z`，timeZone 为 `Asia/Shanghai`。UI 展示对应本地时间，不能把服务器所在时区作为用户时区。立即发布也必须经审核，再排到至少当前时间后 60 秒，首版不提供绕过审核的直发接口。

## 9. 生成计划、预算和计费

### 9.1 复用路径

优先在新 SvRun 下编排已有 `submitImageJob/submitVideoJob`。内部 options 只由服务端构造，浏览器不能传 operationKey、executionRunId、onTaskCreated、CAS 或 disableRetries。

实施前检查当前 jobs 是否支持新父任务：采用一个小范围泛化的服务端 `parentGuard`/scope guard，或独立调用层验证 SvRun 状态后复用 receipt/claim 实现。必须保留原 assistant 调用的旧行为和测试；不得简单去掉父任务 guard，也不得将 SvRun ID 当成 assistant GenerationTask ID。若需扩展 InternalGenerationOptions，更新所有受影响类型与测试。

新步骤 operationKey 使用 `sv:<runId>:<stepKey>`，全局稳定。先创建步骤和 GenerationTask 凭证，再把 taskId 原子关联给步骤，最后才准许上游提交。onTaskCreated 持久写失败时不得触发上游。生成任务已有但关联丢失时，按 operationKey 查回原凭证，而非另建单。

### 9.2 站内预算

- 计划使用现有系统配置和视频时长档位函数报价；展示固定步骤上限，生成前重新核对配置和价格指纹。
- `spent + reserved + nextStepUpperBound <= maxCredits` 才能启动下一步；预算预留是本 run 的约束，不默认冻结账户余额，其他任务消费后余额不足则暂停。
- 复用现有逐成功产物扣费逻辑，MUST 保证一份 GenerationTask 至多结算一次；新编排器不能再对同一图/视频扣第二次。
- TTS 若复用路径缺少凭证与幂等结算，新增同样受 SvRunStep 管理的薄封装，按现有价格与 ChargeType 处理。脚本、合成是否扣站内积分遵循既有定价政策；默认不新增收费项目，供应商实际费用另记。
- 未知结果保留预算预留并暂停，不自动退款或释放后重提。核对明确成功后原任务结算，明确未执行才释放预留。
- 失败重做是一份新的明确计划或显式新 attempt，重新确认预算，不能覆盖旧凭证或悄悄换供应商。
- 不采用“所有任务失败就一律退款”；先判断原逻辑是否已经扣费，退款必须走现有幂等退款服务且有准确来源。

### 9.3 生成配置与指纹

指纹包含脚本 hash、模板版本、模型配置 ID、配置修订/非敏感参数、价格快照、目标成片设置。不得把明文 key 写入 plan/config Json；API key 变化只用服务端配置版本或受保护的内部摘要判断，摘要不暴露给前端。配置撤销、价格变化、素材变化时返回需重新计划，不能在已确认预算下擅自换模型。

## 10. 执行状态机与恢复规则

### 10.1 生成 run

`PLANNED → QUEUED → RUNNING → COMPLETED`；异常可进入 `PAUSED|NEEDS_RECONCILIATION|FAILED`；stop 后进入 `STOPPING → STOPPED`。PLANNED 未确认不调用外部模型。PAUSED 可在问题解除且计划仍有效时 resume；NEEDS_RECONCILIATION 只能核对原操作，不能用 resume 绕过未知结果。FAILED/STOPPED 若有已提交子任务仍保留收尾核对，不抹去费用和结果。

步骤状态：`PENDING → CLAIMED → SUBMITTING → PROCESSING → COMPLETED|FAILED|UNKNOWN|SKIPPED`。写入 SUBMITTING 后、外部 ID 落库前崩溃，不能认定“没开始”；进入 UNKNOWN。只对能够证明未提交的步骤回到 PENDING。

### 10.2 发布任务

```text
DRAFT → APPROVED → SCHEDULED
                       ├─ MANUAL：AWAITING_MANUAL → PUBLISHED
                       └─ AUTO：CLAIMED → SUBMITTING → PROCESSING → PUBLISHED / REJECTED
                                              ├─ FAILED（明确未受理或确定失败）
                                              └─ NEEDS_RECONCILIATION
SCHEDULED/CLAIMED（尚未进入SUBMITTING）→ CANCELLED
过期未执行 → EXPIRED；授权不足且确定未提交 → BLOCKED
```

人工 PUBLISHED 保留 `verification=USER_REPORTED` 事件；自动成功保留 `verification=CONNECTOR_CONFIRMED`。PROCESSING 不显示已发布。上传完成不代表创建发布成功；平台受理不代表审核通过。

只允许 DRAFT 编辑；修改 APPROVED/SCHEDULED 的内容时先取消旧任务，复制成新的 DRAFT；旧审核和事件不被重写。取消用 CAS 与提交状态竞争：提交方与取消方只有一方成功。SUBMITTING 及以后不显示“已取消成功”，只允许停止本地后续与核对；平台删除或撤回不在首版承诺范围。

### 10.3 租约、重启和迟到任务

- worker 从 PostgreSQL 领取到期任务，使用短事务 `FOR UPDATE SKIP LOCKED` 或等价 CAS；写 lease token 和到期时间；外部网络请求 MUST 在事务外。
- 默认 lease 60 秒、心跳 15 秒、扫描 10 秒；具体配置可调，计时用数据库时间或验证过的统一时钟。心跳与状态写入校验 token，旧 worker 不能覆盖新租约持有者。
- 租约丢失后立即停止新外部提交，已在途调用仅保留结果核对；数据库 fencing 不等于外部副作用 exactly-once，不能宣称恰好一次。
- SCHEDULED 被停机错过超过 10 分钟，转 EXPIRED 让用户重排，恢复服务不批量补发过时热点；10 分钟是可配置产品默认值。正常运行中也适用同一迟到规则。
- 已过 SUBMITTING 的过期租约只触发原任务核对，不重提。上游无幂等键或查单能力时保留 NEEDS_RECONCILIATION，提示人工检查，不提供强制自动重试按钮。
- 对读取采用最多三次指数退避并尊重 Retry-After；写入型请求只有明确未发出或供应方明确支持稳定幂等键时才允许有限重试，必须记录依据。
- worker 优雅退出：停止领取，尽量完成当前小步骤，保存检查点；SIGKILL 恢复按凭证和状态核对，不依赖 finally 一定执行。

## 11. 搜索与发布连接器合同

每个 connector 明确能力，不用统一布尔“支持平台”。建议服务端接口：

```ts
type Capability = {
  platform: 'DOUYIN' | 'KUAISHOU' | 'XIAOHONGSHU';
  connectorId: string;
  discovery: 'UNAVAILABLE' | 'MANUAL' | 'VERIFIED';
  publish: 'UNAVAILABLE' | 'MANUAL' | 'VERIFIED';
  metrics: 'UNAVAILABLE' | 'MANUAL' | 'VERIFIED';
  mode: 'OFFICIAL_API' | 'BROWSER' | 'MANUAL';
  supportsSubmissionLookup: boolean;
  supportsIdempotencyKey: boolean;
  verifiedAt: string | null;
  reason: string | null;
};
// 具体参数/返回值在实现中定义为Zod+TypeScript共同合同，不使用any。
// discovery.search(query, context) -> 来源条目和真实采集时间
// publisher.validate(account, artifact, payload) -> 平台约束与错误
// publisher.submit(snapshot, operationKey) -> accepted/known_rejected/unknown + 凭证
// publisher.reconcile(receipt) -> processing/published/rejected/not_submitted/unknown
// metrics.read(postReceipt) -> 可获得的指标快照
```

密钥通过服务端上下文解析，不由客户端传参；connector 不直接修改业务发布状态，而是返回结构化事实，由服务层执行状态转换。

开发每个平台前 MUST 产出 `docs/short-video/connector-matrix.md`，记录：官方文档 URL、核对日期、开发者身份、应用类型、所需 scope、账号范围、授权到期、字段限制、AI/广告声明支持、上传/提交/查询/撤回能力、请求幂等与限流、费用、实际测试证据。不适用的接口明确说明，不凭名字猜测。

自动搜索可采用已授权官方能力、用户选择的授权数据来源，或经规则与维护成本评估后明确启用的浏览器操作。不得默认个人账号能查询全平台热榜；不得默认上传控件等于服务器发布接口。小程序接口不适用于当前产品时不能硬接。

浏览器方式如获采用：独立用户会话、首次由用户登录、挑战出现暂停交还用户、session 加密、选择器版本记录、截图和错误脱敏、不隐藏浏览器发布失败；不绕过验证码。不在首版默认实现全平台浏览器抓取。发现其不可行时保留人工导入和发布包，并标明该自动能力 BLOCKED。

**当前核查状态**：只确认已有 AI 生成业务代码；没有经过本次实测的抖音/快手/小红书自动搜索、后台发布权限或数据统计能力。其他 AI 开发前应按实际环境补证据。

## 12. 素材、视频合成与人工上传

- 默认接受 MP4 视频、JPEG/PNG/WebP 图片，音频按现有服务支持的受控格式；视频单文件默认上限 200 MiB，封面 10 MiB，可配置。平台更严格限制由 validate 返回。
- 不只检查扩展名：检查 magic/MIME、ffprobe 可读性、视频流、非零时长、尺寸；拒绝损坏文件与不支持编码，必要转码在受控任务中执行。
- 自动生成每步成功后先将外部结果持久化到既有存储，再登记 SvArtifact。下载使用既有 safeDownload/url-guard 并验证其对新来源足够，保护重定向和内网地址。
- 不将第三方视频链接当作无需授权可抓取的素材，导入热点不默认下载原片。人工上传提示由用户确认素材使用权限，保存备注不代替权利核查。
- 合成通过现有 `synthesizeVideoToPath()` 的路径消费方式和 `uploadFileFromPath()`，避免读整个大视频进内存。复用字幕、音轨与 AI 标识配置；源码中的法规注释不是本规格已核验的法律事实，具体平台声明另查。
- 默认原创短片硬切，不自动加漫剧片头/片尾和复杂运镜；字幕预览与导出同源。配音关闭时视频仍可生成，缺 TTS 配置不应阻断无配音模式。
- 本地临时文件放受控目录，成功/失败都清理；磁盘不足先暂停，不删除被排期或已发布引用的素材。存储生命周期清理不在首版自动启用。
- R2 签名 URL 会过期：排期保存 key，执行时生成当前有效 URL或受控文件流。素材 key 不存在则 BLOCKED，不回退成别人的素材或空视频。

## 13. 权限、安全与观测

所有新 API 和 worker 都检查功能开关、账号状态与业务归属；隐藏导航不等于权限控制。worker 只处理启用范围内已确认任务；紧急停新提交开关置 false 时，不得停止原任务的只读核对。

上传与来源 URL 不允许任意协议、内网、环回、云元数据地址或任意重定向；没有必要访问时不发请求。模型提示词、网页内容、转录文本作为不可信资料，不能改变 system 指令或注入平台凭证。脚本模型不持有发布权限。渲染用户输入使用安全文本，不执行 HTML。

账号 OAuth state 要短期、单次使用、绑定登录用户与 connector；回调不能通过传 userId 绑定到他人。凭证刷新串行化，防并发刷新覆盖。授权错误写状态而非输出 token。

日志用现有 createLogger，包含 requestId、runId、stepId、publicationId、connectorId、状态转换和耗时；禁止输出 key、cookies、原始签名链接、完整脚本或完整供应商异常。面向用户仅显示受限错误摘要与可操作建议。

任务健康至少包含：worker heartbeat 时间、到期队列长度、未知结果数、过期任务数、失败分类。沿用 `/api/health` 的现有语义，不把“worker 不在线”伪装成整个网站数据库故障；新管理端点单独显示 worker 状态，不能公开泄露队列详情。

## 14. 配置与运行方式

建议新增配置名（实现时落到现有 env 解析与文档中）：

| 配置 | 默认/语义 |
|---|---|
| SHORT_VIDEO_ENABLED | false，总入口 |
| SHORT_VIDEO_ALLOWED_USER_IDS | 空；逗号分隔服务端 allowlist，管理员访问仍受总开关约束 |
| SHORT_VIDEO_AUTO_SUBMIT_ENABLED | false，付费生成和发布自动提交的紧急开关；已提交任务仍可核对 |
| SHORT_VIDEO_WORKER_POLL_MS | 10000 |
| SHORT_VIDEO_LEASE_MS / HEARTBEAT_MS | 60000 / 15000 |
| SHORT_VIDEO_MAX_LATENESS_SEC | 600，过时排期不自动补发 |
| SHORT_VIDEO_GENERATION_CONCURRENCY | 1，必须受部署总资源预算约束 |
| SHORT_VIDEO_COMPOSE_CONCURRENCY | 1 |
| SHORT_VIDEO_PUBLISH_CONCURRENCY | 1 |
| SHORT_VIDEO_UPLOAD_MAX_BYTES | 209715200 |
| SHORT_VIDEO_DEFAULT_TIMEZONE | Asia/Shanghai |

复用既有数据库、AI、存储、加密配置，不能替换密钥导致旧配置解密失败。不在文档填真实凭证。新增 connector 变量只在选定接入后定义，没配置时显示不可用而不是启动全站失败。

建议 package scripts 增加独立 worker 构建与运行命令。必须产出能在生产启动的编译结果，并验证 alias、Prisma 客户端、环境文件加载及模块格式；不能只写一行无法解析 `@/` 的 node 命令。可按现有工具链选择构建器，记录引入依赖的理由，不依赖开发环境的全局 tsx。

服务示例放 `app/deploy/ai-comic-short-video-worker.service`，路径、运行用户、环境文件、数据库依赖与既有部署协调，实际值以服务器核实为准。不要为了新增功能修改全局权限或强行更换现有服务用户。新 worker 与 Web 是不同进程，现有进程级 generation-concurrency 不会自动跨进程限流；须给新进程保守限额并在部署验收检查总并发，不能宣称复用闸门已实现全局限流。

## 15. 开发阶段与具体交付

每阶段先检查当前代码差异，形成小步提交；阶段完成都更新 `docs/short-video/implementation-log.md` 和适用 `.codex` 记录。

| 阶段 | 实施内容 | 可验收交付 |
|---|---|---|
| D0 基线与接入调查 | 读指令/源码；记录 git 状态、现有功能基线；评估接口与账号条件 | 文件级计划、connector matrix、实际可用/缺失清单；不要因凭证缺失暂停无依赖工作 |
| D1 数据与热点 | 增量 schema、归属与幂等、导入/模板/作品 CRUD、热点 UI、搜索 job 和 connector 合同 | 测试库迁移通过；重复导入和跨用户访问测试通过；人工来源可用 |
| D2 脚本与计划 | 结构化脚本、版本、默认模板、脚本 run、生成计划与预算确认 | 不确认不调用；模型结构失败不产生有效计划；编辑版本冲突可见 |
| D3 真实生成与素材 | 共用 jobs、父任务 guard、步骤凭证、图/视频/TTS、合成、手动上传 | 从来源到成片完整；每步可追溯，不重复费用，不覆盖旧素材 |
| D4 可靠执行 | 独立 worker、租约、检查点、停机恢复、未知结果核对、停止 | 进程重启与并发测试通过；不能用新调用冒充恢复 |
| D5 审核与人工发布 | 账号、快照审核、排期、迟到、取消、人工发布包与回填 | L1 全部通过；标注为半自动，不声称支持真实自动发布 |
| D6 单平台自动闭环 | 验证搜索来源、目标平台账号授权、提交与状态核对 | 授权范围内实测一条完整链路；L2 通过或真实 BLOCKED 报告 |
| D7 扩展与复盘 | 其余平台、指标、资源限制、部署回滚、回归 | 平台逐项验收；L3 范围按矩阵记录；不隐去缺失项 |

计划可按依赖调整，但不能跳过状态/凭证设计先上线自动提交。优先选择用户账号实际可用的平台；没有用户偏好时先依据 D0 可行性选择，并在日志说明，不硬编码一个未经验证的首发平台。

## 16. 测试矩阵

测试必须验证行为和失败恢复，mock 外部收费与真实发布；集成并发测试使用隔离 PostgreSQL。禁止测试连接生产 DATABASE_URL；测试入口必须检查测试数据库标识/显式测试开关，不能仅靠“环境变量应该没错”。

| 编号 | 场景 | 通过条件 |
|---|---|---|
| T01 | 未登录、功能关闭、非开放用户 | 正确拒绝，worker 不偷偷执行被禁止的新提交 |
| T02 | 跨用户 source/video/project/config/account/artifact/run | 全部拒绝，无数据和凭证泄露 |
| T03 | 同 requestId 并发、参数变化 | 一个业务操作；变化返回409；响应丢失可取回原结果 |
| T04 | 同链接/短链/不同平台来源 | 按实际 canonical 能力去重，不误合并不同作品 |
| T05 | 模型无效 JSON、引用无效角色、时长不符 | 校验失败，无可执行脚本；不额外付费自动修复 |
| T06 | 计划未确认、预算/价格/模型/素材变化 | 无隐式调用，变更要求重计划 |
| T07 | 父任务停止与子任务领取竞争 | 不再提交新付费请求，旧 assistant guard 仍有效 |
| T08 | taskId关联写失败/凭证已建但响应丢失 | 不提交或找回原凭证，不第二次建付费单 |
| T09 | 收到外部受理后进程崩溃 | 原任务核对，不能重新 submit；无法核对时 UNKNOWN |
| T10 | 租约过期、两个 worker、旧 worker迟到 | 同步骤最多一个有效领取，旧 token不能写新状态；外部未知保守暂停 |
| T11 | 重复成功回调/轮询、并发结算 | 同产物只扣一次；spent/reserved与账本一致 |
| T12 | 用户在生成期间换图/视频 | 晚到结果不覆盖，保留产物并提示 |
| T13 | 上传伪MIME/超限/损坏视频、恶意URL/重定向 | 校验拒绝，不能访问内网或泄露凭证 |
| T14 | 未来排期、时区、服务重启、超过迟到阈值 | 时间正确，到期才领取，过时转EXPIRED不集中补发 |
| T15 | 已审核内容修改、版本冲突 | 旧审核不能授权新内容，新版本重审 |
| T16 | 取消与提交竞争、账号断开 | 要么成功取消未提交，要么显示已提交需核对，不谎报撤回 |
| T17 | 发布超时/受理成功但ID未落库 | NEEDS_RECONCILIATION，不盲重提 |
| T18 | 平台处理中/拒绝/公开成功 | 三者区分；保存真实作品 ID/链接和事件 |
| T19 | 一个作品多平台部分成功 | 状态各自独立，失败不重复发布成功平台 |
| T20 | 签名URL过期、素材丢失、磁盘不足 | 重新解析key或明确阻断，不发布错误文件 |
| T21 | 人工发布与指标 | 标明用户回填；未知不填零；分母为零不算比率 |
| T22 | 浏览器刷新/关闭后重开 | 进度从服务器恢复，无重复建任务 |
| T23 | 旧功能回归 | 漫剧项目CRUD、手动生成、assistant执行、积分、预览、导出与登录正常 |
| T24 | 停新提交开关、worker退出 | 不启动新副作用，原提交可继续只读核对 |

单元覆盖状态转换、hash/版本、报价和时区；API 覆盖鉴权/归属/幂等；服务集成覆盖真实数据库竞争与断点恢复；E2E 至少覆盖人工模式完整路径与 mock connector 的自动路径。mock E2E 不能替代真实平台验收。

## 17. 验证命令与现有基线

在 `app/` 读取实际 scripts 后执行既有 `pnpm type-check`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`；E2E 按现有 Playwright 配置运行选定用例。版本以锁文件和 packageManager 为准，不能擅自升级 Next/Prisma 或重建锁文件来处理无关问题。

先记录既有失败，改动后报告新增失败和未消除的旧问题；不可把历史失败当成全部通过，也不为修无关告警扩大范围。新增测试与变更相关，禁止通过跳过/削弱原有测试让CI变绿。新的 worker 编译启动、测试库迁移/回滚演练另验，不因 Web build 成功就算 worker 可运行。

## 18. 数据迁移、部署与回滚

### 18.1 迁移原则

当前仓库存在 Prisma migrations，同时旧部署文档/脚本可能仍描述 db push；较新的 assistant 文档要求确认迁移基线并禁止生产 db push。**开发 AI 必须核实实际生产迁移历史和已应用SQL，不能机械执行旧脚本。**本规格不授权生产迁移。

只新增表、索引与必要可空关系，不删除/改名旧字段。新增 SQL 放独立迁移目录并附执行顺序。开发在隔离库验证：空库、模拟已有数据的基线库、重复部署行为与向后兼容。若历史基线不同，形成明确适配计划，不自动 reset/migrate resolve 或伪造迁移历史。

### 18.2 上线前准备

核对当前代码版本、数据库备份及恢复可用性、存储可用性、磁盘与内存、FFmpeg/ffprobe、Node/pnpm、迁移状态、worker 运行目录和实际权限。确认 `.env` 与素材目录不会被同步覆盖或删除。部署命令必须先 dry-run/审查，不能照搬含 `rsync --delete` 或 db push 的旧脚本。

### 18.3 经过授权后的上线顺序

1. 总开关/自动提交保持关闭；备份并验证恢复方案。
2. 应用经过核实的增量迁移，生成 Prisma 客户端。
3. 构建并部署兼容新旧 schema 的 Web 与 worker 产物；worker先核对模式、不做新提交。
4. 健康检查与旧漫剧冒烟测试；指定用户启用L1，检查存储与人工链路。
5. 连接实际账号并在单独获准的范围内做收费生成/真实公开发布测试。
6. 开启指定connector与账号的AUTO，限制并发，观察任务状态和成本。

后台 worker 的依赖版本、配置校验与发布包必须同 Web 一起更新；不能只部署页面忽略执行进程，也不能重新启动两个未登记的 worker。

### 18.4 回滚

先关新提交、停止领取，核对在途外部请求，再停止新 worker；回退到已经验证可用的旧应用构建。新增表默认保留，不执行破坏性 down SQL；旧版本忽略新表即可。若必须回滚数据，先评估已有新业务数据并取得明确授权。停本地进程不撤回平台作品，未知任务保留核对证据。回滚后验证旧漫剧登录、生成和导出；不能把“服务启动成功”当全部恢复。

## 19. 外部资料与待验证项

本规格不提供未经核验的抖音、快手、小红书发布端点、价格或权限承诺。开发时查官方当前资料并填连接器矩阵。

可作为起点的已检索资料：

- 火山方舟视频生成教程：`https://docs.volcengine.com/docs/ark/video-generation-tutorial?lang=zh`，说明异步创建、查状态和取回结果；实际项目优先复用现有生成配置。
- 抖音小程序视频发布按钮：`https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/api/open-interface/video-capacity/upload-douyin-video`。仅作场景边界参考，**不是本产品后台自动发布可用证明**。
- 抖音 OAuth/Scope 名词说明：`https://developer.open-douyin.com/docs/resource/zh-CN/dop/overview/words-explain`。
- Prisma 官方事务与幂等文档：`https://www.prisma.io/docs/orm/prisma-client/queries/transactions`。本轮检索索引含比当前安装版本新的示例，开发必须按仓库锁定版本确认 API，不能照抄新主版本语法。

本地源码中的法律注释、模型价格、部署主机信息都不是本规格对现行法规/账单/服务器实时状态的独立证明。准确区分“本地实现存在”“账号可用”“生产已运行”“真实测试通过”。

## 20. 最终交付清单与报告模板

开发 AI 必须交付：业务源码与必要增量迁移、实际配置示例（无秘密）、worker可运行产物与服务说明、connector matrix、测试与结果、功能操作说明、部署/回滚步骤、实现日志、未完成项。不得只有截图或原型。

逐项填写下表，用 `PASS / PARTIAL / BLOCKED / NOT_STARTED` 标记，PASS 附文件/命令/测试或实测证据：

| 验收项 | 状态 | 证据/限制 |
|---|---|---|
| 现有代码基线与版本核对 | 待填 | — |
| 热点导入/去重/来源追溯 | 待填 | — |
| 自动搜索：抖音 | 待填 | — |
| 自动搜索：快手 | 待填 | — |
| 自动搜索：小红书 | 待填 | — |
| 结构化脚本与手动版本 | 待填 | — |
| 计划确认、报价与预算限制 | 待填 | — |
| 复用真实生成、配音与合成 | 待填 | — |
| 手动上传和持久化素材 | 待填 | — |
| 重启恢复、未知结果核对 | 待填 | — |
| 审核快照、排期、取消与迟到 | 待填 | — |
| 人工发布包和真实回填 | 待填 | — |
| 自动发布：抖音 | 待填 | — |
| 自动发布：快手 | 待填 | — |
| 自动发布：小红书 | 待填 | — |
| 指标快照与成本记录 | 待填 | — |
| 权限/凭证/URL/上传防护 | 待填 | — |
| 隔离测试库迁移与并发测试 | 待填 | — |
| 旧漫剧与assistant回归 | 待填 | — |
| Web与worker构建/启动验证 | 待填 | — |
| 部署回滚说明与实际执行状态 | 待填 | — |

报告最后明确：实现达到 L1/L2/L3 哪一层；缺哪些凭证/权限；是否实际调用收费服务；是否实际公开发布；是否改变生产环境；下一步最小动作。不把缺凭证当作所有开发工作停下来的理由，也不把mock成功写成平台已接通。
