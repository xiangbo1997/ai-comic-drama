/**
 * 配音合成（从 `workflow-engine.ts#synthesizeSceneAudio` 平移，纯搬运无行为变更）
 *
 * 由 `steps/videos.ts` 的媒体 fan-out 循环按镜调用；与视频任务在同一 Promise
 * 批次内并行。
 */

import { synthesizeSpeech } from "@/services/ai";
import { resolveDialogueVoiceId } from "@/lib/tts-voice";
import { concatAudioBuffers } from "@/services/video-synthesis";
import type { ProjectCharacterMap } from "../project-characters";
import type { SceneArtifact } from "../../types";
import type { AIServiceConfig } from "@/types";

/**
 * 一键 workflow 的分镜配音合成（批3：声线断链 + 情绪透传 + 旁白独立声线）。
 *
 * 修复三处断裂：
 *   1) 对白用角色声线：查主角色（sceneArtifact.characters[0]）的 Character.voiceId，
 *      经 resolveDialogueVoiceId 跨厂商防污染后传入——此前 workflow 从不传 voiceId，
 *      所有角色（含男性）都用默认「甜美女声」。
 *   2) 旁白用独立说书人声线（narratorVoiceId），与角色对白听感分离。
 *   3) 旁白 + 对白都在时不再二选一丢弃：旁白（铺垫）在前、对白在后，两段独立合成
 *      后 concatAudioBuffers 拼成单条音轨。
 *
 * 情绪（sceneArtifact.emotion）透传给两段合成。任一段失败即抛错（由调用方置 FAILED），
 * 但情绪/声线是增强项——provider 层已对情绪失败做无情绪重试，不会因情绪阻断。
 *
 * @returns 合成后的音频 Buffer 与计费字符数；无对白无旁白时返回 null（跳过配音）。
 */
export async function synthesizeSceneAudio(params: {
  sceneArtifact: SceneArtifact;
  ttsSpeed: number;
  ttsConfig: AIServiceConfig;
  characterMap: ProjectCharacterMap;
  ttsActiveFamily: string;
  narratorVoiceId?: string;
}): Promise<{ audioBuffer: Buffer; charCount: number } | null> {
  const {
    sceneArtifact,
    ttsSpeed,
    ttsConfig,
    characterMap,
    ttsActiveFamily,
    narratorVoiceId,
  } = params;

  const narration = sceneArtifact.narration?.trim() || "";
  const dialogue = sceneArtifact.dialogue?.trim() || "";
  if (!narration && !dialogue) return null;

  const emotion = sceneArtifact.emotion || undefined;

  // 对白声线：主角色（characters[0]）的 voiceId，跨厂商防污染后使用；无匹配则 undefined
  // 回落 provider 默认声线。
  const primaryName = sceneArtifact.characters?.[0];
  const primaryChar = primaryName ? characterMap.get(primaryName) : undefined;
  const dialogueVoiceId = resolveDialogueVoiceId({
    characterVoiceId: primaryChar?.voiceId,
    characterVoiceProvider: primaryChar?.voiceProvider,
    activeFamily: ttsActiveFamily,
  });

  // 分段合成：旁白（说书人声线，铺垫在前）→ 对白（角色声线，在后）。二者之一缺失
  // 时只合成存在的那段（无需拼接）。
  const segments: Buffer[] = [];
  if (narration) {
    segments.push(
      await synthesizeSpeech({
        text: narration,
        voiceId: narratorVoiceId,
        speed: ttsSpeed,
        emotion,
        config: ttsConfig,
      })
    );
  }
  if (dialogue) {
    segments.push(
      await synthesizeSpeech({
        text: dialogue,
        voiceId: dialogueVoiceId,
        speed: ttsSpeed,
        emotion,
        config: ttsConfig,
      })
    );
  }

  const audioBuffer =
    segments.length === 1 ? segments[0] : await concatAudioBuffers(segments);
  // 计费字符数 = 旁白 + 对白总字数（与两段实际合成的文本量一致）
  const charCount = narration.length + dialogue.length;
  return { audioBuffer, charCount };
}
