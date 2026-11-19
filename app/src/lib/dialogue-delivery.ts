export type DialogueDelivery = "onscreen" | "inner" | "offscreen" | "none";

/** 只识别行首的明确声源标记；正文出现“心想/画外音”不构成口型依据。 */
export function resolveDialogueDelivery(
  dialogue?: string | null
): DialogueDelivery {
  const lines = (dialogue ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "none";
  const deliveries = lines.map((line) => {
    const bracket = line.match(
      /^(?:[^:：\n()（）\[\]【】]{1,30})?\s*[(（\[【]\s*(内心独白|心理独白|心声|画外音|旁白|O\.?S\.?|V\.?O\.?)\s*[)）\]】]/i
    );
    const prefix = line.match(
      /^(内心独白|心理独白|心声|画外音|旁白|O\.?S\.?|V\.?O\.?)\s*[:：]/i
    );
    const marker = (bracket?.[1] ?? prefix?.[1])
      ?.toLowerCase()
      .replaceAll(".", "");
    if (!marker) return "onscreen" as const;
    return ["os", "内心独白", "心理独白", "心声"].includes(marker)
      ? ("inner" as const)
      : ("offscreen" as const);
  });
  // 同镜同时有当面对白与画外音时，仍允许当面说话，不因部分标记禁掉整镜口型。
  return deliveries.includes("onscreen")
    ? "onscreen"
    : deliveries.every((value) => value === "inner")
      ? "inner"
      : "offscreen";
}
