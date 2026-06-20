# 可靠性 / 容错 / 可观测性 诊断报告

> 领域：错误处理 / 重试 / 任务容错 / 可观测性
> 视角：哪些场景会让用户「卡住 / 丢任务 / 扣了积分没产出」
> 全部结论引用 `file:line` 证据。

---

## 1. 现状诊断（证据驱动）

### 1.1 双轨制：队列子系统是「死代码」，真实生成全是同步/游离 Promise

代码里存在一整套看似完备的异步队列容错体系，但**实际生产路径根本不走它**。

- 队列定义齐全：`imageQueue/videoQueue/audioQueue/exportQueue`，含分桶并发、超时、重试退避（`queue.ts:520-545`）。
- worker 注册齐全：`initializeWorkers()` 给每个队列挂处理器（`queue-workers.ts:37-80`）。
- 错误分级齐全：`queue-errors.ts` 把错误分 network/provider/validation 决定是否重试。
- **但入队函数 `addImageGenerationJob/addVideoGenerationJob/addAudioGenerationJob/addExportJob` 在 `src/app/` 下零调用**（grep 全仓，仅 `queue.ts` 内部定义，无 API 路由调用）。
- 队列对象唯一的外部引用是只读的 `admin/metrics/route.ts:19-43`。
- worker 入口 `workers/main.ts:32-35` 在 `!REDIS_URL` 时直接 `process.exit(1)`；而线上 3100 无 Redis（见 brief / MEMORY「storage 本地降级」同款部署）。→ **worker 进程根本起不来，即使起来也没人投递任务**。

**真实生成路径**：

- 单条生成走同步 API：`/api/generate/image`、`/api/generate/video`（`generate/video/route.ts:127` 同步 `await generateVideo`）、`/api/generate/tts`。
- 批量/全自动走 Agent workflow：`workflow-engine.ts:71` `executeWorkflow(...).catch()` —— **游离 Promise，非队列**。
- 导出异步模式：`export/route.ts:218` `processExportAsync(...).catch()` —— **同样是游离 Promise**。

**后果**：所有「容错」设计（重试、死信、分级、僵尸清理）都没有作用在真实路径上。真实路径的容错能力 = 一个 `try/catch` + 一个不受监管的后台 Promise。

### 1.2 没有任何「僵尸任务」回收机制（PROCESSING/RUNNING 永久卡死）

全仓 grep 无 reaper / stale / reconcile / cron（仅 `workflow-engine.ts:876` 的 `stale` 是变量名巧合，指多余 scene order）。

游离 Promise 的致命点：进程一旦重启（systemd restart / 部署 / OOM / panic），正在跑的 `processExportAsync` 和 `executeWorkflow` 直接消失，但 DB 里：

- `GenerationTask.status` 停在 `PROCESSING`（`export/route.ts:108-117` 创建即 PROCESSING）。
- `Project.status` 停在 `PROCESSING`（`export/route.ts:122-125`）。
- `WorkflowRun.status` 停在 `RUNNING`/`PENDING`（`workflow-engine.ts:152-155`）。
- `Scene.imageStatus/videoStatus/audioStatus` 停在 `PROCESSING`。

**没有任何代码会把这些「孤儿 PROCESSING」翻回 FAILED**。

### 1.3 前端无限轮询 + SSE 断连后无终止条件 → 用户界面永久「转圈」

- 导出轮询 `page.tsx:147-193`：`setTimeout(poll, 2000)` 循环，**仅** 在 `completed`/`failed`/fetch 异常时停止。孤儿任务永远是 `processing` → **永久每 2s 轮询，进度条永远卡住**，用户无从知道任务已死。无 maxAttempts、无总超时。
- Workflow `use-workflow.ts:84-90`：SSE `onerror` 时 `closeSSE()` 后只 `fetchStatus` 一次。若此刻 DB 仍是 `RUNNING`（孤儿），`isRunning` 永远不归位，UI 卡在「运行中」。SSE 服务端事件来自内存 `event-bus`，**进程重启后新页面订阅不到任何历史事件**。

### 1.4 积分：两套扣费逻辑并存，死代码路径绕过审计 + 无退款

仓库已有正确的原子+幂等积分模块 `lib/credits.ts`（`chargeCredits` 事务内校验+流水快照、`refundCredits` 幂等 by sourceId）。

- **同步路由用对了**：`generate/video/route.ts:140-170` 把「任务完成+场景更新+扣费」包进同一事务，失败走 catch 不扣费——这条路径资金安全是 OK 的。
- **死代码 queue-workers 用错了**：`queue-workers.ts:240-243 / 318-321 / 388-391` 用裸 `prisma.user.update({ credits: { decrement } })`，**绕过 `creditTransaction` 流水**，且无 `refundCredits`。虽是死代码，但属定时炸弹——一旦有人把队列接回真实路径，就会复现「扣了积分无流水、失败不退款」。
- **`refundCredits` 全仓零调用方**（grep 确认）。说明：当前没有任何「先扣后失败 → 退款」的流程；同步路由靠「成功后才扣」规避了退款需求，但这也意味着**任何「先扣费再生成」的未来改动都没有退款兜底**。

### 1.5 Workflow 路径：无积分校验、无限流、无幂等、无法真正取消

`workflow/route.ts:30-104` 启动 workflow：

- **完全没有积分检查/扣费**（对比同步路由每条都查 `user.credits`）。workflow 会一次性 fan-out 生成 N 张图 + N 个视频 + N 段 TTS（`workflow-engine.ts:248-262`），**全程零扣费**。→ 资金/滥用漏洞：绕开 workflow 即可白嫖全流程生成。
- **无限流**（同步路由都有 `rateLimiters.*`，workflow 没有）。
- **无幂等/并发锁**：同一 projectId 可重复 POST，启动多个并发 `executeWorkflow`，同时写同一批 Scene（`workflow-engine.ts:601-603` 等），last-write-wins 竞态，且 `saveScenesToProject` 的 diff-upsert 在并发下会互相删改。
- **取消是假的**：`cancelWorkflow` `workflow-engine.ts:118-123` 只改 DB status，**游离的 `executeWorkflow` Promise 继续跑**，继续扣（如果将来扣）、继续写 Scene、继续打 provider。
- **早期异常 → PENDING 永久卡死**：`executeWorkflow:144-147` 若 `run` 查不到直接 throw，被 `startWorkflow:71` 的 `.catch` 只打日志吞掉，status 永远停在创建时的 `PENDING`（`workflow-engine.ts:60-67` 从未进入 try 内的 FAILED 分支）。

### 1.6 错误分级正确但「清理时机」有 bug（重试场景 scene 被提前标 FAILED）

`handleWorkerError`（`queue-errors.ts:77-91`）：先执行 cleanup（把 scene 标 FAILED），再对可重试错误 `throw` 让 BullMQ 退避重试。但 cleanup 在**每次 attempt** 都把 scene 写成 `FAILED`（`queue-workers.ts:250-268`）。即使后续重试成功会覆盖回 COMPLETED，**重试窗口内前端看到的是 FAILED**（误导）；若中途进程挂掉则永久 FAILED。属死代码，但逻辑缺陷需在接回前修。

### 1.7 外部依赖故障面

- **R2 未配（线上现状）**：`queue-workers.ts:369-377` 音频生成仅在 `isR2Configured()` 时上传，**但积分照扣**（`:388-391`）→ R2 没配时「扣了积分、audioUrl 为 null、无产物」。这是死代码路径，但同样是隐患。导出路径已用 `uploadFile` 双模降级修过（`export/route.ts:164`），音频/图像生成路径未统一。
- **资产下载无超时**：`video-synthesis.ts:176-192` `downloadFile` 用裸 `fetch` 无 timeout；`transcribe.ts:80`、`generateVideo` 内 provider 之外的 fetch 同理。一个挂死的源 URL 会让导出/转写无限阻塞（外层也无总超时，因为不走队列的 timeout）。
- **ffmpeg 不可用**：`runFFmpeg` `video-synthesis.ts:399-417` 对 `spawn error`（ffmpeg 未安装→ENOENT）有 reject，错误能冒泡到 task FAILED——这条 OK。但 stderr 全量拼接进内存（`:402-404`）无上限，超长 ffmpeg 日志会吃内存。
- **临时文件泄漏（并发导出）**：主合成用时间戳子目录隔离并 `finally rm`（`video-synthesis.ts:568-573, 941-945`，OK）；**但 `downloadFile` 把下载产物写到共享根目录 `os.tmpdir()/ai-comic-export`**（`:177`，非时间戳子目录），文件名固定 `video_${order}.mp4`/`image_${order}.jpg`/`watermark_logo.png`/`sticker_N.png`。→ 两个并发导出**互相覆盖源文件**（数据错乱），且这些根目录文件**永不被清理**（`finally` 只删时间戳子目录）→ 磁盘缓慢撑爆。

### 1.8 可观测性：有 LLM tracing，但无系统/业务指标，日志非结构化

- **有**：Langfuse 包裹了 LLM/image/video 调用（`ai/index.ts:101,220,282` → `langfuse.ts:90`）。但完全 opt-in（无 `LANGFUSE_PUBLIC_KEY` 即 no-op，`:32-36`），线上大概率未配。
- **缺口**：
  - API 路由路径从不 `flushLangfuse()`（注释明说「API 路由不需要」`langfuse.ts:173`），Serverless/请求结束即冻结，`flushAt:1` 也可能丢尾 span。
  - **无任何系统/业务 metrics**：无队列深度、任务成功率、provider 错误率、p50/p99 时延、退款率。仅 `admin/metrics` 一个只读端点读队列计数（而队列是死的，读出来恒为 0）。
  - **日志非结构化**：`logger.ts` 纯 `console.*` 拼字符串，无 trace/request 关联 ID、无 JSON 输出，跨请求无法串联一次生成的全链路。`log.error("xx", error)` 直接把 Error 对象塞 console，stack 经常丢。
  - **Web 进程无全局兜底**：`unhandledRejection/uncaughtException` 仅在 `workers/main.ts:64-72`（死进程）注册；**Next 主进程没有**，游离 Promise 抛错只在各自 `.catch` 里，漏网的会静默或拖垮进程。
- **空 catch 吞错**：`ai-models/configs/[id]/test/route.ts:308 } catch {}`、多处 `.catch(() => {})`（`page.tsx:594/631/676` 批量生成、`generate-three-views/route.ts:240`）—— 批量生成单条失败被静默吞掉，用户不知道哪几条没出。

---

## 2. 问题分级

### P0（阻断：直接导致「卡住 / 丢任务 / 扣费无产出」）

| #    | 问题                                                                               | 证据                                                                      | 影响面                                                                    |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| P0-1 | **孤儿 PROCESSING/RUNNING 永不回收** + 前端无限轮询。进程重启即丢任务，UI 永久转圈 | `export/route.ts:218`、`workflow-engine.ts:71`、`page.tsx:180`、无 reaper | 每次部署/重启/OOM，所有在途导出与 workflow 全部变僵尸；用户界面卡死无反馈 |
| P0-2 | **Workflow 全程零积分校验/扣费**                                                   | `workflow/route.ts:30-104`、`workflow-engine.ts:248-262`                  | 资金漏洞：走 workflow 白嫖全流程生成；与同步路由计费不一致                |
| P0-3 | **Workflow 早期异常 → status 永久卡 PENDING**                                      | `workflow-engine.ts:144-147` + `:71 .catch` 吞错                          | 用户点「全自动」后若前置失败，永远显示「运行中」，无法重试                |
| P0-4 | **导出/transcribe 资产下载无超时 + 外层无总超时**                                  | `video-synthesis.ts:176-192`、`transcribe.ts:80`                          | 单个挂死的源 URL 让导出无限阻塞，占住请求/连接，最终 524/卡死             |

### P1（严重）

| #    | 问题                                                                                     | 证据                                                                | 影响面                                                               |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| P1-1 | **并发导出临时文件互相覆盖 + 根目录文件永不清理**                                        | `video-synthesis.ts:177`（共享根目录）vs `:568,941`（时间戳子目录） | 同时导出两个项目 → 产物错乱；磁盘缓慢撑爆                            |
| P1-2 | **Workflow 无幂等/并发锁 + 取消无效**                                                    | `workflow/route.ts`、`cancelWorkflow:118-123`                       | 重复点击启动多个并发 run 写同批 Scene，竞态；取消后任务仍在后台跑/扣 |
| P1-3 | **死代码 queue-workers 绕过积分审计、无退款、R2 未配仍扣费**                             | `queue-workers.ts:240-243/318-321/369-391`                          | 一旦接回真实路径即复现资金 bug；当前为定时炸弹                       |
| P1-4 | **`refundCredits` 零调用方**，无「先扣后退」兜底                                         | `lib/credits.ts:120` 仅定义                                         | 任何改成「预扣费」的改动都没有退款安全网                             |
| P1-5 | **无系统/业务可观测性**（成功率/时延/provider 错误率/队列深度），日志非结构化无 trace ID | `logger.ts`、`admin/metrics`（读死队列）                            | 线上故障无法定位、无法量化「成功率瓶颈」                             |

### P2（改进）

| #    | 问题                                                         | 证据                                                       |
| ---- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| P2-1 | 整套队列/worker/queue-errors/jobs 是死代码，徒增维护面与误导 | `queue.ts`/`queue-workers.ts`/`workers/main.ts` 零真实调用 |
| P2-2 | `handleWorkerError` 重试窗口内提前标 FAILED                  | `queue-errors.ts:77-91`                                    |
| P2-3 | Web 主进程无 `unhandledRejection/uncaughtException` 兜底     | 仅 `workers/main.ts:64-72`                                 |
| P2-4 | 空 catch / `.catch(()=>{})` 吞掉批量生成单条失败             | `page.tsx:594/631/676`、`configs/[id]/test/route.ts:308`   |
| P2-5 | 同步生成路由无「已 PROCESSING」双提交守卫                    | `generate/image/route.ts:137` 直接置 PROCESSING            |
| P2-6 | ffmpeg stderr 无上限拼接进内存                               | `video-synthesis.ts:402-404`                               |

---

## 3. 具体优化方案（可落地）

### 方案 A（推荐，治本）：把真实路径接回队列，统一容错

让 `/api/generate/*`、workflow fan-out、export 都改为 `addXJob` 入队，由 worker 消费。前提是**线上配 Redis**（与 perf agent 协同）。这样自动获得 BullMQ 的重试/退避/死信/`removeOnFail` 留痕（`queue.ts:301-311` 已写好）。接回前必须先修 P1-3（queue-workers 改用 `chargeCredits`/`refundCredits`）和 P2-2。

### 方案 B（不上 Redis 的最小止血，按 P0 优先级）

**P0-1 僵尸回收（核心）**——加一个 reaper，任一入口（中间件 / 定时 / 查询时 lazy）执行：

```ts
// lib/reliability/reap-stale.ts
const STALE_MS = 20 * 60 * 1000; // 20min，导出最长 30min 可调大
export async function reapStaleTasks() {
  const cutoff = new Date(Date.now() - STALE_MS);
  await prisma.$transaction([
    prisma.generationTask.updateMany({
      where: { status: "PROCESSING", startedAt: { lt: cutoff } },
      data: {
        status: "FAILED",
        error: "任务超时或服务重启中断",
        completedAt: new Date(),
      },
    }),
    prisma.workflowRun.updateMany({
      where: {
        status: { in: ["RUNNING", "PENDING"] },
        startedAt: { lt: cutoff },
      },
      data: { status: "FAILED", error: "工作流超时或服务重启中断" },
    }),
    prisma.scene.updateMany({
      where: { imageStatus: "PROCESSING", updatedAt: { lt: cutoff } },
      data: { imageStatus: "FAILED" },
    }),
    // videoStatus / audioStatus 同理
  ]);
}
```

- 触发：① systemd 启动钩子先跑一次（清掉上次崩溃残留）；② 在 `export GET` 状态查询里 lazy 跑一次轻量版（仅该 task）；③ 配合「`heartbeatAt` 字段」更准——游离 Promise 每 N 秒更新 `generationTask.output.heartbeatAt`，reaper 按心跳判死。

**P0-1 前端**——给轮询加总超时与 stale 探测：`pollExportProgress` 累计时长 > 35min 或连续 N 次 `processing` 且 `createdAt` 过老 → 主动报「任务可能已中断，请重试」并 `stopExportPoll`。

**P0-2 Workflow 计费**——在 `workflow/route.ts` 启动前预估总成本并 `chargeCredits`（事务内），或在 `executeMediaGeneration`/`executeImageGeneration` 每条产出成功后逐条 `chargeCredits(tx, {... sourceId: sceneId+type})`（幂等天然防重）；失败的产出不扣。最简止血：先加积分**校验**（余额不足直接拒启动）+ 限流。

**P0-3**——把 `executeWorkflow` 的 try 上移，包住 `findUnique` 与 `RUNNING` 标记；任何早期 throw 都进 catch 写 `FAILED`。

**P0-4 下载超时**——`downloadFile`/`transcribeOne` 的 `fetch` 加 `AbortSignal.timeout(60_000)`；export 整体加一个 wall-clock 上限（用 `withTimeout` 包 `synthesizeVideo`，复用 `ai/index.ts:66` 的工具）。

**P1-1**——`downloadFile` 改为写入调用方传入的 `outputDir`（时间戳子目录），文件名加 `${Date.now()}` 或 jobId 前缀；不再用共享根目录。

**P1-2**——`workflow/route.ts` 启动前查「该 project 是否有 status∈{PENDING,RUNNING} 的 WorkflowRun」，有则拒绝（409）或返回现有 runId（幂等）。

**P1-5 可观测性最小集**：

- 给 `logger` 加结构化 JSON 模式 + 透传 `requestId`/`workflowRunId` 作为 context；`log.error` 统一序列化 `error.stack`。
- 落一张 `generationTask`/`workflowRun` 的成功率/时延聚合（已有这两张表，加个 `/api/admin/metrics` 真实统计：`groupBy status`、`avg(completedAt-startedAt)`、`by provider`）替换当前读空队列的版本。
- Web 主进程入口（`instrumentation.ts`）注册 `unhandledRejection`/`uncaughtException` 仅记录不退出（避免 Next 被拖垮）。

### 方案对比

| 维度     | A 接回队列                  | B 最小止血                         |
| -------- | --------------------------- | ---------------------------------- |
| 治本程度 | 高（重试/死信/隔离齐全）    | 中（消除僵尸与漏费，但仍同步阻塞） |
| 依赖     | 必须 Redis + 起 worker 进程 | 无新增依赖                         |
| 工作量   | L                           | M                                  |
| 建议     | 中期目标                    | **先做，止血当前用户可见故障**     |

---

## 4. 行业标杆对标

| 能力             | 本项目现状                                                                                           | Runway / Pika / 剪映·CapCut 云渲染                                | 差距                    |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| 任务持久化与恢复 | 游离 Promise，进程重启即丢                                                                           | 持久队列（SQS/Temporal/自研），断点续跑、worker 崩溃自动 re-claim | **代际差距**            |
| 僵尸任务回收     | 无                                                                                                   | visibility timeout + heartbeat 自动判死重投                       | 缺失                    |
| 失败重试/退避    | 真实路径仅单次 try/catch                                                                             | 指数退避 + 死信队列 + 人工重放                                    | 缺失（代码写了但死）    |
| 扣费/退款一致性  | 同步路由 OK，workflow 零扣费、无退款                                                                 | 预授权(hold)→成功 capture→失败 release，全程幂等流水              | workflow 路径有资金漏洞 |
| 部分失败续传     | workflow `saveScenes` diff-upsert 保留已生成 URL（`workflow-engine.ts:826` 做得好）；export 全量重来 | 分镜级缓存命中、仅渲染变更片段                                    | 部分达标                |
| 可观测性         | LLM trace（opt-in），无系统指标                                                                      | 全链路 trace + 成功率/时延/成本仪表盘 + 告警                      | 明显落后                |
| 用户侧反馈       | 卡住时无任何提示（永久转圈）                                                                         | 失败可重试、可见预估时间、断线自动重连续传                        | 体验差距大              |

**亮点**：`lib/credits.ts` 的原子+幂等流水、workflow 的 scene diff-upsert 续传、Langfuse 接入、queue-errors 的错误分级——设计意图是行业水准，**问题在于没接到真实路径**。

---

## 5. 实施优先级与工作量

| 优先级     | 项                                                                  | 工作量 | 依赖      |
| ---------- | ------------------------------------------------------------------- | ------ | --------- |
| 1（立刻）  | P0-1 僵尸 reaper（启动钩子 + lazy + 前端总超时）                    | M      | 无        |
| 2（立刻）  | P0-4 下载/导出超时（AbortSignal + withTimeout 包合成）              | S      | 无        |
| 3（立刻）  | P0-3 executeWorkflow try 上移，杜绝 PENDING 永久卡                  | S      | 无        |
| 4（本周）  | P0-2 workflow 加积分校验+限流（先拒绝式止血，后逐条 chargeCredits） | M      | 无        |
| 5（本周）  | P1-1 downloadFile 写时间戳子目录 + 唯一文件名                       | S      | 无        |
| 6（本周）  | P1-2 workflow 启动幂等/并发锁                                       | S      | 无        |
| 7（两周）  | P1-5 结构化日志 + requestId + 真实 metrics 端点 + Web 进程全局兜底  | M      | 无        |
| 8（中期）  | P1-3 修 queue-workers 改用 chargeCredits/refundCredits（接回前提）  | S      | 无        |
| 9（中期）  | 方案 A：配 Redis + 起 worker + `/api/generate/*` 与 export 改入队   | L      | Redis     |
| 10（清理） | P2-1 删除/隔离死代码队列子系统，或明确文档「未启用」                | S      | 待 9 决策 |

**S=半天内，M=1-2 天，L=3-5 天。**

---

### 一句话总览

真实生成路径全是「游离 Promise + 同步阻塞」，一整套队列容错体系是死代码、未接线；**没有任何僵尸任务回收**，进程一重启在途任务全变孤儿、前端永久转圈；workflow 路径还**零积分校验**（资金漏洞）。先做 reaper + 超时 + workflow 计费止血，中期把真实路径接回队列。
