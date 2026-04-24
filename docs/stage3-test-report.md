# Stage 1 + 2 + 3 最终测试报告

> 生成时间：2026-04-24
> 依据计划：`/Users/shamoyulvren/.claude/plans/ai-transient-lighthouse.md`
> 测试范围：Stage 1 质量链路 + Stage 2 生产级可靠性 + Stage 3 架构演进的端到端手动验证
> 自动测试：`pnpm type-check && pnpm lint && pnpm test && pnpm build` 已全绿（D1 已完成）

---

## 使用说明

- T1-T8 为 8 个关键链路的手动验证清单。每项按"步骤 → 预期 → 观察点 → 实际结果"填写
- 测试前请确认部署已就绪（详见第 0 节）
- 每项预计 5-10 分钟；全部跑完约 60 分钟
- 每项完成后在"实际结果"栏填入 ✅ / ❌ / ⚠️ 与简短说明

---

## 0. 测试环境准备（Pre-flight）

**一次性操作**（第一次测试前）：

```bash
# 1. 启动 Redis（生产强依赖；开发可选但推荐）
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 2. Schema 同步（Stage 1.9 加了 Project.generationParams）
cd app
pnpm exec prisma db push
pnpm db:generate

# 3. 环境变量（.env.local）
# 必填：DATABASE_URL / NEXTAUTH_SECRET / ENCRYPTION_KEY / 至少一个 LLM 与图像 provider
# Stage 2/3 新增：
#   REDIS_URL="redis://localhost:6379"
#   LANGFUSE_PUBLIC_KEY="..."  (可选；不填则 trace 失败静默)
#   LANGFUSE_SECRET_KEY="..."
#   ADMIN_EMAILS="your@email.com"
#   LOG_LEVEL="debug"   (T1/T2 日志验证需要)
```

**每次测试前启动**：

```bash
# 终端 A：Web
cd app && pnpm dev

# 终端 B：Worker（Stage 2.2）
cd app && pnpm worker:start

# 终端 C：监控日志（可选，便于排错）
# Web 日志已在终端 A；Worker 日志在终端 B
```

---

## T1 — Prompt 管线统一（Stage 1.1-1.3）

| 项 | 内容 |
|----|------|
| 验证点 | 编辑器"重生成图像"请求体包含 `referenceImage`（若场景选了角色）+ `negativePrompt`，不再是简单 `prompt + stylePrefix` 拼接 |
| 前置 | 已登录 + 有至少 1 个项目、已解析分镜、已建立至少 1 个角色并绑定到某场景 |

**步骤**：
1. 进入 `/editor/<projectId>`
2. 在分镜列表选中一个**已绑定角色**的场景
3. 打开 DevTools → Network → 过滤 `generate/image`
4. 点击该场景的"重新生成图像"按钮
5. 查看 Network 面板中该 POST 请求的 Request Payload

**预期**：
- Request body 包含字段：`prompt`、`negativePrompt`（非空，含 anime/realistic 等风格相关的负向词）、`referenceImage`（若角色有 referenceImages）、`style`、`imageConfigId`（若选了 AI 模型）
- 服务端日志（`LOG_LEVEL=debug`）出现：`Received negativePrompt from client` 与 `Received referenceImage from client`

**观察点**：
- 若场景**没**绑定角色，`referenceImage` 为 undefined（允许）
- 客户端 prompt 字段不再是 `"anime style, high quality anime illustration, ..."` 这种硬编码拼接

**实际结果**：待填

---

## T2 — 缓存命中（Stage 2.7）

| 项 | 内容 |
|----|------|
| 验证点 | 相同 prompt + 相同参数的第二次请求命中 Redis 缓存，延迟 < 500ms |

**步骤**：
1. 确认 `REDIS_URL` 已配置且 Redis 可达
2. 同一场景点"重生成"得到图（第一次，完整生成）
3. **不改任何参数**（角色 / 风格 / 比例），再次点"重生成"
4. 对比两次的响应延迟与服务端日志

**预期**：
- 第一次延迟：通常 10-60s（取决于 provider）
- 第二次延迟：**< 500ms**
- 服务端日志（`LOG_LEVEL=debug`）出现：`Prompt cache hit`
- 返回的 `imageUrl` 与第一次完全相同

**观察点**：
- 若用中转站 `proxy-unified`，同 prompt 的 referenceImages 集合排序无关（orchestrator 已 normalize）
- 缓存命中仍会跑 face-validator（远景直接 skip；特写/近景需要 LLM 二次确认）

**实际结果**：待填

---

## T3 — 角色一致性 reference_edit 策略（Stage 1.4-1.6）

| 项 | 内容 |
|----|------|
| 验证点 | 场景绑定角色 + provider 支持参考图 → orchestrator 策略选 `reference_edit`；响应带 `strategy: "reference_edit"` |

**步骤**：
1. 项目 → 角色管理 → 选一个有 `referenceImages` 的角色（或上传/生成一张定妆图）
2. 新建/编辑一个场景，绑定该角色
3. 点"重生成"
4. 观察 Network 响应 JSON 与 Langfuse trace（若已配置）

**预期**：
- Response JSON 包含 `strategy: "reference_edit"`，`attemptCount >= 1`
- Langfuse（若启用）`generate_image` span 的 `metadata.hasRef: true`
- 生成图在角色脸部 / 服装上与参考图可识别相似

**观察点**：
- 若 provider 不支持参考图（`IMAGE_PROVIDER_CAPABILITIES`），策略仍是 `prompt_only`
- 若 face-validator 判定相似度 < 阈值，`attemptCount > 1`（最多 3 次）

**实际结果**：待填

---

## T4 — Workflow SSE 多 tab 广播（Stage 2.4-2.5）

| 项 | 内容 |
|----|------|
| 验证点 | 开 2 个 tab 订阅同一 workflowRunId，两 tab 都收到完整事件流；事件带 `seq` 字段 |

**步骤**：
1. Tab A 打开项目编辑器，粘贴文本 → 启动 Workflow（走 WorkflowPanel）
2. 从 Tab A 控制台或 Network 记下 `workflowRunId`
3. Tab B（同域）用 `EventSource("/api/workflow/<runId>/events")` 订阅（浏览器 Console 执行）：
```js
const es = new EventSource("/api/workflow/<runId>/events");
es.addEventListener("message", (e) => console.log(new Date().toISOString(), JSON.parse(e.data)));
```
4. Tab A 自身的 `WorkflowPanel` 继续接收事件

**预期**：
- 两 tab 同时收到 `step:started` / `step:completed` / `progress:update` 事件
- 每个事件 JSON 带 `seq: <递增数字>`（Stage 2.4 加的）
- 若 `REDIS_URL` 未配：**事件只在发事件的进程内收到**（Web 进程）；跨 worker 进程的事件（图像 job 的 progress）**Tab B 收不到**
- 若 `REDIS_URL` 已配：跨进程事件 100% 送达

**观察点**：
- Worker 进程发的事件（`progress:update` 图像批次）是验证 PubSub 的关键
- 心跳 `: heartbeat\n\n` 每 30s 一次

**实际结果**：待填

---

## T5 — Worker 进程恢复（Stage 2.1-2.3，需 Redis）

| 项 | 内容 |
|----|------|
| 验证点 | Worker 进程被 `kill -9` 后，未完成的 BullMQ job 在新 worker 启动后被重放，workflow 最终成功 |

**步骤**：
1. `REDIS_URL` 已配置并可达
2. 终端 A: `pnpm dev`；终端 B: `pnpm worker:start`
3. 启动一个 workflow（输入一段 500 字左右的小说，让它走完 parse → bible → storyboard → **开始图像生成** 那一刻）
4. 观察到 `image:generate` job 进入 `active` 状态时，立刻终端 B `Ctrl+C` 或 `kill -9 <worker pid>`
5. 立即 `pnpm worker:start` 重启 worker
6. 观察 workflow 最终是否完成（Web UI 或 `/admin/metrics`）

**预期**：
- BullMQ `stalled` 检测在 ~30s 内触发，job 被新 worker 接管
- workflow 最终状态 `COMPLETED`
- 不会丢失已完成的图像（Stage 2.6 的 diff-upsert 保证重跑不覆盖）

**观察点**：
- `/admin/metrics` 可以看到 `active` / `waiting` / `failed` 队列计数变化
- 日志里找 `Queue workers initialized`（新 worker 启动）

**实际结果**：待填

---

## T6 — Admin 面板（Stage 3.6）

| 项 | 内容 |
|----|------|
| 验证点 | 配 `ADMIN_EMAILS` 后访问 `/admin/metrics` 看到队列状态 + 近 7 天任务统计 + 最近 20 workflow |

**步骤**：
1. `.env.local` 加 `ADMIN_EMAILS=你的登录邮箱`（全小写更保险），重启 dev server
2. 登录该邮箱账号
3. 浏览器访问 `/admin/metrics`

**预期**：
- 页面显示 3 个 section：任务队列（4 个：image/video/audio/export）、近 7 天生成统计、最近 Workflow
- 每 30s 自动刷新（可观察到时间戳变化）
- 右上角"刷新"按钮可手动触发

**观察点**：
- 用**非**管理员邮箱访问 → 页面显示"无权限或页面不存在"（后端 404 伪装）
- 未登录访问 → 同样 404
- 若所有队列 waiting/active 都是 0，启动一个 workflow 再看

**实际结果**：待填

---

## T7 — LLM 参数可调（Stage 1.9-1.10）

| 项 | 内容 |
|----|------|
| 验证点 | PATCH `/api/projects/[id]` 写入 `generationParams.temperature=0.2` → 下一次 workflow 的 agent 调用温度即为 0.2 |

**步骤**：
1. 对一个已存在的项目（记下 `<projectId>` 与 session cookie）：
```bash
# 从浏览器 DevTools → Application → Cookies 复制 next-auth.session-token
curl -X PATCH "http://localhost:3000/api/projects/<projectId>" \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<your_token>" \
  -d '{"generationParams":{"temperature":0.2,"topP":0.9}}'
```
2. 重新启动一次该项目的 workflow
3. 查 Langfuse（若启用）或服务端日志

**预期**：
- PATCH 响应 200，返回的 project JSON 含 `generationParams: {temperature: 0.2, topP: 0.9}`
- Langfuse `chat_completion` span 的 `metadata.temperature = 0.2`
- 或服务端日志中 resolve 后的 temperature 为 0.2（若日志未打印该字段，可临时在 `services/agents/llm-params.ts` 加一行 debug 日志）

**观察点**：
- 越界值会被 API 路由 clamp（temperature 最大 1.5，topP 最大 1）
- 不传该字段 → fallback 到各 agent 的硬编码默认值

**实际结果**：待填

---

## T8 — Negative prompt（Stage 1.2-1.3）

| 项 | 内容 |
|----|------|
| 验证点 | 任意图像生成请求的 body `negativePrompt` 非空；内容按风格变化 |

**步骤**：
1. 项目风格设为 `anime`，点"重生成"；查 Network body 的 `negativePrompt`
2. 把项目风格改为 `realistic`，再点"重生成"；再查

**预期**：
- `anime` 模式的 negative 包含 `"3d render"` / `"photorealistic"` 等（防止画成写实）
- `realistic` 模式的 negative 包含 `"cartoon"` / `"anime"` 等（防止画成动漫）
- 两者共用基线部分：`"lowres"`, `"worst quality"`, `"bad anatomy"`, `"extra fingers"` 等

**观察点**：
- 中转站（`proxy-unified`）会把 `negativePrompt` 合并到 messages 里（不是 OpenAI `negative_prompt` 字段，因中转站不支持）
- 其他原生 provider（Fal/Replicate）本次 Stage 1.5 未改造，仍不消费 `negativePrompt` —— 这是已知限制

**实际结果**：待填

---

## D3 回归冒烟（5 分钟）

以下 5 项保证 Stage 1/2/3 无破坏性回归：

| # | 验证 | 预期 |
|---|------|------|
| R1 | 未登录访问 `/editor/xxx` | 跳转 `/login` |
| R2 | 登录 → 创建新项目 → 进入编辑器 | 空编辑器正常打开，无 console error |
| R3 | 粘贴脚本 → 点"解析" → 生成单张图 | 分镜显示 + 单图返回（验证 Stage 1 全链路）|
| R4 | 切换 SettingsPanel 风格 → 重新生成 | 风格变化，3.8 抽取无回归 |
| R5 | 删除一个场景 → 观察 selectedSceneId 行为 | 若之前选的是它，当前页面逻辑决定是否换选中（Stage 3.5 已把"自动清空"从 store 移除；编辑器走 React Query 不依赖 store）|

---

## 测试执行记录

| 测试 | 执行人 | 执行时间 | 结果 | 备注 |
|------|--------|---------|------|------|
| T1 | | | | |
| T2 | | | | |
| T3 | | | | |
| T4 | | | | |
| T5 | | | | |
| T6 | | | | |
| T7 | | | | |
| T8 | | | | |
| R1-R5 | | | | |

---

## 常见问题排查

| 症状 | 可能原因 | 排查 |
|------|---------|------|
| T2 缓存从不命中 | Redis 未连 / prompt 被每次带上变化的时间戳 | `redis-cli KEYS "pcache:img:*"` 查 key 数量 |
| T4 Tab B 收不到 worker 事件 | REDIS_URL 未配 / worker 和 web 的 Redis 地址不一致 | 看 worker 日志 `Redis connected` 行 |
| T6 /admin/metrics 404 | ADMIN_EMAILS 未配 / 邮箱大小写 / 重启 dev 未生效 | 看 Network 响应是 404（权限）还是 500（bug） |
| T7 Langfuse 没 trace | LANGFUSE_PUBLIC_KEY 空 / flushAt 未触发 | 临时 `LANGFUSE_FLUSH_AT=1` |
| vitest 报"Cannot find module '@/...'" | tsconfig paths 未被 vitest 识别 | 检查 `vitest.config.ts` 的 `resolve.tsconfigPaths: true` |

---

## 下一步（测试完成后）

1. 填完上面的"实际结果"栏
2. 若有 ❌ 项，按"常见问题"或对应 Stage 的计划章节回查
3. 全部 ✅ 后标注本文档 `测试状态: PASSED` 并记日期
4. 若发现新 bug，新开 issue，引用此报告对应 T# 编号
