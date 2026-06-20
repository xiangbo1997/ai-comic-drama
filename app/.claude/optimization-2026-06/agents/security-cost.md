# 安全 / 资金 / 成本 优化分析 — security-cost

> 专属领域：安全漏洞 + 积分资金安全 + AI 成本控制
> 证据驱动，所有结论引用 `file:line`。基线：commit 2735c0a(R1-R7 资金安全) 已上线。
> 日期：2026-06-19 · 执行者：Claude Code(security-cost agent)

---

## 1. 现状诊断（引用 file:line 证据）

### 1.1 资金 / 积分（历史 R1-R7 修复已到位，复核通过）

支付链路本轮复核**整体扎实**，R1-R7 全部生效：

- **统一积分服务**：`lib/credits.ts` 所有变动经 `chargeCredits`/`grantCredits`/`refundCredits`，余额变动 + 流水(`CreditTransaction`)同事务、带 `balanceAfter` 快照(`credits.ts:98-108,190-206`)；金额强制正整数(`credits.ts:48-52`)。
- **退款幂等**：相同 `sourceId` + `type=REFUND` 只生效一次(`credits.ts:131-145`)。
- **回调验签真实启用**：微信 RSA-SHA256 平台证书验签 + AES-256-GCM 解密(`payment.ts:255-309`)；未配平台证书直接拒绝放行(`payment.ts:261-264`)；支付宝 RSA2 验签(`payment.ts:419-429`)；Stripe HMAC-SHA256(`payment.ts:578-585`)。
- **订单幂等闸门**：三回调统一用条件原子更新 `updateMany WHERE status=PENDING → PAID`，`claimed.count===0` 即幂等返回成功，杜绝重复发放(`callback/wechat:60-76`、`alipay:53-66`、`stripe:47-60`)。
- **金额校验转分整数比较**，避免浮点误差(`callback/wechat:47-56`)。
- **发放 + 订阅创建同事务**，失败回退订单为 PENDING 让网关重试(`callback/wechat:79-139`)。
- **生成扣费时机正确**：图/视频/TTS 均「生成成功后」在事务内扣费 + 记流水 + 二次校验余额，失败路径从不扣费(`generate/image:357-392`、`generate/video:140-170`)。

> 结论：**核心支付/积分发放链路无新增 P0 资金漏洞**。问题集中在「绕过统一积分服务的旁路」与「成本侧」。

### 1.2 越权 / IDOR（核心问题域）

**生成类端点信任 body 里的 `sceneId`/`projectId`，不校验归属**——与已正确实现的 `scenes/[sceneId]`(`scenes/[sceneId]/route.ts:23-29` 先 `findFirst({where:{id,userId}})`)、`export`(`export/route.ts:35` 同款)形成鲜明对比：

- `generate/image`：`prisma.scene.update({where:{id:sceneId}})` 直接写，无 ownership 校验(`generate/image:135-138,375-378,413-416`)。
- `generate/video`：同样 `scene.update({where:{id:sceneId}})`(`generate/video:101-104,153-156,186-189`)。
- `generate/tts`：`scene.update({where:{id:sceneId}})`×3，且**作者已知该模式**——同文件 L67 对 character 做了 `character.userId===session.user.id` 校验，却漏了 scene(`generate/tts:104-105,164-165,208-209`)。

**影响**：攻击者用自己积分生成，但把产物/状态(`imageUrl`/`videoUrl`/`audioUrl`/`*Status`)写进**他人**分镜 → 篡改/投毒他人项目内容、覆盖正确产物、把他人分镜刷成 FAILED/PROCESSING。属**跨用户写 IDOR**。

次要：`export` 的 GET 用 `task.projectId !== id` 校验 task 归属，但**未校验 `id` 项目归属于当前用户**(`export/route.ts:331-337`)——已知 taskId+projectId 可读他人导出状态与 `videoUrl`。

### 1.3 旁路扣费端点（绕过统一积分服务）

`POST /api/user/credits` 存在且**无人调用**(前端仅用 GET，见 `credits/page.tsx:91`、`credits-display.tsx:8`)：

- 非事务：`findUnique` 读余额 → `user.update decrement`(`user/credits:47-67`)，存在 TOCTOU 竞态。
- **完全不写 `CreditTransaction` 流水** → 对账黑洞，违反「所有积分变动经 credits.ts」约定。

虽只能扣自己积分(无直接套利)，但它是绕过统一服务的活口，应删除。

### 1.4 SSRF（两处，均 auth-gated 但任意注册用户可达）

1. **导出下载链 SSRF**：`video-synthesis.ts:184` `fetch(absolutizeUrl(url))` 无 host 校验。url 来自 Scene 的 `imageUrl/videoUrl/audioUrl` 与 `generationParams.stickers/watermark.imageUrl`，而这些字段**可由用户经 `PATCH /scenes/[sceneId]` 直接写入**(`scenes/[sceneId]/route.ts:40-42,60-62` 原样接收 body 的 imageUrl/videoUrl/audioUrl)。攻击者把 `imageUrl="http://169.254.169.254/latest/meta-data/..."` 后触发导出 → 服务端 fetch 内网/云元数据。
2. **AI 配置测试 SSRF**：`ai-models/test/route.ts:66` `effectiveBaseUrl = customBaseUrl || provider.baseUrl`，`customBaseUrl` 完全用户可控，直接 `fetch(\`${baseUrl}/chat/completions\`)` 等(`ai-models/test:261,339,400,579`等)。错误信息回填到响应`message`/`testedUrl`(`ai-models/test:98,114) → 可探测内网 + 部分内容回显。同类问题在 `ai-models/configs/[id]/test/route.ts`(1356 行同款逻辑)。

### 1.5 上传安全

`POST /api/upload`：仅对 `watermark` 做 content-type 白名单 + 2MB 限制(`upload:46-53`)；**`image/video/audio` 三类既无大小上限也无 content-type 白名单**(`upload:41-44` 仅校验 fileType 枚举)。multipart 直传分支(`upload:104-135`)把任意文件写入 `public/uploads` 并由 Web 根目录直接 serve →

- **存储型 XSS**：上传 `.svg`/`.html`(声明 `fileType=image`)，浏览器以 `text/html` 渲染，与主站同源 → 盗 session。
- **磁盘耗尽 DoS**：无大小限制，可写满 `public/uploads`(线上无 R2，全靠本地盘)。
- 文件名已 sanitize(`storage.ts:48-49,209-211`)，**无路径穿越**(✓)。

### 1.6 限流 / 防刷

- 生成/支付端点限流到位(`generate/image:41`、`payment/create:34`、`transcribe`)。
- **`checkin`/`invite`/`register` 无限流**(grep 确认 NO rate-limit)。`register` 无限流 → 可批量注册刷账号；配合 cookie `invite_code` 自动给邀请人 +50 积分(`auth.ts:116-141`)→ **自邀请/批量邀请薅积分**(虽有 `inviter.id !== user.id` 防自邀，但攻击者注册 N 个新号即可给主号刷 N×50)。
- 限流存储：内存版每进程独立(`rate-limit.ts:167-169`)，Serverless 多实例失准；Redis 版任何异常 fail-open 放行(`rate-limit.ts:140-146`)——可用性优先但限流可被压垮绕过。

### 1.7 AI 成本控制

- **平台 env key 兜底 = 直接亏钱**：用户无配置时回退平台 `REPLICATE_API_TOKEN`/`DEEPSEEK_API_KEY`/`RUNWAY_API_KEY`(`ai/index.ts:130,171,253-254,299`)，**成本记在平台账上**，用户只付站内积分。
- **积分定价倒挂**(实测亏损)：trial 包 100 积分/¥9.9 = ¥0.099/积分。
  - 图像 1 积分 = ¥0.099 收入 vs `COSTS.image=$0.03≈¥0.22` 成本(`ai/CLAUDE.md` COSTS 表)→ **每张亏 ¥0.12**。
  - 视频 5s = 10 积分 = ¥0.99 收入 vs `video5s=$0.25≈¥1.8` 成本 → **每条亏 ¥0.81**。
    仅当用户自带 key 时不亏；走平台兜底即纯亏。
- **无任何全局成本上限**：grep 无 daily/monthly cap、无单用户单日消费上限。唯一闸门是「积分余额 + 每分钟限流」。签到/邀请送的积分可直接换平台兜底算力 → 注册即薅。
- **有缓存(✓)**：`lib/cache/prompt-cache.ts` 已接入 orchestrator(`image-orchestrator.ts:14,51-63,106`)，相同 prompt 命中复用，TTL 7天。注意命中仍按策略正常扣积分(收入侧正确)，节省的是上游 API 成本。

---

## 2. 问题分级

| #    | 级别 | 问题                                                        | 影响面                                           | 证据                                                                           |
| ---- | ---- | ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| P0-1 | 阻断 | 生成端点跨用户写 IDOR(image/video/tts 信任 body sceneId)    | 任意用户可篡改/投毒/覆盖他人项目分镜产物与状态   | `generate/image:135,375`; `generate/video:101,153`; `generate/tts:104,164,208` |
| P0-2 | 阻断 | 导出下载链 SSRF(scene.\*Url 用户可写 → 服务端无校验 fetch)  | 任意用户打云元数据/内网；本地盘部署下尤甚        | `video-synthesis:184` + `scenes/[sceneId]:40-42,60-62`                         |
| P0-3 | 阻断 | 上传无 content-type/大小白名单(image/video/audio)           | 存储型 XSS(SVG/HTML 同源) + 磁盘耗尽 DoS         | `upload:41-53,104-135`                                                         |
| P1-1 | 严重 | AI 测试端点 SSRF(customBaseUrl 任意 fetch + 内容回显)       | 内网探测 + 部分响应回显，含 2 个 test 路由       | `ai-models/test:66,261,400`; `configs/[id]/test`                               |
| P1-2 | 严重 | 成本定价倒挂 + 平台 env key 兜底 + 无消费上限               | 每图亏¥0.12/每视频亏¥0.81；可批量注册薅平台算力  | `ai/index.ts:130,171,299`; COSTS 表; 无 cap                                    |
| P1-3 | 严重 | register/invite 无限流 → 批量注册薅邀请积分                 | 主号被刷 N×50 积分→换兑平台兜底算力              | `auth.ts:116-141`; 无 rate-limit                                               |
| P2-1 | 改进 | `POST /api/user/credits` 旁路扣费端点(无事务/无流水/死代码) | 对账黑洞、TOCTOU；建议删除                       | `user/credits:33-81`                                                           |
| P2-2 | 改进 | export GET 未校验项目归属用户                               | 已知 taskId+projectId 可读他人导出 videoUrl/状态 | `export/route.ts:331-337`                                                      |
| P2-3 | 改进 | checkin 无限流；rate-limit fail-open + 内存版多实例失准     | 限流可被压力绕过                                 | `rate-limit.ts:140-146,167-169`                                                |

---

## 3. 具体优化方案（可落地）

### P0-1 IDOR：生成端点统一加 scene 归属校验（最高优先）

抽公共 guard，三个生成端点 + export GET 全部接入：

```ts
// lib/authz.ts（新增）
export async function assertSceneOwnership(
  tx: Prisma.TransactionClient | typeof prisma,
  sceneId: string,
  projectId: string,
  userId: string
) {
  const scene = await tx.scene.findFirst({
    where: { id: sceneId, projectId, project: { userId } },
    select: { id: true },
  });
  if (!scene) throw new ForbiddenError("scene not found or not owned");
}
```

`generate/image|video|tts` 在 `scene.update` 前调用；所有 `scene.update` 的 `where` 收紧为 `{ id: sceneId, projectId }`（与 `scenes/[sceneId]:51` 一致）。无 sceneId 的纯生成路径不受影响。

### P0-2 SSRF（导出 + 测试）：URL 出口统一过滤

```ts
// lib/ssrf-guard.ts（新增）
const BLOCKED = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/,
  /^localhost$/i,
];
export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("protocol not allowed");
  const { address } = await dns.promises.lookup(u.hostname); // 解析后比对，防 DNS rebinding 用 pin
  if (BLOCKED.some((r) => r.test(address) || r.test(u.hostname)))
    throw new Error("internal address blocked");
}
```

- `video-synthesis.ts:184 downloadFile`：fetch 前 `await assertPublicUrl(absoluteUrl)`（本地 `/uploads/*` 走 absolutize 后判定为同源白名单，放行）。
- `ai-models/test` + `configs/[id]/test`：对 `customBaseUrl` 调用 `assertPublicUrl`；并把错误 `message` 脱敏，不回填上游响应体，仅返回分类 errorType。

### P0-3 上传白名单 + 大小限制

`validateUpload` 扩展到全部 fileType：

```ts
const CONTENT_WHITELIST = {
  image: new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]), // 禁 svg
  video: new Set(["video/mp4", "video/webm"]),
  audio: new Set(["audio/mpeg", "audio/wav", "audio/mp4", "audio/webm"]),
  watermark: WATERMARK_ALLOWED_CONTENT_TYPES,
};
const SIZE_LIMIT = {
  image: 10 * MB,
  video: 200 * MB,
  audio: 50 * MB,
  watermark: 2 * MB,
};
```

multipart 分支用 `file.type` + `file.size` 双校验；R2 预签名分支用客户端声明的 contentType/fileSize 校验（R2 侧再配 `Content-Length` 上限 policy）。本地盘 serve 时给 `public/uploads` 加 `Content-Disposition: attachment` 或独立无脚本子域，彻底消除同源 XSS。

### P1-2/P1-3 成本闸门

1. **重定价或封顶兜底**：要么把图像成本对齐为 ≥3 积分、视频 5s ≥20 积分（覆盖 $0.03/$0.25 成本 + 毛利）；要么**禁止积分兑换平台 env key**——`shouldFallbackToEnvReplicate` 仅在「用户自带 key 失败且属系统赠送额度」时放行，且对兜底调用**额外扣 premium 积分**或记 `costSource=platform` 以便风控。
2. **全局消费上限**：新增 `UserDailyUsage`(userId, date, imageCount, videoCount, llmTokens, costCny)；生成前检查单日上限（如赠送用户 image≤50/日、video≤10/日）。SQL:
   ```sql
   CREATE TABLE "UserDailyUsage" (
     "userId" TEXT NOT NULL, "date" DATE NOT NULL,
     "imageCount" INT DEFAULT 0, "videoCount" INT DEFAULT 0,
     "costCny" DECIMAL(10,2) DEFAULT 0,
     PRIMARY KEY ("userId","date")
   );
   ```
3. **register/invite/checkin 限流**：register 走 `rateLimiters.auth`(已存在，10/min)按 IP；invite 奖励改为「被邀请人产生首次付费/消费后」才发放(`Invitation.status` 引入 `QUALIFIED` 态)，杜绝注册即薅。

### P2 清理

- 删除 `POST /api/user/credits`(死代码 + 旁路)。
- export GET 加 `project.findFirst({where:{id,userId}})` 前置校验。
- checkin 加 `rateLimiters.default`。

---

## 4. 行业标杆对标

| 能力           | 本项目                            | CapCut/剪映 · Runway · Pika                                  | 差距                                     |
| -------------- | --------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| 资源归属隔离   | 部分端点 IDOR(生成类)             | 全链路 row-level ownership + 签名资源 URL                    | **落后**：需补 ownership guard           |
| 出站 SSRF 防护 | 无                                | 素材/回调 URL 走代理+allowlist+元数据屏蔽                    | **落后**：需 ssrf-guard                  |
| 上传安全       | 仅 watermark 白名单               | MIME 嗅探 + 病毒扫描 + CDN 隔离子域                          | **落后**：补全类型/大小白名单            |
| 成本风控       | 仅积分+限流，定价倒挂             | 分级配额 + 实时成本计量 + 异常熔断 + 预付费抵扣实际 API 成本 | **显著落后**：无消费上限/无成本计量/倒挂 |
| 算力计费一致性 | 站内积分≠上游成本，兜底用平台 key | credit 与 GPU 秒/token 强绑定，明算账                        | **落后**：积分需对齐真实成本             |
| 限流粒度       | 端点级固定窗口                    | 多维(用户+IP+设备指纹)滑窗 + 风控评分                        | 可接受，缺防刷维度                       |
| 支付安全       | 验签/幂等/事务齐全                | 同等水平                                                     | **持平(✓ 本项目强项)**                   |
| 密钥加密       | AES-256-GCM(✓)                    | KMS/Vault 托管                                               | 基本持平，缺密钥轮换流程                 |

> 总评：**支付/积分链路已达标杆水平**；**越权隔离、SSRF、上传、成本风控四项明显落后**，是冲击「行业标杆」前必须补齐的安全/资金护城河。

---

## 5. 实施优先级与工作量估算

| 顺序 | 项                                                       | 级别 | 工作量  | 说明                                  |
| ---- | -------------------------------------------------------- | ---- | ------- | ------------------------------------- |
| 1    | P0-1 IDOR guard(`lib/authz.ts` + 4 端点接入)             | P0   | **S**   | 1 个 helper + 4 处调用，最高 ROI      |
| 2    | P0-3 上传白名单/大小 + 本地盘隔离                        | P0   | **S**   | 扩 `validateUpload` + serve 头        |
| 3    | P0-2 SSRF guard(导出 + 2 个 test 路由)                   | P0   | **M**   | DNS 解析比对 + 错误脱敏，需测内网用例 |
| 4    | P1-3 register/invite/checkin 限流 + 邀请奖励改 QUALIFIED | P1   | **S~M** | 限流 S；邀请态机改造 M                |
| 5    | P1-2 成本闸门(UserDailyUsage + 兜底标记/premium 扣费)    | P1   | **M**   | 新表 + 生成前检查 + 兜底风控          |
| 6    | P1-2 积分重定价(对齐真实成本)                            | P1   | **S**   | 改常量；需产品确认价格策略            |
| 7    | P2 清理(删旁路端点/export GET 校验/checkin 限流)         | P2   | **S**   | 杂项收尾                              |

**建议批次**：第一批(顺序 1-3，全 P0，约 1 人日)立即上线堵安全洞；第二批(4-6，资金/成本，约 2 人日)需产品确认定价后实施；第三批(7)随手清理。

---

### 复核确认（本轮未发现的"非问题"，避免误报）

- 支付三回调幂等/验签/金额/事务 — 已正确(R1-R7)，**无需再改**。
- `chargeCredits` 事务内二次校验余额，并发超扣由 DB 事务 + decrement 兜底 — 可接受。
- 本地存储文件名 sanitize 充分，**无路径穿越**。
- `debug/add-credits` 有 `NODE_ENV==="production"` 拦截(`debug/add-credits:11-16`) — 安全(但建议生产构建直接排除该文件)。
- `admin/metrics` 有 `isAdmin()` 校验；`jobs` 有 `job.data.userId` 校验 — 安全。
