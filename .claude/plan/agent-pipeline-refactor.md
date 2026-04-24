# 实施计划：AI 漫剧 Agent Pipeline 重构

## 任务类型
- [x] 前端 (→ Claude/Gemini)
- [x] 后端 (→ Codex/Claude)
- [x] 全栈 (→ 并行)

---

## 一、背景与问题分析

### 现状

当前系统采用"提示词堆砌 + 线性调用"模式：

| 环节 | 现状 | 问题 |
|------|------|------|
| 剧本解析 | `script.ts` 单次 LLM 调用 + regex 提取 JSON | 脆弱，无验证/重试，无法处理复杂文本 |
| 图像提示词 | `use-generation-actions.ts` 字符串拼接 | 无语义理解，角色一致性差 |
| 批量生成 | 前端 `for...of` 串行循环 | 工作流逻辑在 UI 层，不可复用 |
| 质量控制 | `face-validator.ts` 是 stub | 无反馈循环，生成质量靠运气 |
| 图像编排 | `image-orchestrator.ts` 已有策略选择 | 准 Agent 能力，但未与其他步骤串联 |

### 已有资产（可复用）

- `services/ai/` — 多 provider 统一调用层 ✅
- `image-orchestrator.ts` + `strategy-resolver.ts` — 图像策略选择 ✅
- `queue.ts` — BullMQ/InMemory 双模式队列 ✅
- `GenerationTask` + `GenerationAttempt` — 任务追踪 schema ✅

---

## 二、技术方案：Hybrid Plan-and-Execute

### 模式选型依据

| 模式 | 适用性评估 | 结论 |
|------|-----------|------|
| **ReAct** | 灵活但成本高，每步多轮 LLM，与队列不匹配 | ❌ 不作为主模式 |
| **Plan-and-Execute** | 与 7 步 DAG 天然对齐，和 BullMQ 兼容 | ✅ 主框架 |
| **Multi-Agent** | 改造过大，通信成本高 | ⚠️ 局部采用 |
| **Reflection** | 质量关卡必需 | ✅ 关键节点采用 |
| **Hybrid** | 结合 P&E 的稳定性 + Reflection 的质量 + 专职 Agent 的专业性 | ✅✅ 最终选择 |

### 核心设计：5 个专职 Agent + 1 个 Workflow Planner + 1 个 Observer

```
                    ┌─────────────────────┐
                    │  WorkflowPlanner     │  生成执行计划 DAG
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
    ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
    │ScriptParser  │  │CharacterBible│  │Storyboard    │
    │Agent         │→ │Agent         │→ │Agent         │  串行（依赖关系）
    └─────────────┘  └─────────────┘  └──────┬───────┘
                                              │
                                    ┌─────────┴─────────┐
                                    ▼                   ▼
                          ┌─────────────┐     ┌──────────────┐
                          │Image         │     │Observer      │
                          │Consistency   │ ←──→│Agent         │  Reflection 循环
                          │Agent         │     │(质量评审)     │
                          └──────┬──────┘     └──────────────┘
                                 │
                      ┌──────────┼──────────┐
                      ▼                     ▼
               ┌────────────┐        ┌────────────┐
               │Video Gen   │        │TTS Gen     │  并行（已有 provider）
               │(existing)  │        │(existing)  │
               └─────┬──────┘        └─────┬──────┘
                     └──────────┬──────────┘
                                ▼
                      ┌─────────────────┐
                      │ Export Executor  │
                      └─────────────────┘
```

### Agent 角色定义

| Agent | 输入 | 输出 | 核心能力 |
|-------|------|------|---------|
| **WorkflowPlanner** | 用户文本 + 配置 | 执行 DAG | 分析文本复杂度，决定步骤和并发策略 |
| **ScriptParserAgent** | 原始文本 | `ScriptArtifact` (结构化分镜) | 多轮解析 + 自验证 JSON schema |
| **CharacterBibleAgent** | ScriptArtifact | `CharacterBible` (角色圣经) | 提取/补全外貌描述，生成 canonical prompt |
| **StoryboardAgent** | Script + CharacterBible | `SceneArtifact[]` | 补全镜头语言、构图、时长、资产依赖 |
| **ImageConsistencyAgent** | Scene + CharacterBible | 审核通过的图像 | 策略选择 + Reflection 循环 (最多 2 轮) |
| **ObserverAgent** | 任意中间产出 | 评分 + 通过/拒绝 | 独立评审，不生成内容 |

---

## 三、实施步骤

### Phase 1：Agent 基础框架 (预计 3-4 天)

#### Step 1.1：定义 Agent 接口和 Workflow 类型

**文件**：`app/src/services/agents/types.ts` (新建)

```typescript
// Agent 基础接口
interface Agent<TInput, TOutput> {
  name: string;
  run(input: TInput, context: WorkflowContext): Promise<AgentResult<TOutput>>;
}

// Agent 执行结果
interface AgentResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  reasoning?: string;     // Agent 的推理过程（可展示给用户）
  attempts: number;
  tokensUsed: number;
}

// Workflow 上下文
interface WorkflowContext {
  workflowRunId: string;
  projectId: string;
  userId: string;
  config: WorkflowConfig;
  artifacts: ArtifactStore;
  logger: WorkflowLogger;
}

// Artifact 类型
type ArtifactType = 'script' | 'character_bible' | 'storyboard' | 'scene_image' | 'scene_video' | 'scene_audio' | 'export';

interface Artifact<T = unknown> {
  id: string;
  type: ArtifactType;
  version: number;
  data: T;
  createdBy: string;        // agent name
  quality?: QualityScore;
  createdAt: Date;
}

// 质量评分
interface QualityScore {
  overall: number;          // 0-100
  dimensions: Record<string, number>;
  pass: boolean;
  feedback?: string;
}

// Workflow 步骤
type WorkflowStep =
  | 'parse_script'
  | 'build_character_bible'
  | 'build_storyboard'
  | 'generate_images'
  | 'review_images'
  | 'generate_videos'
  | 'synthesize_voice'
  | 'export_project';

interface WorkflowStepRun {
  step: WorkflowStep;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  agentName: string;
  input?: unknown;
  output?: unknown;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}
```

**产物**：Agent 类型系统、Workflow 状态定义

#### Step 1.2：实现 Workflow Engine

**文件**：`app/src/services/agents/workflow-engine.ts` (新建)

核心职责：
- 管理 workflow run 生命周期
- 按 DAG 顺序执行 steps
- 处理 fan-out（场景并行）和 fan-in（汇总）
- 持久化每步状态到 DB（复用 `GenerationTask`）
- 支持断点续跑

```typescript
class WorkflowEngine {
  async startWorkflow(projectId: string, inputText: string, config: WorkflowConfig): Promise<string>;
  async resumeWorkflow(workflowRunId: string): Promise<void>;
  async getWorkflowStatus(workflowRunId: string): Promise<WorkflowStatus>;

  private async executeStep(step: WorkflowStep, agent: Agent, input: unknown, ctx: WorkflowContext): Promise<void>;
  private async fanOutScenes(scenes: SceneArtifact[], handler: (scene) => Promise<void>): Promise<void>;
}
```

**产物**：可复用的 workflow 执行引擎

#### Step 1.3：数据库 Schema 扩展

**文件**：`app/prisma/schema.prisma` (修改)

新增模型（最小化扩展，复用已有模型）：

```prisma
model WorkflowRun {
  id          String   @id @default(cuid())
  projectId   String
  userId      String
  status      WorkflowStatus @default(PENDING)
  currentStep String?
  config      Json
  artifacts   Json     @default("{}")  // 存储 artifact 引用
  error       String?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project     Project  @relation(fields: [projectId], references: [id])
  user        User     @relation(fields: [userId], references: [id])
  steps       WorkflowStepRun[]
}

model WorkflowStepRun {
  id            String   @id @default(cuid())
  workflowRunId String
  step          String
  agentName     String
  status        String   @default("pending")
  input         Json?
  output        Json?
  reasoning     String?  // Agent 推理过程
  attempts      Int      @default(0)
  tokensUsed    Int      @default(0)
  error         String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime @default(now())

  workflowRun   WorkflowRun @relation(fields: [workflowRunId], references: [id])
}

enum WorkflowStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  PAUSED
}
```

**产物**：Workflow 持久化 schema

### Phase 2：核心 Agent 实现 (预计 5-6 天)

#### Step 2.1：ScriptParserAgent — 多轮剧本解析

**文件**：`app/src/services/agents/script-parser-agent.ts` (新建)

替换当前 `script.ts` 的单次调用，引入：
- **结构化 Prompt 模板**：替换硬编码字符串
- **JSON Schema 验证**：用 Zod 验证 LLM 输出
- **自修复循环**：解析失败时提供错误反馈让 LLM 重新生成（最多 2 轮）
- **文本分段处理**：超长文本分段解析后合并

```typescript
class ScriptParserAgent implements Agent<ScriptParserInput, ScriptArtifact> {
  name = 'script_parser';

  async run(input: ScriptParserInput, ctx: WorkflowContext): Promise<AgentResult<ScriptArtifact>> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const messages = this.buildMessages(input.text, attempt > 1 ? lastError : undefined);
      const response = await chatCompletion(messages, { config: ctx.config.llm });

      const parseResult = ScriptArtifactSchema.safeParse(extractJSON(response));
      if (parseResult.success) {
        return { success: true, data: parseResult.data, attempts: attempt };
      }
      lastError = parseResult.error;  // 反馈给下一轮
    }
    throw new Error('Script parsing failed after 3 attempts');
  }
}
```

**产物**：可自修复的剧本解析 Agent

#### Step 2.2：CharacterBibleAgent — 角色圣经生成

**文件**：`app/src/services/agents/character-bible-agent.ts` (新建)

核心创新 —— 为每个角色生成 **canonical image prompt**，确保跨场景一致性：

```typescript
interface CharacterBible {
  characters: Array<{
    name: string;
    description: string;
    canonicalPrompt: string;      // 标准化的图像生成提示词
    voiceProfile: {
      gender: string;
      age: string;
      tone: string;
    };
    appearances: string[];         // 出场场景 ID
  }>;
}
```

这是解决**角色一致性**问题的关键 —— 当前系统每次生成图像时独立构造 prompt，导致同一角色在不同场景中外貌不一致。

**产物**：角色圣经 + canonical prompt

#### Step 2.3：StoryboardAgent — 分镜补全

**文件**：`app/src/services/agents/storyboard-agent.ts` (新建)

将 ScriptParserAgent 的粗粒度场景，补全为可执行的分镜：
- 补全镜头语言（景别、角度、运镜）
- 生成详细的画面构图描述
- 标注资产依赖（哪些角色、哪些道具）
- 评估时长和转场

**产物**：完整的可执行分镜表

#### Step 2.4：ImageConsistencyAgent — 图像一致性 Agent

**文件**：`app/src/services/agents/image-consistency-agent.ts` (新建)

升级现有 `image-orchestrator.ts`，增加 Reflection 循环：

```typescript
class ImageConsistencyAgent implements Agent<ImageInput, ImageArtifact> {
  async run(input: ImageInput, ctx: WorkflowContext): Promise<AgentResult<ImageArtifact>> {
    // 1. 策略选择（复用 strategy-resolver）
    const strategy = await this.decideStrategy(input);

    // 2. 构造增强 prompt（使用 CharacterBible 的 canonicalPrompt）
    const prompt = this.buildEnhancedPrompt(input.scene, input.characterBible);

    // 3. 生成 + 评审循环
    for (let round = 1; round <= 3; round++) {
      const image = await generateImage(prompt, { config: ctx.config.image });

      // 4. Observer 评审
      const verdict = await this.observer.evaluate(image, input.scene, input.characterBible);

      if (verdict.pass) return { success: true, data: { imageUrl: image, quality: verdict } };

      // 5. Reflection：根据反馈调整 prompt
      prompt = await this.reflectAndRefine(prompt, verdict.feedback);
    }

    // 降级：返回最佳尝试
    return { success: true, data: bestAttempt, reasoning: 'Used best attempt after reflection exhausted' };
  }
}
```

**产物**：带 Reflection 的图像生成 Agent

#### Step 2.5：ObserverAgent — 独立质量评审

**文件**：`app/src/services/agents/observer-agent.ts` (新建)

独立的评审 Agent，不生成内容，只做评判：
- 评审图像与场景描述的匹配度
- 检查角色外貌一致性（与 CharacterBible 对比）
- 评估构图和画面质量
- 输出结构化评分 + 改进建议

使用轻量模型（如 haiku/flash）降低成本。

**产物**：通用质量评审 Agent

### Phase 3：Workflow API 与前端集成 (预计 4-5 天)

#### Step 3.1：Workflow API Routes

**文件**：`app/src/app/api/workflow/route.ts` (新建)

```
POST /api/workflow          — 启动新 workflow
GET  /api/workflow/[id]     — 获取 workflow 状态
POST /api/workflow/[id]/resume — 断点续跑
DELETE /api/workflow/[id]   — 取消 workflow
```

#### Step 3.2：Workflow 实时状态推送

**方案**：Server-Sent Events (SSE)

**文件**：`app/src/app/api/workflow/[id]/events/route.ts` (新建)

前端通过 SSE 实时获取 workflow 状态更新：
- Agent 开始/完成某步骤
- Agent 的推理过程（"正在分析角色关系..."）
- Reflection 循环状态（"图像质量不达标，正在优化提示词..."）
- 总体进度百分比

#### Step 3.3：前端 Workflow 控制面板

**文件**：`app/src/components/workflow/` (新建目录)

- `WorkflowPanel.tsx` — 主控制面板
- `WorkflowTimeline.tsx` — 步骤时间线（显示每步状态）
- `AgentThinking.tsx` — Agent 推理过程展示
- `QualityReview.tsx` — Observer 评审结果展示（通过/拒绝 + 改进建议）

**UX 设计原则**：
1. **渐进式自动化**：用户可选择"全自动"或"逐步确认"模式
2. **透明决策**：展示 Agent 的推理过程，而非黑箱
3. **人机协作**：用户可在任意步骤介入修改，Agent 从修改点继续
4. **降级兜底**：Agent 失败时回退到手动模式

#### Step 3.4：编辑器集成

**文件**：`app/src/app/(dashboard)/editor/[id]/page.tsx` (修改)

- 新增"一键生成"按钮，启动完整 workflow
- 保留原有单步操作作为手动模式
- 将 `use-generation-actions.ts` 中的批量逻辑迁移到后端 workflow

### Phase 4：Prompt 工程升级 (预计 2-3 天)

#### Step 4.1：结构化 Prompt 模板系统

**文件**：`app/src/lib/prompts/` (扩展)

- `agent-prompts/script-parser.ts` — 多轮解析 prompt
- `agent-prompts/character-bible.ts` — 角色圣经 prompt
- `agent-prompts/storyboard.ts` — 分镜补全 prompt
- `agent-prompts/observer.ts` — 质量评审 prompt
- `agent-prompts/reflection.ts` — Reflection prompt

每个 prompt 模板支持：
- Few-shot 示例
- 上下文注入（角色信息、前序产出）
- 输出 schema 约束（JSON Schema / Zod）

#### Step 4.2：Prompt 版本管理

**方案**：将 prompt 模板与版本号关联，支持 A/B 测试不同 prompt 策略

### Phase 5：优化与可观测性 (预计 2-3 天)

#### Step 5.1：成本优化

- **模型分层**：规划/评审用小模型（haiku/flash），内容生成用强模型（sonnet/deepseek）
- **缓存机制**：相同输入的 Agent 结果缓存
- **并发控制**：图像/视频/TTS 场景级并行，workflow 级串行

#### Step 5.2：可观测性

- 每个 Agent 调用记录到 `WorkflowStepRun`
- Token 消耗追踪
- 质量评分趋势
- 失败率和重试统计

---

## 四、关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/src/services/agents/types.ts` | 新建 | Agent 接口、Workflow 类型定义 |
| `app/src/services/agents/workflow-engine.ts` | 新建 | Workflow 执行引擎 |
| `app/src/services/agents/script-parser-agent.ts` | 新建 | 多轮剧本解析 Agent |
| `app/src/services/agents/character-bible-agent.ts` | 新建 | 角色圣经 Agent |
| `app/src/services/agents/storyboard-agent.ts` | 新建 | 分镜补全 Agent |
| `app/src/services/agents/image-consistency-agent.ts` | 新建 | 图像一致性 Agent（含 Reflection） |
| `app/src/services/agents/observer-agent.ts` | 新建 | 独立质量评审 Agent |
| `app/src/services/agents/index.ts` | 新建 | 统一导出 |
| `app/src/lib/prompts/agent-prompts/*.ts` | 新建 | 结构化 Agent prompt 模板 |
| `app/prisma/schema.prisma` | 修改 | 新增 WorkflowRun、WorkflowStepRun |
| `app/src/app/api/workflow/route.ts` | 新建 | Workflow CRUD API |
| `app/src/app/api/workflow/[id]/route.ts` | 新建 | 单个 Workflow 状态 |
| `app/src/app/api/workflow/[id]/events/route.ts` | 新建 | SSE 实时推送 |
| `app/src/components/workflow/*.tsx` | 新建 | 前端 Workflow 组件 |
| `app/src/app/(dashboard)/editor/[id]/page.tsx` | 修改 | 集成 Workflow 面板 |
| `app/src/app/(dashboard)/editor/[id]/hooks/use-generation-actions.ts` | 修改 | 批量逻辑迁移到后端 |
| `app/src/services/script.ts` | 修改 | 兼容层，内部调用 ScriptParserAgent |

---

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| LLM 成本增加（多轮调用） | 中 | 模型分层 + 缓存 + 限制 Reflection 轮次 |
| Reflection 循环无限递归 | 高 | 硬性限制最多 2-3 轮，超限降级 |
| 角色一致性仍不够好 | 中 | CharacterBible 的 canonical prompt 是核心创新，需迭代优化 |
| 用户等待时间变长 | 中 | SSE 实时反馈 + 进度条 + 后台执行 |
| 与现有 API 不兼容 | 低 | 保留原有单步 API，Workflow 是新增路径 |

---

## 六、验收标准

1. ✅ 完整 workflow 可从文本到导出自动执行
2. ✅ ScriptParser 解析成功率 > 95%（含自修复）
3. ✅ 图像角色一致性明显提升（通过 CharacterBible）
4. ✅ Observer 质量评审可拦截低质量产出
5. ✅ 前端实时展示 Agent 工作状态
6. ✅ 保持与现有手动模式的兼容
7. ✅ 单次 Workflow 额外 LLM 成本 < 原始成本的 30%

---

## 七、参考资料

- [StoryAgent: Multi-Agent Collaboration for Storytelling Video](https://arxiv.org/html/2411.04925v2)
- [5 AI Agent Design Patterns to Master by 2026](https://explore.n1n.ai/blog/5-ai-agent-design-patterns-master-2026-2026-03-21)
- [Choosing the Right Multi-Agent Architecture - LangChain Blog](https://blog.langchain.com/choosing-the-right-multi-agent-architecture/)
- [Agent Architectures: ReAct, Self-Ask, Plan-and-Execute](https://apxml.com/courses/langchain-production-llm/chapter-2-sophisticated-agents-tools/agent-architectures)
- [Agentic Design Patterns: The 2026 Guide](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/)

---

## SESSION_ID（供 /ccg:execute 使用）
- CODEX_SESSION: 019d22ff-d8fc-7080-bab0-9c50b37f8914
- GEMINI_SESSION: N/A (rate limited)
