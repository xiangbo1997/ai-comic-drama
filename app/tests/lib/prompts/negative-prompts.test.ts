import { describe, it, expect } from "vitest";
import {
  getNegativePromptPreset,
  getNegativeBaseline,
} from "@/lib/prompts/negative-prompts";

describe("negative-prompts presets", () => {
  it("returns anime-specific negatives for style=anime (不同于写实)", () => {
    const anime = getNegativePromptPreset("anime");
    expect(anime).toContain("3d render");
    expect(anime).toContain(getNegativeBaseline());
  });

  it("returns realistic-specific negatives for style=realistic", () => {
    const realistic = getNegativePromptPreset("realistic");
    expect(realistic).toContain("cartoon");
    expect(realistic).toContain("anime");
  });

  it("falls back to anime negatives for unknown style", () => {
    const unknown = getNegativePromptPreset("brutalist-xx");
    const anime = getNegativePromptPreset("anime");
    expect(unknown).toBe(anime);
  });
});
