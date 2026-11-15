/** 独立字幕覆盖：空文本表示隐藏，移除条目恢复对白/旁白，不改动配音来源。 */
export interface SubtitleOverride {
  sceneId: string;
  text: string;
}
export const MAX_SUBTITLE_TEXT_LENGTH = 5000;

export function normalizeSubtitleOverrides(input: unknown): SubtitleOverride[] {
  if (!Array.isArray(input)) return [];
  const entries = new Map<string, SubtitleOverride>();
  for (const item of input.slice(0, 500)) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.sceneId !== "string" ||
      !item.sceneId ||
      item.sceneId.length > 64 ||
      typeof item.text !== "string"
    )
      continue;
    entries.set(item.sceneId, {
      sceneId: item.sceneId,
      text: item.text.slice(0, MAX_SUBTITLE_TEXT_LENGTH),
    });
  }
  return [...entries.values()];
}

export function applySubtitleOverrides<T extends { id: string }>(
  scenes: T[],
  overrides: unknown
): (T & { subtitleText?: string })[] {
  const map = new Map(
    normalizeSubtitleOverrides(overrides).map((item) => [
      item.sceneId,
      item.text,
    ])
  );
  return scenes.map((scene) =>
    map.has(scene.id) ? { ...scene, subtitleText: map.get(scene.id) } : scene
  );
}
