import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeVideoToPath } from "@/services/video-synthesis";
import { runFFmpeg } from "@/services/video-synthesis/ffmpeg-run";

vi.mock("@/services/video-synthesis/ffmpeg-run", () => ({
  runFFmpeg: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn(async (_url, filename, dir) => path.join(dir, filename)),
  absolutizeUrl: vi.fn((url) => url),
}));
vi.mock("@/services/video-synthesis/media-ops", () => ({
  getMediaDuration: vi.fn().mockResolvedValue(1),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("多分镜导出内存回归", () => {
  it("29 镜转场合并限制每路解码、滤镜和编码线程，并保留全部转场", async () => {
    vi.stubEnv("ENABLE_VIDEO_XFADE", "1");
    const scenes = Array.from({ length: 29 }, (_, i) => ({
      id: `scene-${i}`,
      order: i,
      duration: 1,
    }));
    const consume = vi.fn(async () => "uploaded");
    const result = await synthesizeVideoToPath(
      scenes,
      {
        format: "mp4",
        quality: "1080p",
        aspectRatio: "9:16",
        includeSubtitles: false,
        includeAudio: false,
        aiDisclosure: { enabled: false },
      },
      consume
    );

    const merges = vi
      .mocked(runFFmpeg)
      .mock.calls.map(([args]) => args)
      .filter((args) =>
        /\/(?:merge_\d+_\d+|merged)\.mp4$/.test(args.at(-1) ?? "")
      );
    const originalInputs: string[] = [];
    let transitionCount = 0;
    for (const args of merges) {
      const inputs = args.flatMap((arg, i) => (arg === "-i" ? [i] : []));
      expect(inputs.length).toBeLessThanOrEqual(4);
      for (const i of inputs) {
        expect(args.slice(i - 2, i)).toEqual(["-threads", "1"]);
        if (/\/scene_\d+\.mp4$/.test(args[i + 1]))
          originalInputs.push(args[i + 1]);
      }
      expect(args[args.indexOf("-filter_complex_threads") + 1]).toBe("1");
      expect(args[args.lastIndexOf("-threads") + 1]).toBe("2");
      transitionCount +=
        args[args.indexOf("-filter_complex") + 1].match(/xfade=/g)!.length;
    }
    expect(
      originalInputs.map((p) => Number(/scene_(\d+)/.exec(p)![1]))
    ).toEqual(Array.from({ length: 29 }, (_, i) => i));
    expect(transitionCount).toBe(28);
    const final = merges.at(-1)!;
    expect(final[final.indexOf("-filter_complex") + 1]).toContain(
      "offset=15.360[outv]"
    );
    expect(result).toBe("uploaded");
    expect(consume).toHaveBeenCalledOnce();
  });
});
