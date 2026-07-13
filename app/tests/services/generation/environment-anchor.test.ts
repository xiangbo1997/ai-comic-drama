import { describe, it, expect } from "vitest";
import {
  pickAnchorScene,
  type AnchorSiblingScene,
} from "@/services/generation/environment-anchor-select";

describe("pickAnchorScene（同地点场景锚挑选）", () => {
  it("取 order < 当前、已出图、order 最小者（最早建立镜头）", () => {
    const siblings: AnchorSiblingScene[] = [
      { id: "s0", order: 0, imageUrl: "a.png" },
      { id: "s1", order: 1, imageUrl: "b.png" },
      { id: "s3", order: 3, imageUrl: "d.png" },
    ];
    const anchor = pickAnchorScene({ id: "s5", order: 5 }, siblings);
    expect(anchor).toEqual({ id: "s0", imageUrl: "a.png" });
  });

  it("跳过 order >= 当前的兄弟（自身与其后不能当锚）", () => {
    const siblings: AnchorSiblingScene[] = [
      { id: "s5", order: 5, imageUrl: "self.png" },
      { id: "s6", order: 6, imageUrl: "later.png" },
      { id: "s2", order: 2, imageUrl: "earlier.png" },
    ];
    const anchor = pickAnchorScene({ id: "s5", order: 5 }, siblings);
    expect(anchor).toEqual({ id: "s2", imageUrl: "earlier.png" });
  });

  it("跳过未出图（imageUrl 为空）的兄弟", () => {
    const siblings: AnchorSiblingScene[] = [
      { id: "s0", order: 0, imageUrl: null },
      { id: "s1", order: 1, imageUrl: "" },
      { id: "s2", order: 2, imageUrl: "c.png" },
    ];
    const anchor = pickAnchorScene({ id: "s5", order: 5 }, siblings);
    expect(anchor).toEqual({ id: "s2", imageUrl: "c.png" });
  });

  it("无合格候选返回 null", () => {
    expect(pickAnchorScene({ id: "s5", order: 5 }, [])).toBeNull();
    const onlyLaterOrEmpty: AnchorSiblingScene[] = [
      { id: "s6", order: 6, imageUrl: "later.png" },
      { id: "s0", order: 0, imageUrl: null },
    ];
    expect(
      pickAnchorScene({ id: "s5", order: 5 }, onlyLaterOrEmpty)
    ).toBeNull();
  });

  it("多个合格候选取 order 最小者（稳定优先最早）", () => {
    const siblings: AnchorSiblingScene[] = [
      { id: "s4", order: 4, imageUrl: "d.png" },
      { id: "s1", order: 1, imageUrl: "a.png" },
      { id: "s3", order: 3, imageUrl: "c.png" },
    ];
    const anchor = pickAnchorScene({ id: "s9", order: 9 }, siblings);
    expect(anchor).toEqual({ id: "s1", imageUrl: "a.png" });
  });
});
