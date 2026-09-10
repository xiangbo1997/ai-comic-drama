import { describe, it, expect } from "vitest";
import {
  isAnchorOutsideThreeViews,
  pickCanonicalUpgradeUrl,
  shouldSuggestCanonicalUpgrade,
  resolveAnchorPose,
} from "@/lib/canonical-anchor";

const VIEWS = [
  { pose: "front", url: "https://x/front.webp" },
  { pose: "side", url: "https://x/side.webp" },
  { pose: "back", url: "https://x/back.webp" },
];
const VIEW_URLS = VIEWS.map((v) => v.url);

describe("isAnchorOutsideThreeViews", () => {
  it("锚是拼贴图等三视图之外的图 → true（线上真实场景）", () => {
    expect(
      isAnchorOutsideThreeViews("https://x/collage-sheet.webp", VIEW_URLS)
    ).toBe(true);
  });

  it("锚已是三视图之一 → false（不打扰）", () => {
    expect(isAnchorOutsideThreeViews("https://x/front.webp", VIEW_URLS)).toBe(
      false
    );
    expect(isAnchorOutsideThreeViews("https://x/back.webp", VIEW_URLS)).toBe(
      false
    );
  });

  it("无锚 / 空白锚 → false（属于补锚而非升级）", () => {
    expect(isAnchorOutsideThreeViews(null, VIEW_URLS)).toBe(false);
    expect(isAnchorOutsideThreeViews(undefined, VIEW_URLS)).toBe(false);
    expect(isAnchorOutsideThreeViews("", VIEW_URLS)).toBe(false);
    expect(isAnchorOutsideThreeViews("   ", VIEW_URLS)).toBe(false);
  });

  it("锚带首尾空白但实为三视图之一 → false（trim 后比较）", () => {
    expect(
      isAnchorOutsideThreeViews("  https://x/front.webp  ", VIEW_URLS)
    ).toBe(false);
  });

  it("三视图列表为空 → 有锚即视为不在其中", () => {
    expect(isAnchorOutsideThreeViews("https://x/a.webp", [])).toBe(true);
  });
});

describe("pickCanonicalUpgradeUrl", () => {
  it("取正面图", () => {
    expect(pickCanonicalUpgradeUrl(VIEWS)).toBe("https://x/front.webp");
  });

  it("缺正面图 → undefined（不拿侧/背图凑，背影当锚会让所有镜头缺脸）", () => {
    expect(
      pickCanonicalUpgradeUrl([
        { pose: "side", url: "https://x/side.webp" },
        { pose: "back", url: "https://x/back.webp" },
      ])
    ).toBeUndefined();
  });

  it("空列表 → undefined", () => {
    expect(pickCanonicalUpgradeUrl([])).toBeUndefined();
  });
});

describe("shouldSuggestCanonicalUpgrade", () => {
  it("已有锚且锚不在三视图里 → 建议升级为正面图", () => {
    expect(
      shouldSuggestCanonicalUpgrade("https://x/collage-sheet.webp", VIEWS)
    ).toEqual({ suggest: true, suggestedUrl: "https://x/front.webp" });
  });

  it("锚已是本次正面图 → 不建议", () => {
    expect(
      shouldSuggestCanonicalUpgrade("https://x/front.webp", VIEWS)
    ).toEqual({ suggest: false });
  });

  it("锚是本次侧视图 → 不建议（用户可能有意选的，不越权改）", () => {
    expect(shouldSuggestCanonicalUpgrade("https://x/side.webp", VIEWS)).toEqual(
      {
        suggest: false,
      }
    );
  });

  it("原本无锚 → 不建议（生成流程已直接补锚，无需打扰）", () => {
    expect(shouldSuggestCanonicalUpgrade(null, VIEWS)).toEqual({
      suggest: false,
    });
    expect(shouldSuggestCanonicalUpgrade("", VIEWS)).toEqual({
      suggest: false,
    });
  });

  it("本次没出正面图 → 不建议，即使锚是外部图", () => {
    expect(
      shouldSuggestCanonicalUpgrade("https://x/collage-sheet.webp", [
        { pose: "side", url: "https://x/side.webp" },
      ])
    ).toEqual({ suggest: false });
  });
});

describe("resolveAnchorPose", () => {
  it("已有合法 pose → 保留（把侧视图提为锚时不能谎称是正面）", () => {
    expect(resolveAnchorPose("side")).toBe("side");
    expect(resolveAnchorPose("back")).toBe("back");
    expect(resolveAnchorPose("front")).toBe("front");
  });

  it("无 pose / 空白 / 非三视图取值 → 默认 front（与首图补锚既有行为一致）", () => {
    expect(resolveAnchorPose(null)).toBe("front");
    expect(resolveAnchorPose(undefined)).toBe("front");
    expect(resolveAnchorPose("")).toBe("front");
    expect(resolveAnchorPose("  ")).toBe("front");
    expect(resolveAnchorPose("three_quarter")).toBe("front");
  });

  it("pose 带首尾空白但合法 → trim 后保留", () => {
    expect(resolveAnchorPose("  back  ")).toBe("back");
  });
});
