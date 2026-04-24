/**
 * Agent I/O Zod Schemas（Stage 3.4）
 *
 * 目的：给 workflow 节点间传递的数据加"运行时强校验"。TypeScript 的
 * `as` / `JSON.parse` 下游不会报错；Zod 能在节点边界把错误提早截获，
 * 并在 workflow persistence 反序列化时自动恢复类型。
 *
 * 设计：
 * - 不替换现有 `types.ts` 的 interface —— 它们作为 `z.infer<typeof Schema>` 的显式对齐版本
 * - 每个 Agent 暴露 Input/Output schema，供 state-machine / executor 校验
 * - 复用现有 script-parser-agent 内的 SceneScriptSchema 定义，避免重复
 */

import { z } from "zod";

// ============ 基础原语 ============

const ShotTypeSchema = z.string(); // 允许自定义字符串；UI 层枚举
const EmotionSchema = z.string();

// ============ ScriptArtifact ============

export const SceneScriptZ = z.object({
  id: z.number(),
  shotType: ShotTypeSchema,
  description: z.string().min(10),
  characters: z.array(z.string()),
  dialogue: z.string().nullable(),
  narration: z.string().nullable(),
  emotion: EmotionSchema,
  duration: z.number().min(1).max(30),
  // Stage 1.8：可选的镜头语言字段
  cameraAngle: z.string().optional(),
  lighting: z.string().optional(),
  composition: z.string().optional(),
  colorPalette: z.string().optional(),
});

export const ScriptArtifactZ = z.object({
  title: z.string().min(1),
  scenes: z.array(SceneScriptZ).min(1),
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(5),
      })
    )
    .min(1),
  segments: z.number().optional(),
});

export const ScriptParserInputZ = z.object({
  text: z.string().min(1),
});

// ============ CharacterBible ============

export const AppearanceZ = z.object({
  gender: z.string(),
  age: z.string(),
  hairStyle: z.string(),
  hairColor: z.string(),
  faceShape: z.string(),
  eyeColor: z.string(),
  bodyType: z.string(),
  skinTone: z.string(),
  height: z.string(),
  clothing: z.string(),
  accessories: z.string(),
});

export const VoiceProfileZ = z.object({
  gender: z.string(),
  age: z.string(),
  tone: z.string(),
});

export const CharacterBibleEntryZ = z.object({
  name: z.string().min(1),
  description: z.string().min(5),
  canonicalPrompt: z.string().min(10),
  appearance: AppearanceZ,
  voiceProfile: VoiceProfileZ,
  appearances: z.array(z.number()),
});

export const CharacterBibleZ = z.object({
  characters: z.array(CharacterBibleEntryZ).min(1),
});

export const CharacterBibleInputZ = z.object({
  script: ScriptArtifactZ,
  existingCharacters: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().nullable().optional(),
        referenceImages: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

// ============ Storyboard ============

export const SceneArtifactZ = z.object({
  id: z.number(),
  order: z.number(),
  shotType: ShotTypeSchema,
  description: z.string().min(10),
  imagePrompt: z.string().min(20),
  characters: z.array(z.string()),
  dialogue: z.string().nullable(),
  narration: z.string().nullable(),
  emotion: EmotionSchema,
  duration: z.number().min(1).max(30),
  cameraMovement: z.string().nullable().optional(),
  transition: z.string().nullable().optional(),
});

export const StoryboardArtifactZ = z.object({
  scenes: z.array(SceneArtifactZ).min(1),
});

export const StoryboardInputZ = z.object({
  script: ScriptArtifactZ,
  characterBible: CharacterBibleZ,
});

// ============ Image ============

export const ImageArtifactZ = z.object({
  sceneId: z.number(),
  imageUrl: z.string().url(),
  strategy: z.string(),
  attempts: z.number(),
  quality: z
    .object({
      score: z.number(),
      reasons: z.array(z.string()).optional(),
    })
    .optional(),
});

export const ImageGenerationInputZ = z.object({
  scene: SceneArtifactZ,
  characterBible: CharacterBibleZ,
  existingReferenceImages: z.record(z.string(), z.string()).optional(),
});

// ============ 便捷校验函数 ============

/**
 * 在 agent 边界校验输出；失败时打印详细错误并抛出。
 * 使用示例：
 *   const parsed = validateAgentOutput(ScriptArtifactZ, llmRaw, "script_parser");
 */
export function validateAgentOutput<T>(
  schema: z.ZodType<T>,
  data: unknown,
  agentName: string
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `- ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`[${agentName}] output schema validation failed:\n${issues}`);
}

/** 非破坏性校验：失败返回 null，供降级路径使用 */
export function tryValidateAgentOutput<T>(
  schema: z.ZodType<T>,
  data: unknown
): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

// ============ Inferred types ============
// 导出 infer 类型；建议新代码直接用这些类型（与 schema 同源），避免 interface 漂移。

export type InferredScriptArtifact = z.infer<typeof ScriptArtifactZ>;
export type InferredCharacterBible = z.infer<typeof CharacterBibleZ>;
export type InferredStoryboardArtifact = z.infer<typeof StoryboardArtifactZ>;
export type InferredImageArtifact = z.infer<typeof ImageArtifactZ>;
