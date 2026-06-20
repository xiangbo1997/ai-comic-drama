# perf-backend — API/DB/队列/合成 性能诊断

> 领域：API 路由 / Prisma 查询 / 队列编排 / 视频合成。证据均引用 `file:line`。
> 不含前端渲染（归 perf-frontend）。

---

## 1. 现状诊断（证据驱动）

### 1.1 生成请求"占着请求线程同步跑" —— 队列形同虚设

队列基础设施完备（`services/queue.ts` 分桶 image/video/audio/export + BullMQ/InMemory 双模，`queue-workers.ts` 注册了 4 个 processor），**但用户实际触发的生成路由完全绕过队列，在 HTTP 请求里同步执行整条管线**：

- `api/generate/image/route.ts:259` 同步 `chatCompletion()`（LLM 场景分析）→ `:302` 同步 `orchestrateImageGeneration()`（生成+人脸校验+重试）→ `:333` 同步上传。整条链 10–60s 全程占用 Node 请求线程。
- `api/generate/video/route.ts:127` 同步 `generateVideo()`。该函数走 `services/ai/providers/poll.ts:51` 的 `while(true)+sleep` 阻塞轮询，视频 provider 通常 2–5 分钟 —— **单个视频请求独占一个请求线程长达数分钟**。
- `addImageGenerationJob/addVideoGenerationJob`（`queue.ts:550/577`）几乎无调用方使用；`initializeWorkers()`（`queue-workers.ts:37`）的 worker 与真实流量脱节。

后果：N 个用户并发点"生成"，Node 事件循环被同步 provider 调用钉死，DB 连接池（见 1.5）和其它 API（项目列表、编辑页加载）一起被拖垮。这是**架构级吞吐瓶颈**，不是单点慢查询。

### 1.2 视频导出在请求 worker 里 fire-and-forget，不走 exportQueue

`api/projects/[id]/export/route.ts:218` 异步模式用裸 `processExportAsync(...).catch(...)`，把 FFmpeg 合成（CPU 密集、数分钟）丢在**同一个 Next 请求进程**的后台 Promise 里，绕过了 `exportQueue`（concurrency=1，本就为 FFmpeg 串行设计）。代码注释 `:216` 自己都写了"生产环境中应使用任务队列"。
后果：① 无并发闸门，多人同时导出 → 多个 ffmpeg 抢 CPU；② 进程重启/部署 → 后台 Promise 丢失，任务永久卡 PROCESSING；③ Serverless 下函数返回即被冻结，合成中断。

### 1.3 video-synthesis.ts —— 素材串行下载 + 整片驻留内存

`services/video-synthesis.ts`：

- **串行下载**：`synthesizeVideo` 主循环 `:578` 逐个 `await sceneToVideoClip()`，每片内部 `:467 / :504` 串行 `downloadFile()`；音频 `:701-715` 又串行下载一轮；贴图 `prepareStickers:364` 串行下载。30 个分镜（图+音+贴图）= 数十次串行 HTTP，下载耗时线性累加，本可并行。
- **逐片 FFmpeg 串行转码**：每个分镜单独 spawn 一次 ffmpeg（`sceneToVideoClip`），再合并，再终合成 —— 对 30 镜是 30+ 次进程启动，无并行。
- **整片读进内存**：`:936 readFile(outputPath)` 把成片整体读成 `Buffer` 返回（`synthesizeVideo(): Promise<Buffer>`），上传也吃 Buffer。1080p 长片几十～几百 MB 常驻堆，叠加 build 限制 `--max-old-space-size=1024`（brief L32），**多导出并发即 OOM**。
- **tmp 目录**：`:568` 顶层 `synthesizeVideo` 的 tmpDir 有 finally 清理（`:941-948`，OK）；但 `downloadFile:177` 用的是固定 `os.tmpdir()/ai-comic-export`（无 run 隔离），同名 `video_${order}.mp4` 在并发导出间会互相覆盖。

### 1.4 N+1 重灾区：分镜批量保存

`api/projects/[id]/scenes/route.ts:142-176` POST：外层 `for` 每个 scene，内层 `for` 每个角色名调 `findCharacterByName()`（`:15` 自身 1–3 次查询），然后 `:161` 逐条 `prisma.scene.create()`。
30 镜 × 每镜 2 角色 ≈ 30 ×（2×2 次匹配 + 1 次 create）≈ **150 次串行往返**，且 `:135 deleteMany` + 重建无 `$transaction` 包裹 —— 失败留下半截数据。

`findCharacterByName` 的反向模糊匹配 `:41` 还会 `findMany` 拉项目全部角色到应用层 `.find()`。

### 1.5 Prisma 连接池/超时未配置

`lib/prisma.ts:15` `new Pool({ connectionString })` —— 未设 `max / idleTimeoutMillis / connectionTimeoutMillis / statement_timeout`。pg 默认 `max=10`。结合 1.1 的同步长请求：10 条连接很快被持有数分钟的请求占满，新请求排队超时。无 `statement_timeout` 意味着任何慢查询可无限挂住一条连接。

### 1.6 缺失索引（schema.prisma）

| 模型              | 高频查询                                                                        | 现状                                   | 证据                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Scene`           | `where {projectId} orderBy {order}`（编辑页/导出/worker 全走它）                | **无任何 @@index**                     | schema `:168-200`；查询见 `projects/[id]/route.ts:29`、`scenes/route.ts:77`、`queue-workers.ts:429`     |
| `GenerationTask`  | `where {sceneId,type,status}` / `{projectId,type,status}` / `groupBy createdAt` | **无任何 @@index**                     | schema `:350-369`；`queue-workers.ts:103/222/495`、`image/route.ts` updateMany、`admin/metrics:groupBy` |
| `Character`       | `where {userId} orderBy {updatedAt}`                                            | **无 @@index([userId])**               | schema `:210-235`；`characters/route.ts:49`                                                             |
| `WorkflowStepRun` | —                                                                               | 已有 `@@index([workflowRunId,step])` ✓ | schema `:652`                                                                                           |

Scene 缺 `projectId` 索引是最痛的——它在每次编辑页加载、每张图/视频/音频生成的 worker、每次导出里都被 filter+sort。

### 1.7 任务列表/监控 API 全表反序列化

- `jobs/route.ts:56 → queue.ts:681 getUserJobs`：对**每个队列**调 `getJobs()`（无 status 过滤 → 拉全部），再在应用层 `:693 filter(userId)`。BullMQ `removeOnComplete:{count:1000}` × 4 队列 + failed 5000 = **单次轮询可反序列化上万 job 对象**。前端若轮询此接口，放大严重。
- `admin/metrics/route.ts:47-62`：5 种 status × 4 队列 = **20 次 getJobs 全量拉取**，每次最多数千条。

### 1.8 热数据零缓存

- `lib/ai-config.ts` 四个 `getUserXConfig`：每次 1–3 条串行查询（default → enabled fallback）+ 每次 `decrypt()`（AES-GCM）。每个生成 job 都重新查+解密一遍同一份用户配置，**无任何缓存**。
- `AIProvider`（系统预置 provider，近乎静态）、用户角色/项目热数据均无缓存层。

### 1.9 编排器逐结果串行写库

`workflow-engine.ts:412-428` 图像并发批（concurrency=3）跑完后，`:426` 在结果循环里逐条 `await updateSceneImage()`；该函数（`:884`）又是 `findFirst`+`update` 两查 —— **批内并行生成的收益被串行写库抵消**，且两查都命中 1.6 的 Scene 无索引。

---

## 2. 问题分级

### P0（阻断级 —— 吞吐/稳定性根因）

| #    | 问题                                           | 影响面                                                                | 证据                                                                           |
| ---- | ---------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P0-1 | 图/视频生成在 HTTP 请求里同步跑，绕过队列      | 全站吞吐：少量并发即钉死事件循环+连接池                               | `generate/image/route.ts:259,302`；`generate/video/route.ts:127`；`poll.ts:51` |
| P0-2 | 视频导出 fire-and-forget 不走 exportQueue      | 多人导出抢 CPU；重启丢任务卡 PROCESSING                               | `export/route.ts:218`                                                          |
| P0-3 | Scene / GenerationTask 缺核心索引              | 每次编辑页加载/每个生成 worker/每次导出全表扫描，数据量上来后线性劣化 | schema `:168,:350`                                                             |
| P0-4 | video-synthesis 整片驻留内存 Buffer + 串行下载 | 1080p 长片并发导出 OOM（堆 1GB 上限）；导出耗时线性                   | `video-synthesis.ts:936,578,701`                                               |

### P1（严重）

| #    | 问题                                | 影响面                                | 证据                               |
| ---- | ----------------------------------- | ------------------------------------- | ---------------------------------- |
| P1-1 | 分镜批量保存 N+1（~150 往返）无事务 | 保存剧本卡顿数秒；失败留脏数据        | `scenes/route.ts:142-176`          |
| P1-2 | Prisma Pool 无 max/超时配置         | 长请求占满 10 连接→雪崩；慢查询无限挂 | `prisma.ts:15`                     |
| P1-3 | jobs/metrics 全队列全量反序列化     | 轮询放大，监控页拖慢 worker           | `queue.ts:681`；`admin/metrics:47` |
| P1-4 | ai-config 无缓存 + 每次解密         | 每个生成 job 多余 1–3 查询 + AES 运算 | `ai-config.ts` 全文                |

### P2（改进）

| #    | 问题                                                   | 影响面                                        | 证据                                           |
| ---- | ------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------- |
| P2-1 | workflow 逐结果串行写库（findFirst+update）            | 批内并行收益被抵消                            | `workflow-engine.ts:426,884`                   |
| P2-2 | downloadFile 共享固定 tmp 路径无 run 隔离              | 并发导出文件互相覆盖                          | `video-synthesis.ts:177`                       |
| P2-3 | 逐镜 spawn ffmpeg 串行                                 | 长片导出 CPU 利用率低                         | `video-synthesis.ts:578`                       |
| P2-4 | queue-workers 仍用裸 decrement 扣分（未走 credits.ts） | 与统一积分账本不一致（审计/一致性，非纯性能） | `queue-workers.ts:240,318,388` vs `credits.ts` |

---

## 3. 优化方案（可落地）

### 3.1 P0-1/P0-2：让生成与导出真正异步化（最高优先）

把 `generate/image`、`generate/video`、`export` 三个路由改成"创建 task → 入队 → 立即返回 taskId"，由 `queue-workers.ts` 的 processor 真正承载执行；前端轮询 `/api/jobs` 或 task 状态。worker 逻辑已存在（`handleImageGeneration/handleVideoGeneration/handleVideoExport`），需要：

```ts
// generate/video/route.ts（改造后骨架）
const task = await prisma.generationTask.create({ data: { type:"VIDEO_GENERATE", status:"PENDING", ... }});
const jobId = await addVideoGenerationJob({ userId, projectId, sceneId, imageUrl, prompt, duration, aspectRatio, referenceImages });
return NextResponse.json({ taskId: task.id, jobId, status: "queued" }, { status: 202 });
```

注意：① 扣分时机统一到 worker 成功后（worker 内改用 `credits.ts#chargeCredits`，顺带修 P2-4）；② 导出 worker 已就绪，路由直接 `addExportJob` 并删除 `processExportAsync`；③ 线上必须配 `REDIS_URL` 才能跨进程/跨重启可靠，否则 InMemoryQueue 重启即丢（brief 已注明 R2/Redis 线上未配——这是异步化的前置依赖）。

### 3.2 P0-3：补索引（schema.prisma + `prisma db push`）

```prisma
model Scene {
  // ...
  @@index([projectId, order])        // 编辑页/导出/worker 主路径
}
model GenerationTask {
  // ...
  @@index([sceneId, type, status])   // worker updateMany
  @@index([projectId, type, status]) // 导出 worker
  @@index([createdAt])               // admin metrics groupBy / 清理
}
model Character {
  // ...
  @@index([userId, updatedAt])       // 角色列表
}
```

线上是 `prisma db push`（无 migrate 历史，见 MEMORY），加索引非破坏性，可直接 push。大表建议先 `CREATE INDEX CONCURRENTLY`（手工 SQL）避免锁表。

### 3.3 P0-4：流式上传 + 并行下载

- **流式**：`synthesizeVideo` 改为返回 `outputPath`（或 ReadStream）而非 `Buffer`；`storage.ts` 上传用 stream（S3 `Upload` from `@aws-sdk/lib-storage` 支持 multipart stream；本地降级用 `createReadStream` pipe）。彻底消除整片驻留堆。
- **并行下载**：素材下载从串行改 `Promise.all` + 小并发闸门（如 `p-limit(4)`）：

```ts
import pLimit from "p-limit";
const limit = pLimit(4);
const clips = await Promise.all(
  scenes.map((s, i) => limit(() => sceneToVideoClip(s, tmpDir, options)))
);
```

（注意 xfade offset 依赖 effectiveDuration 顺序，`Promise.all` 保序 OK；clips 数组下标即原顺序。）

### 3.4 P1-1：分镜批量保存重写

一次性预取项目角色建 name→id Map（消除 `findCharacterByName` 的 N 次查询），用 `createMany` 批量插入，全程包 `$transaction`：

```ts
const chars = await prisma.character.findMany({ where:{ projects:{some:{projectId:id}} }, select:{id:true,name:true} });
const byName = new Map(chars.map(c=>[c.name.toLowerCase(), c.id]));
await prisma.$transaction([
  prisma.scene.deleteMany({ where:{ projectId:id }}),
  prisma.scene.createMany({ data: scenes.map((s,i)=>({ projectId:id, order:i, /*...*/, selectedCharacterId: resolveId(s, byName) })) }),
]);
```

往返从 ~150 降到 2。

### 3.5 P1-2：连接池显式配置

```ts
const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX ?? 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // 通过 options 设 statement_timeout，防慢查询挂死连接
  options: "-c statement_timeout=15000",
});
```

（异步化 P0-1 落地后压力骤降，但显式配置仍是必需的护栏。）

### 3.6 P1-3：按状态/分页查队列

`getUserJobs` 改为只查 `active`/`waiting`/最近 `completed`（带 `start,end` 分页 `getJobs(states, 0, 50)`），不要无参全量。BullMQ 用户态过滤建议改为以 DB 的 `GenerationTask`（带 userId+索引）为查询源，队列只查实时状态。

### 3.7 P1-4：缓存 ai-config

按 `userId+category` 做短 TTL 缓存（生产 Redis，开发进程内 Map，TTL 30–60s）；用户改配置时主动失效。解密结果可一并缓存（注意密钥安全——只缓存在内存，不落盘）。

### 3.8 P2-1：批量写库

`workflow-engine.ts` 用 `(projectId, order)` 复合唯一定位（建议给 Scene 加 `@@unique([projectId, order])`），直接 `update where {projectId_order}` 省掉 `findFirst`；批结果用 `Promise.all` 并发写。

---

## 4. 行业标杆对标（CapCut / Runway / Pika / 剪映）

| 维度         | 本项目现状                            | 标杆做法                                                                 | 差距                           |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------ | ------------------------------ |
| 生成任务模型 | 同步占请求线程（P0-1）                | Runway/Pika 全异步：提交即返 jobId，独立 GPU/worker 池，前端轮询/webhook | **根本性差距**，吞吐天花板极低 |
| 导出/合成    | 单机 ffmpeg 同步 spawn、整片入内存    | CapCut/剪映云端导出走专用转码集群 + 分片并行 + 流式落对象存储            | 单机串行、易 OOM               |
| 渲染加速     | libx264 CPU `preset medium`，逐镜串行 | NVENC/硬件编码 + 并行分片 + 转码农场                                     | 长片导出慢一个量级             |
| 失败恢复     | 进程重启丢后台任务（P0-2）            | 持久化队列 + 幂等重试 + 死信队列                                         | 无可靠性保证                   |
| 监控         | 全量反序列化拉队列（P1-3）            | BullMQ Board / 专用 metrics 表 + 时序库                                  | 监控本身拖慢系统               |
| 数据层       | Scene/Task 无索引（P0-3）             | 标杆数据量大、索引齐全、读写分离                                         | 数据量增长后线性劣化           |

核心结论：**本项目把"AI 算力调度"和"Web 请求处理"耦合在同一进程同一线程**，这是与标杆的本质差距。标杆的生成/转码都是独立可横向扩展的 worker 池，Web 层只做提交与状态查询。

---

## 5. 实施优先级与工作量（S/M/L）

| 优先级        | 项                           | 工作量  | 说明                                                                |
| ------------- | ---------------------------- | ------- | ------------------------------------------------------------------- |
| **1（先做）** | P0-3 补索引                  | **S**   | 改 schema + `db push`，零风险、收益立竿见影                         |
| **2**         | P1-2 连接池配置              | **S**   | 改 1 个文件，护栏                                                   |
| **3**         | P1-1 分镜保存重写            | **S–M** | 单路由，150→2 往返                                                  |
| **4**         | P0-1 生成路由异步化          | **L**   | 三路由改造 + worker 扣分迁移 + 前端轮询联调；依赖线上配 `REDIS_URL` |
| **5**         | P0-2 导出走 exportQueue      | **M**   | worker 已就绪，删 fire-and-forget；同样依赖 Redis                   |
| **6**         | P0-4 流式上传+并行下载       | **M–L** | 改 synthesizeVideo 返回类型 + storage 流式上传，需回归导出          |
| **7**         | P1-4 ai-config 缓存          | **M**   | 缓存层 + 失效逻辑                                                   |
| **8**         | P1-3 队列查询分页/改 DB 源   | **M**   | jobs + metrics 两接口                                               |
| **9**         | P2-1/2-4 批量写库 + 扣分统一 | **S–M** | 一致性+小幅性能                                                     |

**前置依赖（关键）**：P0-1/P0-2 的异步化收益完全依赖线上配置 `REDIS_URL`（持久化队列）；当前线上 InMemoryQueue 重启即丢，无法支撑真正的异步可靠投递。建议第 4 步前先落地 Redis。

**最小快赢组合**：第 1+2+3 项（全 S 级、零架构风险）即可显著改善编辑页加载与剧本保存体验；P0-1/P0-2 是中长期吞吐天花板的根治项，需配 Redis 后投入。
