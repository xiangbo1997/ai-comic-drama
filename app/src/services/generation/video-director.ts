/**
 * 视频导演增强服务（LLM 导演增强 · Deliverable 2）
 *
 * 生成视频前的一次可选 LLM 往返，只导演「运动」——镜头怎么动、角色做什么
 * 动作、环境什么在动。与图像端的场景分析（buildSceneAnalysisPrompt）同款模式：
 * 缓存 + 温度低 + 失败静默降级（返回 null，调用方回落确定性构建）。
 *
 * 记忆（不失忆）靠三条链路传进 prompt：
 * - prevScene / nextScene：承接上一镜、铺垫下一镜，运镜不与相邻镜重复
 * - characters（含 identity 外貌锚，仅供理解、禁止复述）：人物情绪/状态跨镜延续
 * - seriesRecap：跨集前情提要，续集不从零开始
 *
 * 硬约束（与 video-prompt.ts 呼应）：
 * - 输出禁止外貌/服装描写——外貌由参考图和身份锚定，重描会画面漂移
 * - 禁止对白与口型指示——管线自己叠 TTS，Veo 口型会对不上
 * - actionBeat 是中文（走内容安全，不进 Avoid 段，故无需纯 ASCII）
 * - atmosphere 是英文短语（进 video-prompt 的 atmosphereOverride）
 */

import { z } from "zod";
import { chatCompletion } from "@/services/ai";
import { parseLooseJSON } from "@/lib/json-repair";
import { createLogger } from "@/lib/logger";
import { CAMERA_MOVEMENTS } from "@/lib/prompts";
import {
  getVideoDirectionCache,
  setVideoDirectionCache,
} from "@/lib/cache/video-direction-cache";
import type { AIServiceConfig } from "@/types";

const log = createLogger("services:generation:video-director");

/** 视频导演增强输入 */
export interface VideoDirectorInput {
  scene: {
    description: string;
    actionBeat?: string | null;
    shotType?: string | null;
    cameraAngle?: string | null;
    lighting?: string | null;
    emotion?: string | null;
    duration: number;
  };
  /** 出场角色：identity ≤200 字外貌锚，仅供理解，输出禁止复述 */
  characters: Array<{ name: string; identity: string }>;
  /** 上一镜（承接来源）：只给 description + actionBeat */
  prevScene?: { description: string; actionBeat?: string | null } | null;
  /** 下一镜（铺垫目标）：只给 description + actionBeat */
  nextScene?: { description: string; actionBeat?: string | null } | null;
  /** 项目风格 */
  style?: string | null;
  /** 前情提要（跨集记忆），有则传 */
  seriesRecap?: string | null;
}

/** 视频导演增强输出 */
export interface VideoDirection {
  /** 运镜（13 值枚举之一；非法值在解析层被丢弃） */
  cameraMovement?: string;
  /** 运动节拍（中文 ≤120 字，必填） */
  actionBeat: string;
  /** 氛围（英文 ≤60 字，可选，进 video-prompt 的 atmosphereOverride） */
  atmosphere?: string;
}

/** LLM 参数 */
const DIRECTOR_TEMPERATURE = 0.4;
const DIRECTOR_MAX_TOKENS = 512;
/** actionBeat 中文上限；超限截断到此长度（保留导演意图，不整条丢） */
const ACTION_BEAT_MAX_CHARS = 120;
/** atmosphere 英文上限；超限直接丢弃（可选字段，非必需） */
const ATMOSPHERE_MAX_CHARS = 60;

const DIRECTOR_SYSTEM = `你是一位资深动画分镜导演，只负责导演「运动」——镜头怎么动、角色做什么动作、环境什么在动。

规则（严格遵守，全部生效）：
1. 只导演运动：cameraMovement（镜头如何运动）、actionBeat（角色动作 / 表情变化 / 环境动态），不要重复画面里已有的静态构图。
2. 角色一律用名字称呼，绝对禁止描述外貌 / 服装 / 发型 / 相貌——外貌由参考图和身份锚定，你重新描述会导致画面漂移。角色身份信息仅供你理解「谁在动」，禁止复述。
3. 承接上一镜、铺垫下一镜：cameraMovement 不与相邻镜头重复；actionBeat 与前后剧情连贯；人物情绪 / 身体状态延续——就算相隔多镜也不能失忆（比如上一镜受伤了，这一镜就还是受伤状态；持着某物就还持着）。这靠 prevScene / nextScene 与角色信息的连续传递保证。
4. 禁止对白和口型指示（管线自己叠加配音，口型会对不上）。
5. 禁止引入画面外的新元素 / 新角色 / 新道具。
6. cameraMovement 必须是以下之一：static、zoom_in、zoom_out、pan_left、pan_right、tilt_up、tilt_down、dolly_in、dolly_out、orbit、tracking、handheld、crane。
7. actionBeat 用中文，≤120 字，只写「动」的内容。atmosphere 用英文短语，≤60 字符，概括氛围（可选）。

输出仅一个 JSON 对象，不要 markdown 代码块，不要额外文字：
{"cameraMovement": "...", "actionBeat": "...", "atmosphere": "..."}`;

/** 把可选相邻镜压成一行简报（description + actionBeat），无则返回空串 */
function formatAdjacent(
  label: string,
  scene?: { description: string; actionBeat?: string | null } | null
): string {
  if (!scene) return "";
  const beat = scene.actionBeat?.trim();
  const line = beat
    ? `${scene.description.trim()}（动作：${beat}）`
    : scene.description.trim();
  return `${label}：${line}`;
}

/**
 * 构建导演 prompt（纯函数、可测）。
 * 把当前镜 + 相邻镜 + 角色（按名字）+ 前情提要拼进用户消息。
 */
export function buildDirectorPrompt(input: VideoDirectorInput): string {
  const { scene, characters, prevScene, nextScene, style, seriesRecap } = input;

  const parts: string[] = [];

  if (seriesRecap?.trim()) {
    parts.push(
      `【前情提要（跨集记忆，人物状态由此延续）】\n${seriesRecap.trim()}`
    );
  }

  const charLines =
    characters.length > 0
      ? characters.map((c) => `- ${c.name}：${c.identity}`).join("\n")
      : "（无指定角色）";
  parts.push(
    `【出场角色（身份仅供理解「谁在动」，输出禁止复述外貌）】\n${charLines}`
  );

  const prevLine = formatAdjacent("上一镜", prevScene);
  const nextLine = formatAdjacent("下一镜", nextScene);
  if (prevLine || nextLine) {
    const adj = [prevLine, nextLine].filter(Boolean).join("\n");
    parts.push(`【相邻镜（承接上、铺垫下；运镜不要与它们重复）】\n${adj}`);
  }

  const sceneLines = [
    `画面：${scene.description.trim()}`,
    scene.actionBeat?.trim() ? `已有运动节拍：${scene.actionBeat.trim()}` : "",
    scene.shotType ? `景别：${scene.shotType}` : "",
    scene.cameraAngle ? `机位：${scene.cameraAngle}` : "",
    scene.lighting ? `光线：${scene.lighting}` : "",
    scene.emotion ? `情绪：${scene.emotion}` : "",
    style ? `风格：${style}` : "",
    `时长：${scene.duration}秒`,
  ]
    .filter(Boolean)
    .join("\n");
  parts.push(`【本镜】\n${sceneLines}`);

  parts.push(
    `请为【本镜】导演运动，输出 JSON：{"cameraMovement","actionBeat","atmosphere"}。`
  );

  return parts.join("\n\n");
}

/** 运镜枚举（复用 video-prompt 唯一真源） */
const CameraMovementEnum = z.enum(CAMERA_MOVEMENTS);

/**
 * 解析导演响应（纯函数、可测）。
 * - 提取 JSON（容错智能引号/围栏/trailing comma）
 * - actionBeat 必填，缺失/空 → 抛错（调用方降级）
 * - actionBeat 超 120 字 → 截断（保留导演意图）
 * - cameraMovement 非 13 值枚举 → 丢弃（不带非法值下游）
 * - atmosphere 超 60 字符或非字符串 → 丢弃（可选字段）
 *
 * @throws JSON 无法解析 / actionBeat 缺失时抛 Error
 */
export function parseDirectorResponse(raw: string): VideoDirection {
  let parsed: unknown;
  try {
    parsed = parseLooseJSON(raw);
  } catch (err) {
    throw new Error(
      `导演响应无法解析为 JSON：${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("导演响应不是 JSON 对象");
  }

  const obj = parsed as Record<string, unknown>;

  // actionBeat 必填
  const rawBeat = obj.actionBeat;
  if (typeof rawBeat !== "string" || rawBeat.trim().length === 0) {
    throw new Error("导演响应缺少 actionBeat");
  }
  const trimmedBeat = rawBeat.trim();
  const actionBeat =
    trimmedBeat.length > ACTION_BEAT_MAX_CHARS
      ? trimmedBeat.slice(0, ACTION_BEAT_MAX_CHARS)
      : trimmedBeat;

  // cameraMovement：13 值枚举，非法丢弃
  const movementResult = CameraMovementEnum.safeParse(obj.cameraMovement);
  const cameraMovement = movementResult.success
    ? movementResult.data
    : undefined;

  // atmosphere：英文短语，可选，超限/非字符串丢弃
  let atmosphere: string | undefined;
  if (typeof obj.atmosphere === "string") {
    const trimmed = obj.atmosphere.trim();
    if (trimmed.length > 0 && trimmed.length <= ATMOSPHERE_MAX_CHARS) {
      atmosphere = trimmed;
    }
  }

  return { cameraMovement, actionBeat, atmosphere };
}

/**
 * 生成时视频导演增强：调 LLM 导演一次「运动」，缓存 + 任何失败返回 null。
 *
 * 缓存 key 按完整输入的稳定哈希（见 video-direction-cache），同分镜同上下文
 * 重复生成时跳过这次 ~512 tokens 的往返。
 *
 * @returns 成功返回 VideoDirection；无 LLM 配置 / 解析失败 / 上游错误一律返回
 *   null 并 log.warn（调用方回落到确定性 buildVideoScenePrompt）。
 */
export async function directVideoScene(
  input: VideoDirectorInput,
  llmConfig: AIServiceConfig | null | undefined
): Promise<VideoDirection | null> {
  if (!llmConfig) {
    log.warn("无 LLM 配置，跳过视频导演增强");
    return null;
  }

  try {
    // 命中缓存直接返回（缓存的是已校验通过的 JSON 字符串）
    const cached = await getVideoDirectionCache(input);
    if (cached) {
      try {
        return parseDirectorResponse(cached);
      } catch {
        // 缓存内容异常按 miss 处理，继续走 LLM
      }
    }

    const userPrompt = buildDirectorPrompt(input);
    const response = await chatCompletion(
      [
        { role: "system", content: DIRECTOR_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      {
        config: llmConfig,
        temperature: DIRECTOR_TEMPERATURE,
        maxTokens: DIRECTOR_MAX_TOKENS,
      }
    );

    const direction = parseDirectorResponse(response);
    // 仅成功解析后写缓存
    void setVideoDirectionCache(input, response);
    return direction;
  } catch (err) {
    log.warn("视频导演增强失败，降级到确定性构建", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
