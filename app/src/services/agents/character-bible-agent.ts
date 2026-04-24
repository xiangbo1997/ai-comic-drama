/**
 * CharacterBibleAgent — 角色圣经生成
 * 为每个角色生成 canonical prompt，确保跨场景一致性
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import {
  CHARACTER_BIBLE_SYSTEM,
  buildCharacterBiblePrompt,
} from "@/lib/prompts/agent-prompts";
import { createLogger } from "@/lib/logger";
import { resolveLLMParams } from "./llm-params";
import type {
  Agent,
  AgentResult,
  CharacterBibleInput,
  CharacterBible,
  WorkflowContext,
} from "./types";

const log = createLogger("agent:character-bible");

const AppearanceSchema = z.object({
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

const VoiceProfileSchema = z.object({
  gender: z.string(),
  age: z.string(),
  tone: z.string(),
});

const CharacterBibleEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(5),
  canonicalPrompt: z.string().min(10),
  appearance: AppearanceSchema,
  voiceProfile: VoiceProfileSchema,
  appearances: z.array(z.number()),
});

const CharacterBibleSchema = z.object({
  characters: z.array(CharacterBibleEntrySchema).min(1),
});

const MAX_ATTEMPTS = 2;

function extractJSON(text: string): unknown {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1].trim());
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No JSON found in response");
}

export class CharacterBibleAgent implements Agent<
  CharacterBibleInput,
  CharacterBible
> {
  readonly name = "character_bible";

  async run(
    input: CharacterBibleInput,
    ctx: WorkflowContext
  ): Promise<AgentResult<CharacterBible>> {
    let totalTokens = 0;

    ctx.emit({
      type: "step:started",
      workflowRunId: ctx.workflowRunId,
      step: "build_character_bible",
      data: {
        message: `正在为 ${input.script.characters.length} 个角色生成角色圣经...`,
      },
      timestamp: new Date(),
    });

    const sceneContexts = input.script.scenes.map((s) => ({
      id: s.id,
      characters: s.characters,
      description: s.description,
    }));

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const mainParams = resolveLLMParams(ctx.config, {
          defaultTemperature: 0.4,
          defaultMaxTokens: 4096,
        });
        const response = await chatCompletion(
          [
            { role: "system", content: CHARACTER_BIBLE_SYSTEM },
            {
              role: "user",
              content: buildCharacterBiblePrompt(
                input.script.characters,
                sceneContexts
              ),
            },
          ],
          {
            temperature: mainParams.temperature,
            maxTokens: mainParams.maxTokens,
            config: ctx.config.llm,
          }
        );

        totalTokens += Math.ceil(response.length / 4);

        const parsed = extractJSON(response);
        const result = CharacterBibleSchema.safeParse(parsed);

        if (result.success) {
          // 合并已有角色数据（如已有参考图等）
          const bible = this.mergeWithExisting(
            result.data as CharacterBible,
            input.existingCharacters
          );

          log.info(
            `Character bible created with ${bible.characters.length} characters`
          );
          return {
            success: true,
            data: bible,
            reasoning: `生成了 ${bible.characters.length} 个角色的标准化描述和 canonical prompt`,
            attempts: attempt,
            tokensUsed: totalTokens,
          };
        }

        log.warn(`Attempt ${attempt} validation failed`);
      } catch (err) {
        log.warn(
          `Attempt ${attempt} failed: ${err instanceof Error ? err.message : "Unknown"}`
        );
      }
    }

    // Stage 1.7：主流程失败后，做一次"紧凑版 LLM 重试"——只要求短 JSON（外貌核心字段），
    // 失败再回退到 char.description 直通。这样能在大多数情况下恢复一个比空壳更可用的 bible。
    log.warn("Main bible generation failed, trying compact LLM pass");
    const compactBible = await this.tryCompactLLMPass(input, ctx);
    if (compactBible) {
      totalTokens += compactBible.tokensUsed;
      return {
        success: true,
        data: compactBible.bible,
        reasoning: "主流程失败，紧凑版 LLM 重试生成结构化外貌成功",
        attempts: MAX_ATTEMPTS + 1,
        tokensUsed: totalTokens,
      };
    }

    // 最终降级：基于原始数据构造基础 bible
    log.warn(
      "Compact LLM pass failed as well, falling back to script description"
    );
    const fallbackBible = this.buildFallbackBible(input);

    return {
      success: true,
      data: fallbackBible,
      reasoning: "LLM 与紧凑版重试均失败，回退到脚本原始角色描述",
      attempts: MAX_ATTEMPTS + 1,
      tokensUsed: totalTokens,
    };
  }

  /**
   * 紧凑版 LLM 重试：把外貌字段要求压缩成一个精简 JSON，降低解析失败率。
   * 一次请求一个角色（串行），失败立即跳过该角色用 description 兜底。
   */
  private async tryCompactLLMPass(
    input: CharacterBibleInput,
    ctx: WorkflowContext
  ): Promise<{ bible: CharacterBible; tokensUsed: number } | null> {
    if (!ctx.config.llm) return null;

    const characters: CharacterBible["characters"] = [];
    let tokens = 0;

    for (const char of input.script.characters) {
      const appearances = input.script.scenes
        .filter((s) => s.characters.includes(char.name))
        .map((s) => s.id);

      try {
        const compactPrompt = buildCompactAppearancePrompt(
          char.name,
          char.description
        );
        const compactParams = resolveLLMParams(ctx.config, {
          defaultTemperature: 0.3,
          defaultMaxTokens: 512,
        });
        const response = await chatCompletion(
          [
            {
              role: "system",
              content: "你是一个专业的角色设计师。只输出 JSON，不要任何解释。",
            },
            { role: "user", content: compactPrompt },
          ],
          {
            temperature: compactParams.temperature,
            maxTokens: compactParams.maxTokens,
            config: ctx.config.llm,
          }
        );
        tokens += Math.ceil(response.length / 4);

        const compact = safeParseCompact(response);
        if (!compact) {
          throw new Error("compact parse failed");
        }

        const descriptionParts = [
          compact.hairColor && compact.hairStyle
            ? `${compact.hairColor} ${compact.hairStyle}`
            : compact.hairStyle || compact.hairColor,
          compact.eyeColor ? `${compact.eyeColor} eyes` : null,
          compact.clothing,
          compact.accessories,
        ].filter(Boolean);

        const mergedDescription =
          descriptionParts.length > 0
            ? `${char.description}, ${descriptionParts.join(", ")}`
            : char.description;

        characters.push({
          name: char.name,
          description: mergedDescription,
          canonicalPrompt: mergedDescription,
          appearance: {
            gender: compact.gender || "unknown",
            age: compact.age || "unknown",
            hairStyle: compact.hairStyle || "unknown",
            hairColor: compact.hairColor || "unknown",
            faceShape: compact.faceShape || "unknown",
            eyeColor: compact.eyeColor || "unknown",
            bodyType: compact.bodyType || "unknown",
            skinTone: compact.skinTone || "unknown",
            height: compact.height || "unknown",
            clothing: compact.clothing || "unknown",
            accessories: compact.accessories || "none",
          },
          voiceProfile: {
            gender: compact.gender || "unknown",
            age: compact.age || "unknown",
            tone: "neutral",
          },
          appearances,
        });
      } catch (err) {
        log.warn(
          `Compact pass failed for "${char.name}", using raw description`,
          {
            error: err instanceof Error ? err.message : String(err),
          }
        );
        characters.push(this.buildFallbackEntry(char, appearances));
      }
    }

    return { bible: { characters }, tokensUsed: tokens };
  }

  /** 单角色兜底项（同 buildFallbackBible 逻辑，抽出复用） */
  private buildFallbackEntry(
    char: { name: string; description: string },
    appearances: number[]
  ): CharacterBible["characters"][number] {
    return {
      name: char.name,
      description: char.description,
      canonicalPrompt: char.description,
      appearance: {
        gender: "unknown",
        age: "unknown",
        hairStyle: "unknown",
        hairColor: "unknown",
        faceShape: "unknown",
        eyeColor: "unknown",
        bodyType: "unknown",
        skinTone: "unknown",
        height: "unknown",
        clothing: "unknown",
        accessories: "none",
      },
      voiceProfile: {
        gender: "unknown",
        age: "unknown",
        tone: "neutral",
      },
      appearances,
    };
  }

  /** 合并 LLM 生成的 bible 与已有项目角色数据 */
  private mergeWithExisting(
    bible: CharacterBible,
    existing?: Array<{
      name: string;
      description?: string | null;
      referenceImages?: string[];
    }>
  ): CharacterBible {
    if (!existing?.length) return bible;

    return {
      characters: bible.characters.map((entry) => {
        const match = existing.find(
          (e) =>
            e.name === entry.name ||
            e.name.includes(entry.name) ||
            entry.name.includes(e.name)
        );
        if (
          match?.description &&
          entry.description.length < (match.description?.length ?? 0)
        ) {
          return { ...entry, description: match.description };
        }
        return entry;
      }),
    };
  }

  /** 降级方案：从脚本数据构造基础 bible（最终兜底） */
  private buildFallbackBible(input: CharacterBibleInput): CharacterBible {
    return {
      characters: input.script.characters.map((char) => {
        const appearances = input.script.scenes
          .filter((s) => s.characters.includes(char.name))
          .map((s) => s.id);
        return this.buildFallbackEntry(char, appearances);
      }),
    };
  }
}

// ============ 紧凑版 LLM 重试辅助 ============

/** 构造单角色紧凑外貌 prompt —— 一次请求一个角色，字段少、返回快、解析稳定 */
function buildCompactAppearancePrompt(
  name: string,
  description: string
): string {
  return `请根据以下角色描述，补全结构化外貌字段。字段内容用英文。未知字段写 "unknown"。

角色名: ${name}
原始描述: ${description}

输出 JSON：
{"gender":"male/female","age":"数字或范围","hairStyle":"","hairColor":"","faceShape":"","eyeColor":"","bodyType":"","skinTone":"","height":"","clothing":"","accessories":""}`;
}

interface CompactAppearance {
  gender?: string;
  age?: string;
  hairStyle?: string;
  hairColor?: string;
  faceShape?: string;
  eyeColor?: string;
  bodyType?: string;
  skinTone?: string;
  height?: string;
  clothing?: string;
  accessories?: string;
}

function safeParseCompact(text: string): CompactAppearance | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as CompactAppearance;
  } catch {
    return null;
  }
}
