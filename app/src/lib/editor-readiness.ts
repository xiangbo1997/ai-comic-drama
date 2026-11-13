import { buildTtsTextPayload } from "@/lib/tts-request";

export type EditorMediaKind = "image" | "video" | "audio";

interface EditorMediaScene {
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  imageStatus?: string | null;
  videoStatus?: string | null;
  audioStatus?: string | null;
  dialogue?: string | null;
  narration?: string | null;
}

/** 顶部进度与批量入口共用资格判据，避免完成数和实际生成目标各算各的。 */
export function getMediaBatchState<T extends EditorMediaScene>(
  scenes: readonly T[],
  kind: EditorMediaKind
): { done: number; total: number; targets: T[] } {
  const eligible =
    kind === "audio" ? scenes.filter((s) => buildTtsTextPayload(s)) : scenes;
  const urlField = `${kind}Url` as const;
  const statusField = `${kind}Status` as const;
  return {
    done: eligible.filter((s) => Boolean(s[urlField])).length,
    total: eligible.length,
    targets: eligible.filter(
      (s) =>
        !s[urlField] &&
        s[statusField] !== "PROCESSING" &&
        (kind !== "video" || Boolean(s.imageUrl))
    ),
  };
}

/** 与导出端的 imageUrl || videoUrl 判据对齐；部分可导出不等于全片画面齐全。 */
export function summarizeEditorReadiness(scenes: readonly EditorMediaScene[]) {
  const visualCount = scenes.filter((s) => s.imageUrl || s.videoUrl).length;
  return {
    total: scenes.length,
    visualCount,
    missingVisualCount: scenes.length - visualCount,
    canExport: visualCount > 0,
    allVisualsReady: scenes.length > 0 && visualCount === scenes.length,
  };
}
