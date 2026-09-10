/**
 * 手动配音请求体的文本部分 —— 单一真源。
 *
 * 手动路径此前是 `text = dialogue || narration` 二选一：分镜同时有旁白和对白时
 * 旁白被整段丢弃，与一键 workflow 的 synthesizeSceneAudio（两段都合成并 concat）
 * 不对等；而字幕侧现在两段都显示（见 lib/subtitle-segments 的
 * buildSubtitleSourceText），不补齐配音就会出现「字幕有旁白、声音没有」。
 *
 * 本函数与 buildSubtitleSourceText 保持同一取舍：旁白在前、对白在后，两段都要。
 * 调用方（单张配音 / 批量配音 / 多配置并发配音）必须统一走这里，别再裸写 `||`。
 */

/** 配音请求的文本字段（服务端 api/generate/tts 消费） */
export interface TtsTextPayload {
  /** 计费与长度校验用的合并文本（两段时为「旁白\n对白」） */
  text: string;
  /**
   * 文本类型：决定服务端如何解析声线。
   * 双段时固定 "dialogue"——对白段用角色声线，旁白段由服务端单独解析说书人声线。
   */
  kind: "dialogue" | "narration";
  /** 旁白段原文；仅「旁白与对白都有」时下发，否则为 undefined（走单段路径） */
  narrationText?: string;
  /** 对白段原文；同上 */
  dialogueText?: string;
}

/**
 * 由分镜的旁白/对白构造配音请求的文本字段。
 *
 * 三种情形：
 *   - 两者都有 → 双段：text = 合并文本，kind="dialogue"，并下发两段原文，
 *     服务端分别用说书人声线 / 角色声线合成后拼接；
 *   - 只有对白 → 单段 dialogue（原行为）；
 *   - 只有旁白 → 单段 narration（原行为，服务端给说书人声线）。
 *
 * 两者皆空时返回 null（调用方应据此跳过，不发无意义请求）。
 */
export function buildTtsTextPayload(scene: {
  narration?: string | null;
  dialogue?: string | null;
}): TtsTextPayload | null {
  const narration = scene.narration?.trim() ?? "";
  const dialogue = scene.dialogue?.trim() ?? "";

  if (narration && dialogue) {
    return {
      text: `${narration}\n${dialogue}`,
      kind: "dialogue",
      narrationText: narration,
      dialogueText: dialogue,
    };
  }
  if (dialogue) return { text: dialogue, kind: "dialogue" };
  if (narration) return { text: narration, kind: "narration" };
  return null;
}
