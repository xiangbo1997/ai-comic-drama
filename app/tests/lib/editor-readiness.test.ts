import { describe, expect, it } from "vitest";
import {
  getMediaBatchState,
  summarizeEditorReadiness,
} from "@/lib/editor-readiness";

describe("editor media readiness", () => {
  it("supports video-only exports and counts each visual scene once", () => {
    expect(
      summarizeEditorReadiness([
        { videoUrl: "video" },
        { imageUrl: "image", videoUrl: "video" },
        {},
      ])
    ).toEqual({
      total: 3,
      visualCount: 2,
      missingVisualCount: 1,
      canExport: true,
      allVisualsReady: false,
    });
  });

  it("does not label an empty or audio-only project ready for export", () => {
    for (const scenes of [[], [{ audioUrl: "audio" }]]) {
      const summary = summarizeEditorReadiness(scenes);
      expect(summary.canExport).toBe(false);
      expect(summary.allVisualsReady).toBe(false);
    }
  });

  it("marks full visual coverage ready without requiring generated video", () => {
    expect(
      summarizeEditorReadiness([{ imageUrl: "a" }, { imageUrl: "b" }])
        .allVisualsReady
    ).toBe(true);
  });

  it("image batches only fill missing non-processing scenes, including failures", () => {
    const scenes = [
      { id: "done", imageUrl: "image" },
      { id: "running", imageStatus: "PROCESSING" },
      { id: "failed", imageStatus: "FAILED" },
      { id: "new" },
    ];
    const state = getMediaBatchState(scenes, "image");
    expect(state.done).toBe(1);
    expect(state.total).toBe(4);
    expect(state.targets.map((s) => s.id)).toEqual(["failed", "new"]);
    expect(scenes[1].imageStatus).toBe("PROCESSING");
  });

  it("video batches require an image and never regenerate existing videos", () => {
    const state = getMediaBatchState(
      [
        { id: "no-image" },
        { id: "ready", imageUrl: "image" },
        { id: "running", imageUrl: "image", videoStatus: "PROCESSING" },
        { id: "done", videoUrl: "video" },
      ],
      "video"
    );
    expect(state.targets.map((s) => s.id)).toEqual(["ready"]);
    expect(state.done).toBe(1);
    expect(state.total).toBe(4);
  });

  it("ignores whitespace speech and stale audio on silent scenes", () => {
    const state = getMediaBatchState(
      [
        { id: "silent-old", audioUrl: "old" },
        { id: "whitespace", dialogue: "  \n", narration: "\t" },
        { id: "spoken", dialogue: "你好", audioUrl: "audio" },
        { id: "narrated", narration: "风停了" },
        { id: "running", dialogue: "等等", audioStatus: "PROCESSING" },
      ],
      "audio"
    );
    expect(state.done).toBe(1);
    expect(state.total).toBe(3);
    expect(state.targets.map((s) => s.id)).toEqual(["narrated"]);
  });

  it("completed and processing-only batches have no targets", () => {
    expect(
      getMediaBatchState(
        [{ imageUrl: "image" }, { imageStatus: "PROCESSING" }],
        "image"
      ).targets
    ).toEqual([]);
  });
});
