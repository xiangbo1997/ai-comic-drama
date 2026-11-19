import { createHash } from "node:crypto";
import {
  buildPairList,
  type ContinuityScene,
  CONTINUITY_REVIEW_VERSION,
  normalizeScreenSide,
} from "@/services/continuity-check";
import { extractSeriesPalette } from "@/lib/series";
import { parseStoryBible } from "@/types/series-bible";
import { getStylePaletteBaseline } from "@/lib/prompts/style-packs";

export type ReviewFreshness = "current" | "stale" | "unknown";

interface NarrativeEvidenceScene {
  order?: number;
  shotType?: string | null;
  description?: string | null;
  emotion?: string | null;
  duration: number;
  dialogue?: string | null;
  narration?: string | null;
  characters?: readonly string[];
  actionBeat?: string | null;
  cameraMovement?: string | null;
}

const text = (value: string | null | undefined) => value?.trim() || null;
const names = (values: readonly string[] | undefined) =>
  [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ].sort();
const fingerprint = (value: unknown) =>
  `sha256:v1:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

/** 仅指纹化导演实际看到的文本，出图/配音或DB更新时间不应令文本评审失效。 */
export function buildNarrativeReviewFingerprint<
  T extends NarrativeEvidenceScene,
>(scenes: readonly T[]): string {
  return fingerprint(
    [...scenes]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((scene) => ({
        shotType: text(scene.shotType),
        description: text(scene.description),
        emotion: text(scene.emotion),
        duration: scene.duration,
        dialogue: text(scene.dialogue),
        narration: text(scene.narration),
        characters: names(scene.characters),
        actionBeat: text(scene.actionBeat),
        cameraMovement: text(scene.cameraMovement),
      }))
  );
}

/** 视觉评审比较实际相邻图对及上下文，不借更新时间猜测哪些素材改过。 */
export function buildContinuityReviewFingerprint<T extends ContinuityScene>(
  scenes: readonly T[],
  expectedPalette?: string
): string {
  const sceneEvidence = (scene: ContinuityScene) => ({
    id: scene.id,
    order: scene.order,
    imageUrl: text(scene.imageUrl),
    locationKey: text(scene.locationKey),
    description: text(scene.description),
    characterNames: names(scene.characterNames),
    outfitNotes: names(scene.outfitNotes),
    actionBeat: text(scene.actionBeat),
    screenSide: normalizeScreenSide(scene.screenSide),
  });
  return fingerprint({
    reviewVersion: CONTINUITY_REVIEW_VERSION,
    expectedPalette: text(expectedPalette),
    pairs: buildPairList([...scenes]).map(({ prev, next }) => ({
      prev: sceneEvidence(prev),
      next: sceneEvidence(next),
    })),
  });
}

/** 历史结果缺少输入证据时不推定有效；用户回退到原输入后可再次匹配。 */
export function compareReviewFingerprint(
  stored: unknown,
  current: string
): ReviewFreshness {
  if (typeof stored !== "string" || !/^sha256:v1:[a-f0-9]{64}$/.test(stored))
    return "unknown";
  return stored === current ? "current" : "stale";
}

/** 体检与报告共用同一色板解析，系列无色板时回落画风基线。 */
export function resolveContinuityReviewPalette(
  style: string,
  storyBible: unknown
): string | undefined {
  return (
    extractSeriesPalette(parseStoryBible(storyBible)) ||
    getStylePaletteBaseline(style) ||
    undefined
  );
}
