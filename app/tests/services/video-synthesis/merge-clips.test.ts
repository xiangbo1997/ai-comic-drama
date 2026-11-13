import { beforeEach, describe, expect, it, vi } from "vitest";
import { mergeClipsWithTransitions } from "@/services/video-synthesis/merge-clips";
import { runFFmpeg } from "@/services/video-synthesis/ffmpeg-run";

vi.mock("@/services/video-synthesis/ffmpeg-run", () => ({
  runFFmpeg: vi.fn(),
}));
beforeEach(() => vi.mocked(runFFmpeg).mockReset().mockResolvedValue(undefined));

describe("分层转场合并", () => {
  it("跨批边界使用原始转场配置和累计时长，单个尾镜不丢失", async () => {
    const onProgress = vi.fn().mockResolvedValue(undefined);
    const transitions = [
      { type: "fade", duration: 0.1 },
      { type: "wipeleft", duration: 0.2 },
      { type: "slideright", duration: 0.3 },
      { type: "circleopen", duration: 0.4 },
    ];
    await mergeClipsWithTransitions(
      ["a", "b", "c", "d", "e"],
      [2, 3, 4, 5, 6],
      (i) => transitions[i],
      "/tmp/test",
      "16",
      onProgress
    );
    const calls = vi.mocked(runFFmpeg).mock.calls.map(([args]) => args);
    expect(calls).toHaveLength(2);
    const first = calls[0][calls[0].indexOf("-filter_complex") + 1];
    expect(first).toContain("transition=wipeleft:duration=0.200:offset=4.700");
    expect(first).toContain(
      "transition=slideright:duration=0.300:offset=8.400"
    );
    const last = calls[1];
    expect(last[last.indexOf("-filter_complex") + 1]).toContain(
      "transition=circleopen:duration=0.400:offset=13.000[outv]"
    );
    expect(last.filter((arg, i) => last[i - 1] === "-i")).toEqual([
      "/tmp/test/merge_0_0.mp4",
      "e",
    ]);
    expect(last.at(-1)).toBe("/tmp/test/merged.mp4");
    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      0.75, 1,
    ]);
  });

  it("合并失败立即终止，不继续上传或后续批次", async () => {
    vi.mocked(runFFmpeg).mockRejectedValueOnce(new Error("encoder failure"));
    await expect(
      mergeClipsWithTransitions(
        ["a", "b", "c", "d", "e"],
        [1, 1, 1, 1, 1],
        () => ({ type: "fade", duration: 0.04 }),
        "/tmp/test",
        "16"
      )
    ).rejects.toThrow("encoder failure");
    expect(runFFmpeg).toHaveBeenCalledOnce();
  });
});
