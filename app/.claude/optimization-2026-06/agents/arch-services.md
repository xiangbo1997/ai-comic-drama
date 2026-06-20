# 服务层 / AI Provider 抽象 / 分层依赖 — 架构诊断

> 领域：`services/ai`、`services/generation`、`services/agents`、巨型 AI 测试路由、分层依赖
> 分析者：服务层架构师 | 日期：2026-06-19
> 方法：证据驱动，所有结论引用 `file:line`

---

## 1. 现状诊断（证据）

### 1.1 多协议门面（services/ai）— 设计良好但有结构债

**优点（值得肯定）**：

- 门面四函数 `chatCompletion / generateImage / generateVideo / synthesizeSpeech` 签名干净，对上稳定（`services/ai/index.ts:88,214,275,320`）。
- Provider 接口抽象正确：`LLMProvider / ImageProvider / VideoProvider / TTSProvider` 四个单方法接口（`services/ai/types.ts:15-45`），符合 ISP。
- `provider-factory.ts` 按 `protocol` 路由，是单一注册点（`provider-factory.ts:100,113,148,177`）。
- `IMAGE_PROVIDER_CAPABILITIES` 能力表把"provider 能做什么"数据化，被 `strategy-resolver` 消费做策略决策（`provider-factory.ts:39-82` → `strategy-resolver.ts:26`）。这是整个服务层最干净的解耦点。
- 超时归一在 facade 层用 `withTimeout` 统一包裹，provider 不需各自实现（`index.ts:66-86,145,312`）。

**问题**：

**(A) `sdk.ts` 是完整的死代码（~194 行）**。`chatCompletionV2` / `generateStructured` 零调用方：

```
grep chatCompletionV2|generateStructured  →  仅 sdk.ts 自身命中，无任何 import
```

注释声称"新代码建议用它"（`sdk.ts:9`），但全仓库无人采纳。它引入了 `@ai-sdk/openai`、`@ai-sdk/anthropic`、`@ai-sdk/google`、`ai` 四个重依赖却完全未用 → 冷启动负担 + 维护幻觉（看起来项目有结构化输出能力，实际没接）。

**(B) `sdk.ts` → `index.ts` 反向循环依赖**。`sdk.ts:24` `import { chatCompletion as legacyChatCompletion } from "./index"`，而 `index.ts` 是门面入口。`sdk.ts` 定位是"底层 LLM 实现"，却回头依赖门面 → 层级倒置。当前因 sdk 无人用未爆雷，一旦启用会出现门面↔SDK 双向耦合。

**(C) `AIProviderProtocol` 联合类型形同虚设**。`types/ai.ts:94-104` 只列 10 个协议字面量，但 `AIServiceConfig.protocol` 字段类型是 `string`（`types/ai.ts:13`），factory 里实际路由的协议包含 `flow2api`（`provider-factory.ts:157`）、`deepseek` / `xai` / `anthropic` / `openai-compatible`（`sdk.ts:38,54-58`），测试路由还有 `kling/minimax/luma/fish-audio/mistral/cohere`。类型与运行时严重脱节 → 新增协议时编译器零保护，typo 直接静默走 default 分支。

**(D) baseUrl 推断兜底是抽象泄漏的活化石**。factory 三处 `if (baseUrl.includes("x.ai"/"fal.run"/"runwayml"...))`（`provider-factory.ts:135-141,167-171,193-198`）。注释自称"兼容旧配置/即将淘汰"，但仍在生产路径，字符串魔法匹配域名脆弱（中转站换域名即失配）。

### 1.2 LLMMessage 是 string-only → 逼出 3 处 facade 绕过

`LLMMessage.content: string`（`types/ai.ts:20`）不支持多模态 parts 数组。后果是任何需要"图+文"输入的调用**全部绕过门面直接 fetch**：

- `face-validator.ts:118-155`（人脸一致性 vision 打分，手写 fetch + 手写 JSON 解析）
- `vision-reviewer.ts:50-78`（同一套手写 fetch，注释明说"复用 face-validator 的做法 —— 绕过 chatCompletion"）

这两处各自重写了 endpoint 拼接、auth header、错误处理、score 提取，且**只覆盖 OpenAI schema**（face-validator.ts:13 注释承认 Claude 路径未覆盖）。门面的超时/重试/Langfuse 观测对它们全部失效。这是一个抽象缺口逼出的重复代码 + 能力空洞。

### 1.3 两个巨型测试路由 — 最严重的架构违规

| 文件                                       | 行数 | 内嵌函数        |
| ------------------------------------------ | ---- | --------------- |
| `api/ai-models/configs/[id]/test/route.ts` | 1356 | 25 个 `testXxx` |
| `api/ai-models/test/route.ts`              | 1115 | 24 个 `testXxx` |

**这两个文件几乎是彼此的复制粘贴**（函数集 diff 仅差 2-3 个：一个有 `testDeepSeek/testFlow2apiVideoModel`，另一个把 `testOpenAI` 叫 `testOpenAICompatible`）。两文件合计 ~2471 行，其中 ~90% 是重复的 provider 连通性探测逻辑。

更深的问题：**它们把 provider 的连接/认证/错误识别逻辑第三次实现了一遍**——`testOpenAIModelImage`（route 470-556）手写的 `/images/generations` 调用、HTML/401/404 错误分类，与 `openai-compatible.ts:401-487` 的生产 provider 逻辑高度重叠但**各写各的**。Provider 抽象的全部价值（一处实现、多处复用）在测试路径被完全抛弃。

单文件 1356 行严重违反 SRP；25 个 provider 探测函数挤在一个 route handler 文件里，无法单测、无法复用、任何新增 provider 要在**两个**文件里各加一遍。

### 1.4 services/agents — 总体优秀，局部过度工程

**优秀**：

- `runClosedLoop`（`closed-loop.ts:124`）是真正干净的 ReAct/Evaluator-Optimizer 抽象，被 image-consistency / character-bible 复用（`image-consistency-agent.ts:62`、`workflow-engine.ts:679`），保留 bestScore/防死循环/容错降级等不变量，注释清晰。这是服务层最好的设计。
- `Agent<TInput,TOutput>` 泛型接口统一（`types.ts:11`），`executeAgentStep` 统一持久化 + 事件（`workflow-engine.ts:307`）。
- `resolveLLMParams` 把散落的 temperature/maxTokens 收口（`llm-params.ts:33`），消除了"改一个漏一个"。
- artifact-store / event-bus 已从 engine 拆出（`workflow-engine.ts:7-9` 注释）。

**问题**：

**(E) `workflow-engine.ts` 仍 901 行，执行逻辑与 DB/媒体编排耦合**。`executeWorkflow`（127-304）一个函数串起 5 步 + 3 个闭环；`executeMediaGeneration`（531-650）把"查 DB scene → 查 project aspectRatio → 构建角色上下文 → 调 generateVideo/synthesizeSpeech → 写回 scene 状态"全塞一处。`buildSceneCharacterContext`（467-528）直接 `prisma.character.findMany` —— **agent 编排层直接写 Prisma 查询**，与"服务层不直接处理 HTTP，接受纯数据"的约定（services/CLAUDE.md §关键约定）精神相悖：engine 既是编排器又是数据访问层。

**(F) 四闭环里三个是"半成品"**。`reviewStoryboardCoherence`/`reviewVideoCoherence`（730,775）默认关闭且**只评分不重生成**（注释 658,773 自述）；`character-bible-observer`/`narrative-observer`/`vision-reviewer`/`observer-agent` 共 4 个 observer 文件 + `closed-loop` 策略表，支撑的实际有效闭环只有 imageConsistency 一个默认开启（`closed-loop.ts:32-36`）。21 个 agent 文件里相当比例是为"未来可能开启"的闭环预留的脚手架 → 维护面 vs 实际收益失衡。

**(G) 重复的 seed 哈希**。`hashStringToSeed`（`image-orchestrator.ts:140`）与 `identitySeedFromCharacterId`（`workflow-engine.ts:447`）是逐字节同构的 FNV-1a，注释互相声称"同构/共用"却各拷一份（`workflow-engine.ts:444` 注释承认）。

### 1.5 services/generation — 设计干净，一个隐患

`image-orchestrator.ts` 编排循环清晰（策略→缓存→生成→验证→重试），缓存 key 设计合理（`image-orchestrator.ts:39-48`）。**但 ImageConsistencyAgent 与 orchestrator 是两套并行的"生成+验证+重试"实现**：

- API 路径 `/api/generate/image` → `orchestrateImageGeneration`（含 prompt-cache + face-validator）
- Workflow 路径 → `ImageConsistencyAgent`（含 observer + reflection，**不走 prompt-cache，不走 face-validator，走另一套 ObserverAgent**）

两条路径对"同一件事（保证角色一致的生图）"用了**完全不同的验证器和重试策略**（`image-orchestrator.ts:96` vs `image-consistency-agent.ts:87`）。质量行为不一致，且 strategy-resolver 是唯一共享点。

---

## 2. 问题分级

### P0（阻断/架构红线）

| #    | 问题                                                           | 影响面                                                                       | 证据                                                                           |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| P0-1 | 两个测试路由 1356+1115 行，互为复制 + 第三次重写 provider 逻辑 | 加任一新 provider 要改 3 处（provider + 两个 route）；无法单测；SRP 彻底破裂 | `configs/[id]/test/route.ts` 全文、`test/route.ts` 全文；函数集 diff 仅差 3 个 |
| P0-2 | `sdk.ts` 全量死代码 + 反向循环依赖 index.ts                    | 4 个 AI SDK 重依赖空载冷启动；循环依赖一旦启用即爆                           | `sdk.ts:24`；grep 零调用方                                                     |

### P1（严重）

| #    | 问题                                                                                                   | 影响面                                             | 证据                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------- |
| P1-1 | LLMMessage string-only 逼出 2 处多模态 fetch 绕过，门面观测/超时/重试全失效，Claude 多模态无覆盖       | vision 类能力无法走统一通道，错误处理各写各的      | `types/ai.ts:20`；`face-validator.ts:118`；`vision-reviewer.ts:50`   |
| P1-2 | 图像生成存在两套独立的"生成+验证+重试"（orchestrator vs ImageConsistencyAgent），验证器/缓存策略不一致 | 同一业务两种质量行为；prompt-cache 仅 API 路径享受 | `image-orchestrator.ts:96` vs `image-consistency-agent.ts:62-114`    |
| P1-3 | `workflow-engine.ts` 901 行，编排层直接写 Prisma 查询 + 媒体生成耦合                                   | 难测、难改、违反服务层"接收纯数据"约定             | `workflow-engine.ts:467-528,531-650`                                 |
| P1-4 | `AIProviderProtocol` 类型与运行时协议严重脱节（缺 flow2api/deepseek/xai 等），protocol 实为 string     | 新协议零编译保护，typo 静默落 default              | `types/ai.ts:13,94-104` vs `provider-factory.ts:157`、`sdk.ts:38,54` |

### P2（改进）

| #    | 问题                                                                     | 影响面                              | 证据                                                                           |
| ---- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------ |
| P2-1 | factory baseUrl 域名字符串推断兜底（脆弱、声称已淘汰仍在线）             | 中转站换域名即失配                  | `provider-factory.ts:135-141,167-171,193-198`                                  |
| P2-2 | FNV-1a seed 哈希两处重复                                                 | 改一处漏一处风险                    | `image-orchestrator.ts:140`、`workflow-engine.ts:447`                          |
| P2-3 | 三闭环（storyboard/video/characterBible）半成品脚手架，observer 文件冗余 | 21 文件维护面 vs 实际仅 1 闭环生效  | `closed-loop.ts:32-36`；`workflow-engine.ts:730,775`                           |
| P2-4 | openai-compatible.ts 488 行内嵌 4 段几乎相同的 HTML/401/404 错误分类     | edits 与 generations 两路径各拷一份 | `openai-compatible.ts:159-213` vs `418-486`                                    |
| P2-5 | token 计数全靠 `length/4` 粗估，多处散落                                 | 成本/计费不准                       | `index.ts:151`、`script-parser-agent.ts:153`、`image-consistency-agent.ts:103` |

---

## 3. 优化方案（可落地）

### 3.1 P0-1：抽出统一 ProviderProbe，消灭两个巨型路由

**目标**：把 25 个 `testXxx` 收编为 provider 自带能力，两个 route 退化为薄 handler。

新增 `services/ai/types.ts`：

```ts
export interface ProbeResult {
  success: boolean;
  message: string;
  errorType?: "auth" | "network" | "model" | "config" | "unknown";
  suggestion?: string;
}
/** 所有 provider 可选实现连通性探测；门面提供默认 /models GET 兜底 */
export interface Probeable {
  probe(config: AIServiceConfig, modelId?: string): Promise<ProbeResult>;
}
```

每个 provider 文件（已有 `openaiCompatibleImage` 等）补一个 `probe()`，复用其**生产路径的同一套** endpoint + 错误分类（把 `openai-compatible.ts:159-213` 的 `throwOpenAIImageError` 改造成返回 `ProbeResult` 的 `classifyOpenAIError`，probe 与 generate 共用）。

新增 `services/ai/probe.ts` 单一调度：

```ts
export async function probeConfig(
  category: AICategory,
  protocol: string,
  config: AIServiceConfig,
  modelId?: string
): Promise<ProbeResult> {
  /* 按 category+protocol 路由到 provider.probe */
}
```

两个 route 各自缩到 ~60 行：解析 body → 取/解密 config → `probeConfig(...)` → 写 testStatus → 返回。**两文件唯一差异**（按已保存 config vs 按传入 modelId）在 handler 里区分，探测逻辑零重复。

工作量：**L**（25 函数迁移，但多数是机械搬运 + 去重；收益是 ~2400 行降到 ~400 行且新 provider 只改 1 处）。

### 3.2 P0-2：删除 sdk.ts 或真正接线

二选一，**优先删除**（YAGNI）：当前 `chatCompletion` 已满足所有调用方。若要保留结构化输出能力（对 script-parser 的 Zod 自修复有价值），则**反转依赖**：把 `buildSDKModel` 放进 `provider-factory`，`index.ts#chatCompletion` 内部改为优先走 SDK、proxy-unified 回退手写 provider——让 SDK 成为门面的实现而非门面的消费者，消除循环。配套移除未用的 `@ai-sdk/*` 依赖（若删除路线）。

工作量：删除 **S** / 接线 **M**。

### 3.3 P1-1：LLMMessage 升级为多模态，回收两处绕过

```ts
export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[]; // 向后兼容 string
}
```

`openaiCompatibleLLM.chatCompletion`（`openai-compatible.ts:79`）的 body 直接透传 content（OpenAI schema 原生支持）；claude/gemini provider 做 parts→各自 schema 的转换。然后 `face-validator.ts` / `vision-reviewer.ts` 改为调 `chatCompletion(multimodalMessages, {config})`，删掉两处手写 fetch + score 提取（提取逻辑下沉为共享 util）。收益：Claude 多模态自动覆盖、超时/Langfuse 生效、~120 行重复消失。

工作量：**M**。

### 3.4 P1-2：统一图像生成单一管线

让 `ImageConsistencyAgent.run` 内部直接调用 `orchestrateImageGeneration`，把 observer-reflection 作为 orchestrator 的可选 `validator` 注入（orchestrator 已有 `validateFaceConsistency` 插槽，扩展为接受策略对象）。删除 ImageConsistencyAgent 里平行的 generate/observe 循环（`image-consistency-agent.ts:62-114`），workflow 与 API 共享同一条带缓存的管线。

工作量：**M**。

### 3.5 P1-3：workflow-engine 抽数据访问层

新增 `services/agents/workflow-repository.ts`，把 `buildSceneCharacterContext`、`saveScenesToProject`、`updateSceneImage`、`executeMediaGeneration` 里的 Prisma 查询全部下沉。engine 只编排、收发纯数据 artifact。目标把 engine 压到 ~400 行。

工作量：**L**。

### 3.6 P1-4：协议类型收口

把 `AIProviderProtocol` 补全为全部运行时协议字面量，并把 `AIServiceConfig.protocol` 改成 `AIProviderProtocol`（而非 string）。factory 的 switch 用 `satisfies Record<AIProviderProtocol, ...>` 强制穷尽。新增协议时编译器强制三处同步。

工作量：**S**。

### 3.7 P2 批量

- P2-1：删除 baseUrl 推断兜底，无 protocol 一律抛"请重新配置 provider"（数据迁移确保存量 config 都有 protocol）。
- P2-2：seed 哈希提到 `lib/seed.ts` 单点 `characterIdToSeed()`，两处共享。
- P2-3：把未启用的三闭环 + observer 移到 `agents/experimental/` 或加 feature flag 注释，明确"采数据中"，避免误读为完整能力。
- P2-4：openai-compatible 两段错误分类合并为一个 `classifyImageHttpError()`。
- P2-5：从 provider 响应读真实 `usage.total_tokens`（OpenAI/Claude 都返回），facade 透传，替换 `length/4`。

---

## 4. 行业标杆对标

| 维度          | 本项目现状                                                                            | CapCut/剪映 · Runway · Pika 同类能力                                                                                          | 差距                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Provider 抽象 | 四接口门面 + 能力表，设计正确但被测试路由/vision 路径多处绕过                         | Runway/Pika 单 provider 无需抽象；多模型平台（如 fal、Replicate）走声明式 model registry + JSON schema 描述 capability        | 应把 capability 表升级为**声明式 registry**（含 probe/cost/limits），新 provider 纯数据注册零代码                                     |
| 多模态 LLM    | string-only，vision 靠手写 fetch                                                      | 一线 agent 框架（LangChain/AI SDK/LlamaIndex）content 均为 parts 数组                                                         | 落后一代，P1-1 必补                                                                                                                   |
| 角色一致性    | strategy-resolver + face-validator/observer 双轨，FaceID 能力表全 false（预留未实装） | 剪映/Pika 用专属 character/consistency model（Runway Gen-4 References、Pika Scene Ingredients、Kling Elements）做原生身份锁定 | 当前靠 prompt 锚定 + 参考图 edits，无真正 FaceID/IP-Adapter；能力表已留 `supportsFaceId` 插槽但无 provider 实装                       |
| 异步任务      | 视频生成**同步阻塞**（brief 已注明），facade 仅超时不退款                             | Runway/Pika/Kling 全异步 task + webhook/poll，前端轮询进度                                                                    | 架构缺失：应把 generateVideo 改为 submit→poll（`poll.ts` 已有 `pollUntilDone` 基础设施，runway/fal 已用，proxy-unified/同步路径未用） |
| Agent 编排    | 自研 7 步 plan-execute + runClosedLoop（设计不俗）                                    | 商业产品多为固定流水线；开源侧 ComfyUI 节点图 / LangGraph 状态机                                                              | runClosedLoop 抽象质量接近 LangGraph 的 evaluator-optimizer，是亮点；但 engine 与 DB 耦合、三闭环半成品拉低成熟度                     |
| 成本计量      | `length/4` 粗估，硬编码 COSTS 常量                                                    | 平台按真实 token/秒级用量精确计费                                                                                             | 需读真实 usage（P2-5）+ 把 COSTS 移到可配置表                                                                                         |

**结论**：provider 抽象内核与 runClosedLoop 已达到中上水准，真正拉开差距的是 (1) 视频异步化缺失 (2) 原生角色一致性模型未接入 (3) 多模态门面缺口。

---

## 5. 实施优先级与工作量

| 顺序 | 项                                | 级别 | 工作量 | 理由                                     |
| ---- | --------------------------------- | ---- | ------ | ---------------------------------------- |
| 1    | P0-2 删/接 sdk.ts                 | P0   | S      | 一次性消除死代码 + 循环依赖，零风险      |
| 2    | P1-4 协议类型收口                 | P1   | S      | 为后续所有 provider 改动加编译保护，先做 |
| 3    | P0-1 ProviderProbe 收编两巨型路由 | P0   | L      | 最大维护面收益；依赖 P1-4 的类型         |
| 4    | P1-1 LLMMessage 多模态            | P1   | M      | 解锁 vision 走门面，回收重复             |
| 5    | P1-2 图像管线统一                 | P1   | M      | 行为一致性 + 缓存全覆盖                  |
| 6    | P1-3 engine 抽数据层              | P1   | L      | 可测性，体量大放后                       |
| 7    | P2-1~P2-5                         | P2   | S×4+M  | 随手清理，搭车前面改动                   |

**P0 数量：2**（P0-1 巨型测试路由三重重复、P0-2 sdk.ts 死代码+循环依赖）。

建议批次：先做 1-2（S，半天清债 + 加护栏），再投入 3（L，最大单项收益），4-5 中等收益快跑，6 单独排期。
