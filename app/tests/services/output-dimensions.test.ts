import { describe, it, expect } from "vitest";
import { resolveOutputDimensions } from "@/services/video-synthesis";

/**
 * 导出画幅派生纯函数测试（D5）
 *
 * 核心保障：最终输出尺寸 = 质量档位基准 + 项目 aspectRatio 派生，
 * 不再把 16:9 / 1:1 项目强塞进竖屏；宽高恒为偶数（libx264 要求）。
 */
describe("resolveOutputDimensions", () => {
  it("9:16 竖屏：短边×长边（保持竖屏基准）", () => {
    expect(resolveOutputDimensions("480p", "9:16")).toEqual({
      width: 480,
      height: 854,
      bitrate: "1M",
    });
    expect(resolveOutputDimensions("720p", "9:16")).toEqual({
      width: 720,
      height: 1280,
      bitrate: "2.5M",
    });
    expect(resolveOutputDimensions("1080p", "9:16")).toEqual({
      width: 1080,
      height: 1920,
      bitrate: "5M",
    });
  });

  it("16:9 横屏：长短边转置", () => {
    expect(resolveOutputDimensions("480p", "16:9")).toEqual({
      width: 854,
      height: 480,
      bitrate: "1M",
    });
    expect(resolveOutputDimensions("720p", "16:9")).toEqual({
      width: 1280,
      height: 720,
      bitrate: "2.5M",
    });
    expect(resolveOutputDimensions("1080p", "16:9")).toEqual({
      width: 1920,
      height: 1080,
      bitrate: "5M",
    });
  });

  it("1:1 方形：边长取短边", () => {
    expect(resolveOutputDimensions("480p", "1:1")).toEqual({
      width: 480,
      height: 480,
      bitrate: "1M",
    });
    expect(resolveOutputDimensions("720p", "1:1")).toEqual({
      width: 720,
      height: 720,
      bitrate: "2.5M",
    });
    expect(resolveOutputDimensions("1080p", "1:1")).toEqual({
      width: 1080,
      height: 1080,
      bitrate: "5M",
    });
  });

  it("码率始终取质量档位基准（不随画幅变化）", () => {
    expect(resolveOutputDimensions("720p", "16:9").bitrate).toBe("2.5M");
    expect(resolveOutputDimensions("720p", "1:1").bitrate).toBe("2.5M");
    expect(resolveOutputDimensions("720p", "9:16").bitrate).toBe("2.5M");
  });

  it("所有派生尺寸均为偶数（libx264 约束）", () => {
    const qualities = ["480p", "720p", "1080p"] as const;
    const ratios = ["9:16", "16:9", "1:1"] as const;
    for (const q of qualities) {
      for (const r of ratios) {
        const { width, height } = resolveOutputDimensions(q, r);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
      }
    }
  });
});
