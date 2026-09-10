import { describe, it, expect } from "vitest";
import {
  MAX_RESULT_CHARS,
  stripMediaUrls,
  toResourceJson,
  toSceneTextView,
} from "@/lib/mcp/serialize";

/**
 * 核心约束：MCP 返回给模型的内容里**不能出现媒体 URL**。
 * 模型打不开那些链接，给了只会诱导它编造对画面的判断。
 */
describe("stripMediaUrls()", () => {
  it("剔除顶层媒体 URL 字段", () => {
    const out = stripMediaUrls({
      id: "s1",
      description: "主角推门而入",
      imageUrl: "https://cdn.example.com/a.png",
      videoUrl: "https://cdn.example.com/a.mp4",
      audioUrl: "https://cdn.example.com/a.mp3",
    });
    expect(out).toEqual({ id: "s1", description: "主角推门而入" });
  });

  it("递归剔除嵌套结构里的媒体 URL", () => {
    const out = stripMediaUrls({
      scenes: [
        { order: 0, description: "开场", imageUrl: "https://x/1.png" },
        { order: 1, description: "冲突", videoUrl: "https://x/2.mp4" },
      ],
      cover: { title: "片头", coverImageUrl: "https://x/c.png" },
    });
    expect(out).toEqual({
      scenes: [
        { order: 0, description: "开场" },
        { order: 1, description: "冲突" },
      ],
      cover: { title: "片头" },
    });
  });

  it("剔除自由形状 Json 里的媒体 URL（scriptDoc 这类列的兜底）", () => {
    const out = stripMediaUrls({
      scriptDoc: {
        scenes: [{ desc: "x", thumbnailUrl: "https://x/t.png" }],
        gridImageUrl: "https://x/g.png",
      },
    });
    expect(JSON.stringify(out)).not.toContain("http");
  });

  it("保留非媒体字段与各类原始值", () => {
    const out = stripMediaUrls({
      order: 0,
      duration: 3.5,
      isClimax: true,
      dialogue: null,
      tags: ["a", "b"],
    });
    expect(out).toEqual({
      order: 0,
      duration: 3.5,
      isClimax: true,
      dialogue: null,
      tags: ["a", "b"],
    });
  });

  it("referenceImages 数组也剔除（角色参考图链接）", () => {
    const out = stripMediaUrls({
      name: "林小满",
      referenceImages: ["https://x/1.png", "https://x/2.png"],
    });
    expect(out).toEqual({ name: "林小满" });
  });
});

describe("toSceneTextView()", () => {
  const raw = {
    id: "s1",
    order: 0,
    shotType: "近景",
    description: "主角推门而入",
    dialogue: "你终于来了",
    narration: null,
    emotion: "tense",
    duration: 3,
    cameraMovement: "push_in",
    imageStatus: "COMPLETED",
    videoStatus: "PENDING",
    audioStatus: "PENDING",
  };

  it("只保留文本字段与三个生成状态", () => {
    const view = toSceneTextView(raw);
    expect(view).toEqual(raw);
  });

  it("用 *Status 表达进度，而不是给出图片链接", () => {
    const view = toSceneTextView(raw);
    expect(view.imageStatus).toBe("COMPLETED");
    expect(JSON.stringify(view)).not.toContain("http");
    expect(view).not.toHaveProperty("imageUrl");
  });
});

describe("toResourceJson()", () => {
  it("包成 MCP contents 结构并走一遍剥离", () => {
    const out = toResourceJson("comic://project/p1", {
      title: "第一集",
      coverImageUrl: "https://x/c.png",
    });
    expect(out.contents).toHaveLength(1);
    expect(out.contents[0].uri).toBe("comic://project/p1");
    expect(out.contents[0].mimeType).toBe("application/json");
    expect(out.contents[0].text).not.toContain("coverImageUrl");
    expect(out.contents[0].text).toContain("第一集");
  });

  it("内容不超限时不挂 _meta", () => {
    const out = toResourceJson("comic://x", { a: 1 });
    expect(out._meta).toBeUndefined();
  });

  it("超出软上限时标注 maxResultSizeChars，提示改用分页", () => {
    const big = { blob: "字".repeat(MAX_RESULT_CHARS) };
    const out = toResourceJson("comic://x", big);
    expect(out._meta).toEqual({
      "anthropic/maxResultSizeChars": MAX_RESULT_CHARS,
    });
  });
});
