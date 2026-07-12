import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock 所有外部副作用（无 ffmpeg / 无网络 / 无存储）──
const generateVideoMock = vi.fn();
const uploadFileMock = vi.fn();
const safeDownloadMock = vi.fn();
const extractLastFrameMock = vi.fn();
const concatVideosMock = vi.fn();
const getMediaDurationMock = vi.fn();

vi.mock("@/services/ai", () => ({
  generateVideo: (...args: unknown[]) => generateVideoMock(...args),
}));
vi.mock("@/services/storage", () => ({
  uploadFile: (...args: unknown[]) => uploadFileMock(...args),
}));
vi.mock("@/lib/url-guard", () => ({
  safeDownload: (...args: unknown[]) => safeDownloadMock(...args),
}));
vi.mock("@/services/video-synthesis", () => ({
  extractLastFrame: (...args: unknown[]) => extractLastFrameMock(...args),
  concatVideos: (...args: unknown[]) => concatVideosMock(...args),
  getMediaDuration: (...args: unknown[]) => getMediaDurationMock(...args),
}));

import { generateSceneVideoSegmented } from "@/services/generation/segmented-video";
import { getVideoModelCapability } from "@/services/ai/video-capabilities";

const baseArgs = {
  imageUrl: "https://cdn/scene1.jpg",
  aspectRatio: "9:16" as const,
  prompts: ["cinematic push-in"],
  userId: "u1",
  projectId: "p1",
  sceneId: "s1",
};

describe("generateSceneVideoSegmented — 单段路径零回归透传", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("时长 ≤ 单段能力：generateVideo 调用一次，原样返回 URL，不下载/拼接/上传", async () => {
    generateVideoMock.mockResolvedValue("https://provider/temp.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 5, // 档位类 5s → 1 段
      capability: getVideoModelCapability("runway"),
    });

    expect(result.videoUrl).toBe("https://provider/temp.mp4");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].seconds).toBe(5);
    // 单段路径：仅生成一次，绝不触发下载 / 末帧 / 拼接 / 上传
    expect(generateVideoMock).toHaveBeenCalledTimes(1);
    expect(safeDownloadMock).not.toHaveBeenCalled();
    expect(extractLastFrameMock).not.toHaveBeenCalled();
    expect(concatVideosMock).not.toHaveBeenCalled();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("Veo 单段（≤8s）同样透传，不携带 requestDuration", async () => {
    generateVideoMock.mockResolvedValue("https://provider/veo.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 5,
      capability: getVideoModelCapability("flow2api"),
    });

    expect(result.videoUrl).toBe("https://provider/veo.mp4");
    // Veo 段不下发 duration（undefined）
    const callArg = generateVideoMock.mock.calls[0][0] as {
      duration: number | undefined;
    };
    expect(callArg.duration).toBeUndefined();
  });

  it("档位类单段下发就近档位 duration", async () => {
    generateVideoMock.mockResolvedValue("https://provider/tier.mp4");

    await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 8, // → 就近 10 档（|10-8|=2 < |5-8|=3）
      capability: getVideoModelCapability("runway"),
    });

    const callArg = generateVideoMock.mock.calls[0][0] as { duration: number };
    expect(callArg.duration).toBe(10);
  });
});

describe("generateSceneVideoSegmented — 多段链式生成", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Veo 20s（3 段）：链式 3 次生成 + 2 次末帧提取 + 1 次拼接上传", async () => {
    // 每段返回不同的临时 URL
    generateVideoMock
      .mockResolvedValueOnce("https://provider/seg0.mp4")
      .mockResolvedValueOnce("https://provider/seg1.mp4")
      .mockResolvedValueOnce("https://provider/seg2.mp4");
    // 下载每段返回字节 + 探测时长（8s/段）
    safeDownloadMock.mockResolvedValue({ buffer: Buffer.from("v") });
    getMediaDurationMock.mockResolvedValue(8);
    // 末帧提取返回帧字节
    extractLastFrameMock.mockResolvedValue(Buffer.from("frame"));
    // 上传：末帧图 URL（2 次）+ 拼接视频 URL（1 次）
    uploadFileMock
      .mockResolvedValueOnce("https://storage/frame0.jpg")
      .mockResolvedValueOnce("https://storage/frame1.jpg")
      .mockResolvedValueOnce("https://storage/merged.mp4");
    concatVideosMock.mockResolvedValue(Buffer.from("merged"));

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 20,
      capability: getVideoModelCapability("flow2api"),
    });

    // 3 段生成
    expect(generateVideoMock).toHaveBeenCalledTimes(3);
    // 2 次末帧提取（段0、段1 的末帧作为下一段首帧）
    expect(extractLastFrameMock).toHaveBeenCalledTimes(2);
    // 1 次拼接
    expect(concatVideosMock).toHaveBeenCalledTimes(1);
    // 最终 videoUrl = 拼接后上传的自有 URL
    expect(result.videoUrl).toBe("https://storage/merged.mp4");
    expect(result.segments).toHaveLength(3);

    // 段0首帧 = 分镜图；段1首帧 = 段0末帧上传结果；段2首帧 = 段1末帧上传结果
    const calls = generateVideoMock.mock.calls;
    expect((calls[0][0] as { imageUrl: string }).imageUrl).toBe(
      "https://cdn/scene1.jpg"
    );
    expect((calls[1][0] as { imageUrl: string }).imageUrl).toBe(
      "https://storage/frame0.jpg"
    );
    expect((calls[2][0] as { imageUrl: string }).imageUrl).toBe(
      "https://storage/frame1.jpg"
    );
  });
});
