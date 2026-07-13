import { describe, it, expect } from "vitest";
import {
  inferFacing,
  pickAssetUrlForFacing,
  type FacingAsset,
} from "@/services/generation/facing";

describe("inferFacing（朝向推断，保守规则）", () => {
  it("无任何线索时默认 front", () => {
    expect(inferFacing({})).toBe("front");
    expect(inferFacing({ description: null, cameraAngle: null })).toBe("front");
    expect(inferFacing({ description: "" })).toBe("front");
  });

  it("命中背对信号（中文）判 back", () => {
    expect(inferFacing({ description: "她转身离去，走向远处的车站" })).toBe(
      "back"
    );
    expect(inferFacing({ description: "镜头是林烬的背影" })).toBe("back");
  });

  it("命中背对信号（英文）判 back", () => {
    expect(inferFacing({ description: "shot from behind the hero" })).toBe(
      "back"
    );
    expect(inferFacing({ composition: "back to camera, walking away" })).toBe(
      "back"
    );
  });

  it("命中侧面信号判 side", () => {
    expect(inferFacing({ description: "侧脸特写，光从左侧打来" })).toBe("side");
    expect(inferFacing({ description: "a profile view of her face" })).toBe(
      "side"
    );
    expect(inferFacing({ composition: "side view, subject on the left" })).toBe(
      "side"
    );
  });

  it("背对信号优先于侧面（同时出现取 back）", () => {
    expect(inferFacing({ description: "侧身转身离去的背影" })).toBe("back");
  });

  it("普通正面描述保持 front（不误命中）", () => {
    expect(inferFacing({ description: "林烬正对镜头，面带微笑站在门口" })).toBe(
      "front"
    );
    // "profile" 词边界：不含 profile 单词的文本不误判
    expect(inferFacing({ description: "他的 profiles 页面被删除" })).toBe(
      "front"
    );
  });

  it("跨字段合并线索（cameraAngle 命中也生效）", () => {
    expect(
      inferFacing({ description: "普通描述", cameraAngle: "from behind" })
    ).toBe("back");
  });
});

describe("pickAssetUrlForFacing（按朝向挑参考图）", () => {
  const assets: FacingAsset[] = [
    { url: "front.png", pose: "front" },
    { url: "side.png", pose: "side" },
    { url: "back.png", pose: "back" },
    { url: "3q.png", pose: "3quarter" },
  ];

  it("完全匹配优先", () => {
    expect(pickAssetUrlForFacing(assets, "front")).toBe("front.png");
    expect(pickAssetUrlForFacing(assets, "side")).toBe("side.png");
    expect(pickAssetUrlForFacing(assets, "back")).toBe("back.png");
  });

  it("side 无匹配时回退 3quarter", () => {
    const noSide: FacingAsset[] = [
      { url: "front.png", pose: "front" },
      { url: "3q.png", pose: "3quarter" },
    ];
    expect(pickAssetUrlForFacing(noSide, "side")).toBe("3q.png");
  });

  it("目标无匹配、无 3quarter 时回退 front", () => {
    const onlyFront: FacingAsset[] = [
      { url: "front.png", pose: "front" },
      { url: "other.png", pose: "back" },
    ];
    expect(pickAssetUrlForFacing(onlyFront, "side")).toBe("front.png");
  });

  it("无任何匹配（含无 front）时回退第一张", () => {
    const noFront: FacingAsset[] = [
      { url: "a.png", pose: "back" },
      { url: "b.png", pose: null },
    ];
    // side 无匹配、无 3quarter、无 front → 回退第一张
    expect(pickAssetUrlForFacing(noFront, "side")).toBe("a.png");
  });

  it("空资产返回 undefined（零回归回退点）", () => {
    expect(pickAssetUrlForFacing([], "front")).toBeUndefined();
  });
});
