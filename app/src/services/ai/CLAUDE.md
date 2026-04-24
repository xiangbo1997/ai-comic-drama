[根目录](../../../../../ARCHITECTURE.md) > [app](../../../../CLAUDE.md) > [src](../../../CLAUDE.md) > [services](../CLAUDE.md) > **ai**

<!-- 由 /ccg:init 生成 | 时间：2026-04-23 17:34:08 +08:00 | 执行者：Claude Code -->

# services/ai — 多协议 AI 统一门面

## 模块职责

**所有外部 AI 调用的唯一入口**。对上暴露四个语义函数（LLM / Image / Video / TTS），对下按 `protocol` 路由到对应 Provider 实现。保留与旧 `services/ai.ts` 完全兼容的 API 签名。

## 入口与启动

| 文件 | 作用 |
|------|------|
| `index.ts` | 对外 API：`chatCompletion / generateImage / generateVideo / synthesizeSpeech / estimateCost / COSTS` |
| `provider-factory.ts` | 按 `protocol` 路由到对应 Provider；含 `IMAGE_PROVIDER_CAPABILITIES` 能力表 |
| `types.ts` | Provider 接口（`LLMProvider / ImageProvider / VideoProvider / TTSProvider / ImageProviderCapability`） |
| `providers/*` | 各具体 Provider 实现 |

## 对外接口（公共 API）

```ts
// LLM
chatCompletion(messages: LLMMessage[], options?: LLMOptions): Promise<string>

// 图像
generateImage(options: ImageGenerationOptions): Promise<string>  // 返回图像 URL

// 视频
generateVideo(options: VideoGenerationOptions): Promise<string>  // 返回视频 URL

// TTS
synthesizeSpeech(options: TTSOptions): Promise<Buffer>           // 返回音频 Buffer

// 成本
estimateCost({ tokens?, images?, imagesWithRef?, video5s?, video10s?, ttsChars? })
  : { usd: number; cny: number }
```

所有 `options.config` 为 `AIServiceConfig`，由 `lib/ai-config` 从用户 DB 配置解密获得。

## 协议路由规则

### `getLLMProvider(protocol)`

| protocol | Provider |
|----------|----------|
| `claude` | `claudeLLM` |
| `gemini` | `geminiLLM` |
| 其他（`openai` / `grok` / `deepseek` / `siliconflow` …） | `openaiCompatibleLLM`（OpenAI 兼容） |

### `getImageProvider(protocol, baseUrl?)`

| protocol | Provider |
|----------|----------|
| `proxy-unified` | `proxyUnifiedImage` |
| `grok` | `grokImage` |
| `siliconflow` | `siliconflowImage` |
| `fal` | `falImage` |
| `replicate` | `replicateImage` |
| `openai` | `openaiCompatibleImage` |
| （兜底：按 baseUrl 推断） | `x.ai → grok` / `siliconflow → siliconflow` / `fal.run|fal.ai → fal` / `replicate → replicate` |

### `getVideoProvider(protocol, baseUrl?)`

| protocol | Provider |
|----------|----------|
| `runway` | `runwayVideo` |
| `fal` | `falVideo` |
| `proxy-unified` / `openai` | `proxyUnifiedVideo` |
| 兜底 | `runwayVideo` |

### `getTTSProvider(protocol, baseUrl?)`

| protocol | Provider |
|----------|----------|
| `volcengine` | `volcengineTTS` |
| `elevenlabs` | `elevenlabsTTS` |
| `openai` | `openaiCompatibleTTS` |
| 兜底 | `volcengineTTS` |

## 能力表：`IMAGE_PROVIDER_CAPABILITIES`

每个图像 Provider 声明：`supportsReferenceImage / supportsMultipleReferences / supportsFaceId / supportsInpainting / maxReferenceImages`。
`services/generation/strategy-resolver` 会根据能力表与请求参数决策最佳策略。

## 关键降级策略

```ts
// services/ai/index.ts#generateImage
if (config) {
  try {
    return await provider.generateImage(options, config);
  } catch (error) {
    if (!shouldFallbackToEnvReplicate(config)) throw error;
    // 若环境变量中配了 REPLICATE_API_TOKEN 且当前通道非 replicate，自动 fallback
    log.warn("Configured image provider failed, falling back to env Replicate", { ... });
  }
}
return generateImageWithEnvReplicate(prompt, referenceImage, aspectRatio);
```

## 成本常量（`COSTS`）

| 项 | 单价（USD） |
|----|------------|
| `llm` | 0.00001 / token（折算 CNY） |
| `image` | 0.03 |
| `imageWithRef` | 0.03 |
| `video5s` | 0.25 |
| `video10s` | 0.50 |
| `tts` | 0.002（按字符折 CNY） |

## 关键依赖

- `@/types` —— `AIServiceConfig / LLMMessage / LLMOptions / ImageGenerationOptions / VideoGenerationOptions / TTSOptions`
- `@/lib/logger`
- 各 provider 的 SDK：`@fal-ai/client`、`replicate` 等（按需动态导入以减少冷启动）

## 扩展点

**新增一个 LLM Provider（假设 `xxx`）**：

1. `providers/xxx.ts` 导出 `xxxLLM: LLMProvider`
2. `provider-factory.ts#getLLMProvider` 的 switch 增加 `case "xxx"`
3. （如有新协议）在类型系统 `@/types/ai` 的 `AIProviderProtocol` 中补一个字面量
4. 如有参考图/能力差异，更新 `IMAGE_PROVIDER_CAPABILITIES`

## 常见坑

- **环境变量兼容**：`chatCompletion` 在无 `config` 时会读 `DEEPSEEK_BASE_URL` + `DEEPSEEK_API_KEY` 并走 OpenAI 兼容协议；未设任何环境变量或 config 会抛 "未配置 LLM 服务"。
- **baseUrl 末尾的 `/v1`**：`chatCompletion` 的环境变量分支显式拼 `${baseUrl}/v1`；用户 config 要避免重复拼接。
- **协议 vs BaseURL**：以 `config.protocol` 为准；`baseUrl` 仅作为旧配置 fallback（即将淘汰）。

## 相关文件清单

- `index.ts`
- `provider-factory.ts`
- `types.ts`
- `providers/openai-compatible.*`
- `providers/claude.ts` / `gemini.ts` / `grok.ts` / `siliconflow.ts` / `fal.ts` / `replicate.ts` / `runway.ts` / `proxy-unified.ts`
- `providers/tts/volcengine.ts` / `elevenlabs.ts` / `openai-compatible.ts`

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-04-23 | 首次生成（/ccg:init 自适应架构师） |
