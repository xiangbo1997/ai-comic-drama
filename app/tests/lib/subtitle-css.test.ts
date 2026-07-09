import { describe, it, expect } from "vitest";
import {
  SUBTITLE_KEYFRAMES_CSS,
  getSubtitleAnimationCss,
} from "@/lib/subtitle-css";
import { SUBTITLE_ANIM } from "@/lib/subtitle-segments";

describe("getSubtitleAnimationCss（预览 CSS 动效简写，须与 SUBTITLE_ANIM 时序一致）", () => {
  it("none → undefined（无整体动画）", () => {
    expect(getSubtitleAnimationCss("none")).toBeUndefined();
  });

  it("typewriter → undefined（逐字 span 各自驱动，<p> 不加整体动画）", () => {
    expect(getSubtitleAnimationCss("typewriter")).toBeUndefined();
  });

  it("fade → subtitleFadeIn，时长取 fadeMs", () => {
    expect(getSubtitleAnimationCss("fade")).toBe(
      `subtitleFadeIn ${SUBTITLE_ANIM.fadeMs}ms linear`
    );
  });

  it("缺省（undefined 回退 fade）与 fade 一致", () => {
    expect(getSubtitleAnimationCss(undefined)).toBe(
      getSubtitleAnimationCss("fade")
    );
  });

  it("slideup → subtitleSlideUp，时长取 slideUpMs", () => {
    expect(getSubtitleAnimationCss("slideup")).toBe(
      `subtitleSlideUp ${SUBTITLE_ANIM.slideUpMs}ms ease-out`
    );
  });

  it("pop → subtitlePop，时长取 popMs", () => {
    expect(getSubtitleAnimationCss("pop")).toBe(
      `subtitlePop ${SUBTITLE_ANIM.popMs}ms cubic-bezier(0.34,1.56,0.64,1)`
    );
  });
});

describe("SUBTITLE_KEYFRAMES_CSS（关键帧定义，须含四个动画名 + pop 起始缩放来自常量）", () => {
  it("包含四个关键帧名", () => {
    for (const name of [
      "subtitleFadeIn",
      "subtitleSlideUp",
      "subtitlePop",
      "subtitleCharReveal",
    ]) {
      expect(SUBTITLE_KEYFRAMES_CSS).toContain(`@keyframes ${name}`);
    }
  });

  it("pop 起始缩放取 SUBTITLE_ANIM.popStartScale", () => {
    expect(SUBTITLE_KEYFRAMES_CSS).toContain(
      `scale(${SUBTITLE_ANIM.popStartScale})`
    );
  });
});
