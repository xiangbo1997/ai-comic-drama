import { describe, it, expect } from "vitest";
import {
  resolveSubtitleFont,
  SUBTITLE_FONTS,
  DEFAULT_SUBTITLE_FONT_ID,
  TITLE_FONT_ID,
} from "@/lib/subtitle-fonts";

describe("resolveSubtitleFont · 白名单解析", () => {
  it("命中白名单 id 返回对应字体（assFontName + serverFile）", () => {
    const font = resolveSubtitleFont("source-han-sans");
    expect(font.id).toBe("source-han-sans");
    expect(font.assFontName).toBe("Source Han Sans CN");
    expect(font.serverFile).toBe("fonts/SourceHanSansCN-Regular.otf");
  });

  it("得意黑（标题字体）可解析", () => {
    const font = resolveSubtitleFont("smiley-sans");
    expect(font.id).toBe("smiley-sans");
    expect(font.assFontName).toBe("Smiley Sans Oblique");
  });

  it("白名单外的值一律回退默认字体（防任意字符串注入 ASS）", () => {
    const fallback = resolveSubtitleFont("../evil/font");
    expect(fallback.id).toBe(DEFAULT_SUBTITLE_FONT_ID);
    expect(resolveSubtitleFont("Arial").id).toBe(DEFAULT_SUBTITLE_FONT_ID);
    expect(resolveSubtitleFont("").id).toBe(DEFAULT_SUBTITLE_FONT_ID);
  });

  it("缺省 / null / undefined → 默认字体", () => {
    expect(resolveSubtitleFont(null).id).toBe(DEFAULT_SUBTITLE_FONT_ID);
    expect(resolveSubtitleFont(undefined).id).toBe(DEFAULT_SUBTITLE_FONT_ID);
  });
});

describe("字体常量契约", () => {
  it("默认字体 id 在白名单内", () => {
    expect(SUBTITLE_FONTS.some((f) => f.id === DEFAULT_SUBTITLE_FONT_ID)).toBe(
      true
    );
  });

  it("标题字体 id 在白名单内", () => {
    expect(SUBTITLE_FONTS.some((f) => f.id === TITLE_FONT_ID)).toBe(true);
  });

  it("每款字体都有 assFontName / cssFamily / webFile / serverFile", () => {
    for (const f of SUBTITLE_FONTS) {
      expect(f.assFontName.length).toBeGreaterThan(0);
      expect(f.cssFamily.length).toBeGreaterThan(0);
      expect(f.webFile.startsWith("/fonts/")).toBe(true);
      expect(f.serverFile.startsWith("fonts/")).toBe(true);
    }
  });
});
