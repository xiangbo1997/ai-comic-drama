/**
 * 导出进度写入的 output 合并语义（P0 竞态回归测试）。
 *
 * 背景：task.output 是 Json 列，Prisma 整值覆盖写。此前进度回调直接写
 * { progress }，一条在途进度写若落在 COMPLETED 之后，就会把 videoUrl/size
 * 整体抹掉——前端看到「导出成功」却拿不到视频。修复是读-合并 +
 * status=PROCESSING 条件更新，这里锁住合并侧的语义。
 */

import { describe, it, expect } from "vitest";
import { mergeProgressIntoOutput } from "@/lib/export-progress";

describe("mergeProgressIntoOutput", () => {
  it("保留已有的 videoUrl / size，只更新 progress", () => {
    const prev = { videoUrl: "https://cdn/x.mp4", size: 1024, progress: 60 };
    expect(mergeProgressIntoOutput(prev, 80)).toEqual({
      videoUrl: "https://cdn/x.mp4",
      size: 1024,
      progress: 80,
    });
  });

  it("output 为 null（任务刚建、还没写过）时产出仅含 progress", () => {
    expect(mergeProgressIntoOutput(null, 25)).toEqual({ progress: 25 });
  });

  it("output 为 undefined 时同样安全", () => {
    expect(mergeProgressIntoOutput(undefined, 0)).toEqual({ progress: 0 });
  });

  it("非对象脏值（字符串/数组）一律丢弃，不产出脏结构", () => {
    expect(mergeProgressIntoOutput("broken", 50)).toEqual({ progress: 50 });
    expect(mergeProgressIntoOutput([1, 2], 50)).toEqual({ progress: 50 });
  });

  it("不改动传入对象（无副作用）", () => {
    const prev = { videoUrl: "https://cdn/x.mp4", progress: 10 };
    mergeProgressIntoOutput(prev, 90);
    expect(prev.progress).toBe(10);
  });

  it("progress 为 100 时也只是普通合并，不特殊对待", () => {
    expect(
      mergeProgressIntoOutput({ videoUrl: "https://cdn/x.mp4" }, 100)
    ).toEqual({ videoUrl: "https://cdn/x.mp4", progress: 100 });
  });
});
