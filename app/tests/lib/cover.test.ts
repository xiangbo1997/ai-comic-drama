import { describe, it, expect } from "vitest";
import {
  resolveCoverText,
  resolveCoverSource,
  buildCoverAss,
  COVER_WIDTH,
  COVER_HEIGHT,
} from "@/lib/cover";

describe("resolveCoverText · 标题缺省解析", () => {
  it("无自定义标题时用项目名", () => {
    const r = resolveCoverText({ projectName: "逆袭人生" });
    expect(r.title).toBe("逆袭人生");
    expect(r.subtitle).toBeNull();
  });

  it("自定义标题优先于项目名", () => {
    const r = resolveCoverText({ projectName: "逆袭人生", title: "王者归来" });
    expect(r.title).toBe("王者归来");
  });

  it("项目名/标题全空时回退「无题」", () => {
    const r = resolveCoverText({ projectName: "   ", title: "  " });
    expect(r.title).toBe("无题");
  });

  it("超长标题裁到上限", () => {
    const long = "一".repeat(40);
    const r = resolveCoverText({ projectName: long });
    // 裁到 20 后按 7 字/行拆两行：7 + 7 = 14 字（第二行截断在 14）
    expect(Array.from(r.title.replace("\n", "")).length).toBeLessThanOrEqual(
      20
    );
  });

  it("短标题不折行（无 \\n）", () => {
    const r = resolveCoverText({ projectName: "逆袭" });
    expect(r.title).not.toContain("\n");
  });

  it("长标题折成两行（含 \\n，≤2 行）", () => {
    const r = resolveCoverText({ projectName: "都市至尊神医赘婿" });
    const lines = r.title.split("\n");
    expect(lines.length).toBe(2);
    expect(lines.length).toBeLessThanOrEqual(2);
  });
});

describe("resolveCoverText · 副题（集数 / 自定义）", () => {
  it("系列集数缺省给「第 N 集」", () => {
    const r = resolveCoverText({ projectName: "逆袭", episodeNumber: 3 });
    expect(r.subtitle).toBe("第 3 集");
  });

  it("集数为 0 / 负 / 非有限值不生成副题", () => {
    expect(
      resolveCoverText({ projectName: "a", episodeNumber: 0 }).subtitle
    ).toBeNull();
    expect(
      resolveCoverText({ projectName: "a", episodeNumber: -1 }).subtitle
    ).toBeNull();
    expect(
      resolveCoverText({ projectName: "a", episodeNumber: NaN }).subtitle
    ).toBeNull();
  });

  it("自定义副题优先于集数缺省", () => {
    const r = resolveCoverText({
      projectName: "逆袭",
      episodeNumber: 3,
      subtitle: "大结局",
    });
    expect(r.subtitle).toBe("大结局");
  });

  it("集数取整（浮点集数）", () => {
    const r = resolveCoverText({ projectName: "a", episodeNumber: 2.7 });
    expect(r.subtitle).toBe("第 3 集");
  });
});

describe("resolveCoverSource · 白名单校验", () => {
  const characterCanonicalUrls = ["/uploads/u/char-canonical.jpg"];
  const sceneImageUrls = ["/uploads/u/scene1.jpg", "/uploads/u/scene2.jpg"];

  it("请求 URL 命中分镜白名单则接受", () => {
    const r = resolveCoverSource({
      requestedUrl: "/uploads/u/scene2.jpg",
      characterCanonicalUrls,
      sceneImageUrls,
    });
    expect(r).toBe("/uploads/u/scene2.jpg");
  });

  it("请求 URL 命中定妆图白名单则接受", () => {
    const r = resolveCoverSource({
      requestedUrl: "/uploads/u/char-canonical.jpg",
      characterCanonicalUrls,
      sceneImageUrls,
    });
    expect(r).toBe("/uploads/u/char-canonical.jpg");
  });

  it("请求 URL 在白名单外则拒绝（返回 null，防 SSRF）", () => {
    const r = resolveCoverSource({
      requestedUrl: "https://evil.example.com/x.jpg",
      characterCanonicalUrls,
      sceneImageUrls,
    });
    expect(r).toBeNull();
  });

  it("缺省解析：主角定妆图优先于分镜", () => {
    const r = resolveCoverSource({
      characterCanonicalUrls,
      sceneImageUrls,
    });
    expect(r).toBe("/uploads/u/char-canonical.jpg");
  });

  it("缺省解析：无定妆图时用首张有图分镜", () => {
    const r = resolveCoverSource({
      characterCanonicalUrls: [],
      sceneImageUrls,
    });
    expect(r).toBe("/uploads/u/scene1.jpg");
  });

  it("完全无图源时返回 null", () => {
    const r = resolveCoverSource({
      characterCanonicalUrls: [],
      sceneImageUrls: [],
    });
    expect(r).toBeNull();
  });

  it("空字符串请求 URL 视为缺省（走自动解析，不当白名单命中）", () => {
    const r = resolveCoverSource({
      requestedUrl: "",
      characterCanonicalUrls,
      sceneImageUrls,
    });
    expect(r).toBe("/uploads/u/char-canonical.jpg");
  });
});

describe("buildCoverAss · ASS 组装", () => {
  it("含标题事件且规格为竖屏 1080×1920", () => {
    const ass = buildCoverAss({ title: "逆袭人生", subtitle: null });
    expect(ass).toContain(`PlayResX: ${COVER_WIDTH}`);
    expect(ass).toContain(`PlayResY: ${COVER_HEIGHT}`);
    expect(ass).toContain("CoverTitle");
    expect(ass).toContain("逆袭人生");
  });

  it("有副题时含 CoverSub 事件", () => {
    const ass = buildCoverAss({ title: "逆袭", subtitle: "第 2 集" });
    expect(ass).toContain("CoverSub");
    expect(ass).toContain("第 2 集");
  });

  it("无副题时不含 CoverSub 事件行", () => {
    const ass = buildCoverAss({ title: "逆袭", subtitle: null });
    const hasSubEvent = ass
      .split("\n")
      .some((l) => l.startsWith("Dialogue") && l.includes("CoverSub"));
    expect(hasSubEvent).toBe(false);
  });

  it("两行标题的换行转成 \\N", () => {
    const ass = buildCoverAss({ title: "都市至尊\n神医赘婿", subtitle: null });
    expect(ass).toContain("都市至尊\\N神医赘婿");
  });

  it("转义用户文本中的大括号（防 ASS 标签注入）", () => {
    const ass = buildCoverAss({ title: "标题{恶意}", subtitle: null });
    expect(ass).toContain("标题\\{恶意\\}");
  });
});
