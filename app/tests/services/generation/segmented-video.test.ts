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
const trimVideoToDurationMock = vi.fn();
vi.mock("@/services/video-synthesis", () => ({
  extractLastFrame: (...args: unknown[]) => extractLastFrameMock(...args),
  concatVideos: (...args: unknown[]) => concatVideosMock(...args),
  getMediaDuration: (...args: unknown[]) => getMediaDurationMock(...args),
  trimVideoToDuration: (...args: unknown[]) => trimVideoToDurationMock(...args),
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

describe("generateSceneVideoSegmented — 单段路径零回归透传（豁免裁剪）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exemptFromTrim=true：generateVideo 调用一次，原样返回 URL，不下载/裁剪/拼接/上传", async () => {
    generateVideoMock.mockResolvedValue("https://provider/temp.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 5, // 档位类 5s → 1 段
      capability: getVideoModelCapability("runway"),
      exemptFromTrim: true,
    });

    expect(result.videoUrl).toBe("https://provider/temp.mp4");
    expect(result.isSelfHosted).toBe(false);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].seconds).toBe(5);
    // 豁免路径：仅生成一次，绝不触发下载 / 裁剪 / 末帧 / 拼接 / 上传
    expect(generateVideoMock).toHaveBeenCalledTimes(1);
    expect(safeDownloadMock).not.toHaveBeenCalled();
    expect(trimVideoToDurationMock).not.toHaveBeenCalled();
    expect(extractLastFrameMock).not.toHaveBeenCalled();
    expect(concatVideosMock).not.toHaveBeenCalled();
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("FL 首尾帧模式：不裁剪（整段插值不宜砍尾），透传", async () => {
    generateVideoMock.mockResolvedValue("https://provider/fl.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 5,
      capability: getVideoModelCapability("flow2api"), // supportsFirstLastFrame
      lastFrameImage: "https://cdn/next.jpg",
      // 不设 exemptFromTrim，但 FL 模式内部豁免裁剪
    });

    expect(result.videoUrl).toBe("https://provider/fl.mp4");
    expect(result.isSelfHosted).toBe(false);
    expect(safeDownloadMock).not.toHaveBeenCalled();
    expect(trimVideoToDurationMock).not.toHaveBeenCalled();
  });

  it("Veo 单段（≤8s）豁免时透传，不携带 requestDuration", async () => {
    generateVideoMock.mockResolvedValue("https://provider/veo.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 5,
      capability: getVideoModelCapability("flow2api"),
      exemptFromTrim: true,
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
      exemptFromTrim: true,
    });

    const callArg = generateVideoMock.mock.calls[0][0] as { duration: number };
    expect(callArg.duration).toBe(10);
  });
});

describe("generateSceneVideoSegmented — 单段裁剪路径（剪辑节奏回归）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("默认裁剪：provider 出 5s，裁到叙事目标 3s，下载→裁剪→上传自有存储", async () => {
    // 目标 3s：runway 档位就近选 5（|5-3|=2<|10-3|=7），provider 实出 5s
    generateVideoMock.mockResolvedValue("https://provider/temp.mp4");
    safeDownloadMock.mockResolvedValue({ buffer: Buffer.from("raw") });
    getMediaDurationMock
      .mockResolvedValueOnce(5) // 下载后实测原始 5s
      .mockResolvedValueOnce(3); // 裁剪后实测 3s
    trimVideoToDurationMock.mockResolvedValue(Buffer.from("trimmed"));
    uploadFileMock.mockResolvedValue("https://storage/trimmed.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 3, // 叙事目标 3s
      capability: getVideoModelCapability("runway"),
    });

    // 裁到 3s 目标（trimVideoToDuration 收到 target=3）
    expect(trimVideoToDurationMock).toHaveBeenCalledTimes(1);
    expect(trimVideoToDurationMock.mock.calls[0][1]).toBe(3);
    // 落自有存储 + isSelfHosted
    expect(result.videoUrl).toBe("https://storage/trimmed.mp4");
    expect(result.isSelfHosted).toBe(true);
    // 回写用裁剪后实测时长（3s），保留原始 5s 供排障
    expect(result.measuredDurationSeconds).toBe(3);
    expect(result.rawMeasuredDurationSeconds).toBe(5);
  });

  it("provider 实出已 ≤ 目标：不裁剪，仍转存到自有存储", async () => {
    generateVideoMock.mockResolvedValue("https://provider/short.mp4");
    safeDownloadMock.mockResolvedValue({ buffer: Buffer.from("raw") });
    // 原始实测 2.5s ≤ 目标 3s → 不裁剪
    getMediaDurationMock.mockResolvedValueOnce(2.5).mockResolvedValueOnce(2.5);
    uploadFileMock.mockResolvedValue("https://storage/short.mp4");

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 3,
      capability: getVideoModelCapability("runway"),
    });

    expect(trimVideoToDurationMock).not.toHaveBeenCalled();
    expect(result.isSelfHosted).toBe(true);
    expect(result.videoUrl).toBe("https://storage/short.mp4");
  });

  it("裁剪链任一步失败：降级透传 provider 原 URL，不阻断生成", async () => {
    generateVideoMock.mockResolvedValue("https://provider/temp.mp4");
    safeDownloadMock.mockResolvedValue({ buffer: Buffer.from("raw") });
    getMediaDurationMock.mockResolvedValue(5);
    trimVideoToDurationMock.mockRejectedValue(new Error("ffmpeg 挂了"));

    const result = await generateSceneVideoSegmented({
      ...baseArgs,
      requestedSeconds: 3,
      capability: getVideoModelCapability("runway"),
    });

    // 降级：返回 provider 原 URL，isSelfHosted=false（route 会转存）
    expect(result.videoUrl).toBe("https://provider/temp.mp4");
    expect(result.isSelfHosted).toBe(false);
    expect(uploadFileMock).not.toHaveBeenCalled();
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
