[根目录](../../../../../ARCHITECTURE.md) > [app](../../../../CLAUDE.md) > [src](../../../CLAUDE.md) > [services](../CLAUDE.md) > **generation**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# services/generation — 图像生成编排

## 模块职责

在 `services/ai.generateImage` 之上加一层编排：**根据角色/场景/Provider 能力选择生成策略 → 调用底层生成 → 人脸一致性验证 → 失败重试（最多 N 轮）**。

## 入口与启动

| 文件 | 作用 |
|------|------|
| `index.ts` | Barrel：导出 `orchestrateImageGeneration / resolveStrategy / validateFaceConsistency` 与相关类型 |
| `image-orchestrator.ts` | 核心编排循环 |
| `strategy-resolver.ts` | 策略决策（是否用参考图 / 是否 FaceID / 增强 prompt 格式） |
| `face-validator.ts` | 生成后的人脸一致性验证（相似度阈值 + 是否需要重试） |
| `types.ts` | `OrchestratorRequest / OrchestratorResult / GenerationStrategy / ValidationResult / SceneCharacterInfo / CharacterRole / StrategyDecision` |

## 对外接口

```ts
orchestrateImageGeneration(request: OrchestratorRequest): Promise<OrchestratorResult>

interface OrchestratorRequest {
  characters: SceneCharacterInfo[];
  prompt: string;
  shotType?: string;
  aspectRatio?: string;
  style?: string;
  imageConfig?: AIServiceConfig;
  maxRetries?: number;   // 默认 3
}

interface OrchestratorResult {
  imageUrl: string;
  strategy: GenerationStrategy;
  attemptCount: number;
  validation?: ValidationResult;
}
```

## 编排循环（核心逻辑）

```ts
const decision = resolveStrategy(characters, prompt, imageConfig, shotType);

for (let attempt = 1; attempt <= maxRetries; attempt++) {
  imageUrl = await generateImage({
    prompt: decision.enhancedPrompt,
    referenceImage: decision.referenceImageUrl,
    aspectRatio, style, config: imageConfig,
  });
  validation = await validateFaceConsistency(imageUrl, characters, shotType);
  if (validation.passed || !validation.shouldRetry) break;
}

return { imageUrl, strategy, attemptCount, validation };
```

- `MAX_RETRIES` 默认 3
- `shouldRetry` 为 `false` 时（例如非主角场景、远景），**不重试直接返回**

## 策略种类（`GenerationStrategy`）

| 策略 | 含义 | 触发条件 |
|------|------|---------|
| `prompt_only` | 纯文本 prompt | 无角色或远景 |
| `reference_edit` | 带参考图编辑 | 主要角色有 canonical 参考资产 + Provider `supportsReferenceImage` |
| `face_id` | FaceID 注入（预留） | Provider `supportsFaceId`（当前能力表均 false） |

## 关键依赖

- `@/services/ai` —— `generateImage`
- 策略使用的 `CharacterReferenceAsset` / `CharacterFaceEmbedding`（Prisma 模型）

## 扩展点

**启用 FaceID 策略**：

1. 在 `provider-factory.ts#IMAGE_PROVIDER_CAPABILITIES` 把目标 provider 的 `supportsFaceId` 改为 true
2. `strategy-resolver.ts` 补充优先选 `face_id` 的分支
3. `face-validator.ts` 改阈值策略或增加多轮放宽
4. 若依赖 `CharacterFaceEmbedding`，保证写入流已覆盖

## 常见坑

- **maxRetries 与成本**：重试意味着多次扣积分风险；当前实现**积分扣减在 API 层**，编排器本身不扣费——所以验证未通过的图也消耗了外部 API 配额但不一定扣用户积分，要在业务侧评估。
- **strategy.enhancedPrompt**：由 `resolveStrategy` 生成；若上层已用 `lib/prompt-builder.buildEnhancedPrompt`，要避免重复增强。
- **validation.shouldRetry**：远景/背景/群像应返回 false 以避免无限重试。

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师） |
