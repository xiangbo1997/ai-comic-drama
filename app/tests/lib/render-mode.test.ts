import { describe, it, expect } from "vitest";
import {
  recommendRenderMode,
  resolveDefaultMotion,
  summarizeRenderPlan,
} from "@/lib/render-mode";
import { CAMERA_MOVEMENTS } from "@/lib/prompts/video-prompt";

describe("recommendRenderMode — beatType 触发", () => {
  it("impact / reveal → video", () => {
    expect(recommendRenderMode({ beatType: "impact" })).toBe("video");
    expect(recommendRenderMode({ beatType: "reveal" })).toBe("video");
  });

  it("emotional / calm / 空 → 不因 beat 触发（回落 motion）", () => {
    expect(recommendRenderMode({ beatType: "emotional" })).toBe("motion");
    expect(recommendRenderMode({ beatType: "calm" })).toBe("motion");
    expect(recommendRenderMode({ beatType: null })).toBe("motion");
    expect(recommendRenderMode({})).toBe("motion");
  });
});

describe("recommendRenderMode — isClimax 触发", () => {
  it("isClimax=true → video", () => {
    expect(recommendRenderMode({ isClimax: true })).toBe("video");
  });

  it("isClimax=false / null / 缺省 → 不触发", () => {
    expect(recommendRenderMode({ isClimax: false })).toBe("motion");
    expect(recommendRenderMode({ isClimax: null })).toBe("motion");
    expect(recommendRenderMode({})).toBe("motion");
  });
});

describe("recommendRenderMode — 13 运镜枚举各自归属", () => {
  // 判据表：zoompan 可表达（缩放/平移/静止/俯仰）→ motion；
  // 需视差/主体独立运动（dolly/orbit/tracking/handheld/crane）→ video。
  const expected: Record<
    (typeof CAMERA_MOVEMENTS)[number],
    "video" | "motion"
  > = {
    static: "motion",
    zoom_in: "motion",
    zoom_out: "motion",
    pan_left: "motion",
    pan_right: "motion",
    tilt_up: "motion",
    tilt_down: "motion",
    dolly_in: "video",
    dolly_out: "video",
    orbit: "video",
    tracking: "video",
    handheld: "video",
    crane: "video",
  };

  it("枚举表覆盖全部 13 值（枚举漂移即失败）", () => {
    expect(Object.keys(expected).sort()).toEqual([...CAMERA_MOVEMENTS].sort());
  });

  for (const movement of CAMERA_MOVEMENTS) {
    it(`${movement} → ${expected[movement]}`, () => {
      expect(recommendRenderMode({ cameraMovement: movement })).toBe(
        expected[movement]
      );
    });
  }
});

describe("recommendRenderMode — 脏数据 / 优先级", () => {
  it("非法运镜值不因运镜触发 video（保守回落 motion）", () => {
    expect(recommendRenderMode({ cameraMovement: "explode" })).toBe("motion");
    expect(recommendRenderMode({ cameraMovement: "" })).toBe("motion");
    expect(recommendRenderMode({ cameraMovement: null })).toBe("motion");
  });

  it("beat/climax 优先于运镜：静止镜若是高潮镜仍走 video", () => {
    expect(
      recommendRenderMode({ cameraMovement: "static", isClimax: true })
    ).toBe("video");
    expect(
      recommendRenderMode({ cameraMovement: "zoom_in", beatType: "impact" })
    ).toBe("video");
  });
});

describe("resolveDefaultMotion", () => {
  it("四个可映射运镜 → 对应 SceneMotion", () => {
    expect(resolveDefaultMotion("zoom_in")).toBe("zoomIn");
    expect(resolveDefaultMotion("zoom_out")).toBe("zoomOut");
    expect(resolveDefaultMotion("pan_left")).toBe("panLeft");
    expect(resolveDefaultMotion("pan_right")).toBe("panRight");
  });

  it("无精确映射的运镜 → null（调用方回落 zoomIn）", () => {
    expect(resolveDefaultMotion("static")).toBeNull();
    expect(resolveDefaultMotion("tilt_up")).toBeNull();
    expect(resolveDefaultMotion("tilt_down")).toBeNull();
    expect(resolveDefaultMotion("dolly_in")).toBeNull();
    expect(resolveDefaultMotion("orbit")).toBeNull();
    expect(resolveDefaultMotion("tracking")).toBeNull();
    expect(resolveDefaultMotion("handheld")).toBeNull();
    expect(resolveDefaultMotion("crane")).toBeNull();
  });

  it("空值 / 非法值 → null", () => {
    expect(resolveDefaultMotion(null)).toBeNull();
    expect(resolveDefaultMotion(undefined)).toBeNull();
    expect(resolveDefaultMotion("")).toBeNull();
    expect(resolveDefaultMotion("bogus")).toBeNull();
  });
});

describe("summarizeRenderPlan", () => {
  it("统计视频/运镜镜数并列出视频镜 id", () => {
    const plan = summarizeRenderPlan([
      { id: "s1", beatType: "impact" }, // video
      { id: "s2", isClimax: true }, // video
      { id: "s3", cameraMovement: "dolly_in" }, // video
      { id: "s4", cameraMovement: "zoom_in" }, // motion
      { id: "s5", beatType: "emotional" }, // motion
      { id: "s6" }, // motion
    ]);
    expect(plan.videoCount).toBe(3);
    expect(plan.motionCount).toBe(3);
    expect(plan.videoSceneIds).toEqual(["s1", "s2", "s3"]);
  });

  it("空数组 → 全零", () => {
    expect(summarizeRenderPlan([])).toEqual({
      videoCount: 0,
      motionCount: 0,
      videoSceneIds: [],
    });
  });

  it("不 mutate 入参", () => {
    const scenes = [{ id: "s1", beatType: "impact" }];
    const snapshot = JSON.parse(JSON.stringify(scenes));
    summarizeRenderPlan(scenes);
    expect(scenes).toEqual(snapshot);
  });
});
