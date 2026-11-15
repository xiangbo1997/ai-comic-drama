interface LocationScene {
  id: string;
  order: number;
  locationKey?: string | null;
  description?: string | null;
}

/** 仅识别能与原脚本逐镜对上的旧版标题派生标签，不猜测或覆盖手动改过的地点。 */
export function legacyTitleLocationIds(
  scenes: LocationScene[],
  scriptDoc: unknown
): Set<string> {
  const source =
    scriptDoc && typeof scriptDoc === "object"
      ? (scriptDoc as { scenes?: unknown }).scenes
      : null;
  if (!Array.isArray(source)) return new Set();
  return new Set(
    scenes
      .filter((scene) => {
        const item = source[scene.order] as Record<string, unknown> | undefined;
        return (
          item &&
          typeof item.title === "string" &&
          !item.locationKey &&
          typeof item.description === "string" &&
          item.description.trim().length > 0 &&
          scene.description?.startsWith(item.description) &&
          scene.locationKey?.trim() === item.title.trim().slice(0, 12)
        );
      })
      .map((scene) => scene.id)
  );
}
