/**
 * TTS 声线解析（纯函数，无 IO）
 *
 * 供「手动 TTS 路由」与「一键 workflow 引擎」共用同一套声线裁决逻辑，避免两条
 * 配音路径行为漂移（全局一致性）。核心解决三件事：
 *   1) 厂商家族归一（normalizeVoiceFamily）：判定角色声线与激活配置是否同源；
 *   2) 角色声线跨厂商防污染（resolveDialogueVoiceId）：角色 voiceId 是火山专用串，
 *      激活配置若是 ElevenLabs/GPT-SoVITS 则原样传会被当未知声线（报错/跑偏），
 *      家族不匹配时回落该 provider 默认声线；
 *   3) 旁白独立声线（resolveNarratorVoiceId）：旁白不应与角色用同一「甜美女声」，
 *      火山家族给一条沉稳磁性男声作旁白默认，其他家族省略 voiceId 用 provider 默认。
 */

/**
 * 火山家族旁白默认声线：磁性男声。
 *
 * 漫剧旁白惯例是与角色对白区分的独立声线（多为沉稳男声做「说书人」）。此处选
 * VOICE_PRESETS 里的磁性男声作火山家族旁白默认，让旁白与角色对白听感分离。
 * 仅在激活 TTS 为火山家族时使用；其他家族（ElevenLabs/GPT-SoVITS）该串是未知
 * 声线，故 resolveNarratorVoiceId 对非火山家族返回 undefined 走 provider 默认。
 */
export const VOLCANO_NARRATOR_VOICE_ID = "zh_male_chunhou_moon_bigtts";

/**
 * 把「厂商标识」归一到 TTS 声线家族，用于判定角色声线与激活配置是否同源。
 *
 * 背景：Character.voiceProvider 前端存 "volcano"，而激活 TTS 配置的 protocol
 * 走 provider-factory 的 "volcengine" / "elevenlabs" / "gpt-sovits"。二者字面不同
 * 但同属火山家族，需归一后比较。
 *
 * 归一规则（大小写不敏感，容忍 baseUrl 关键字）：
 *   volcano / volcengine / bytedance → "volcano"
 *   elevenlabs                       → "elevenlabs"
 *   gpt-sovits / gptsovits / sovits  → "gpt-sovits"
 *   其余                             → "" （未知家族，判定时按不匹配处理）
 */
export function normalizeVoiceFamily(raw?: string | null): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v.includes("volc") || v.includes("bytedance")) return "volcano";
  if (v.includes("elevenlabs")) return "elevenlabs";
  if (v.includes("sovits")) return "gpt-sovits";
  return "";
}

/**
 * 解析「对白」应使用的角色声线（跨厂商防污染）。
 *
 * 仅当角色声线家族与激活 TTS 配置家族匹配时才采用角色 voiceId；不匹配（或家族
 * 无法判定、角色未设声线）返回 undefined，由 provider 适配器回落各自默认声线。
 *
 * @param params.characterVoiceId       角色 Character.voiceId（可空）
 * @param params.characterVoiceProvider 角色 Character.voiceProvider（可空，如 "volcano"）
 * @param params.activeFamily           激活 TTS 配置归一后的家族（normalizeVoiceFamily 产出）
 * @returns 可用的角色 voiceId；不可用时 undefined
 */
export function resolveDialogueVoiceId(params: {
  characterVoiceId?: string | null;
  characterVoiceProvider?: string | null;
  activeFamily: string;
}): string | undefined {
  const { characterVoiceId, characterVoiceProvider, activeFamily } = params;
  if (!characterVoiceId) return undefined;

  const charFamily = normalizeVoiceFamily(characterVoiceProvider);
  const familyMatches =
    activeFamily !== "" && charFamily !== "" && charFamily === activeFamily;
  return familyMatches ? characterVoiceId : undefined;
}

/**
 * 解析「旁白」应使用的声线：火山家族给独立磁性男声，其他家族用 provider 默认。
 *
 * 旁白与角色对白应听感分离（说书人 vs 剧中人）。仅火山家族有可靠的预置旁白声线
 * （VOLCANO_NARRATOR_VOICE_ID）；ElevenLabs/GPT-SoVITS 该串是未知声线，返回
 * undefined 让 provider 用自家默认，避免传入非法 voiceId 导致报错。
 *
 * @param activeFamily 激活 TTS 配置归一后的家族（normalizeVoiceFamily 产出）
 * @returns 旁白 voiceId；非火山家族返回 undefined（走 provider 默认）
 */
export function resolveNarratorVoiceId(
  activeFamily: string
): string | undefined {
  return activeFamily === "volcano" ? VOLCANO_NARRATOR_VOICE_ID : undefined;
}
