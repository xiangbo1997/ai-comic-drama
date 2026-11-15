import { describe, expect, it } from "vitest";
import { resolveAssistantIntent } from "@/lib/assistant-intent";

describe("助手配乐请求边界", () => {
  it.each([
    "你能直接加上背景音乐吗",
    "请给本集配上 BGM",
    "add background music",
  ])("配乐操作不能变成视觉制作：%s", (content) => {
    expect(resolveAssistantIntent(content)).toMatchObject({
      bgmOnly: true,
      allowBgmWrite: true,
      allowBgmReplace: false,
    });
  });
  it("预算追问继承最近用户目标，不继承助手编造的视觉计划", () => {
    expect(
      resolveAssistantIntent("1000", [
        { role: "user", content: "帮我加背景音乐" },
        { role: "assistant", content: "给你生成图片和视频，请提供预算" },
        { role: "user", content: "没有上限" },
      ])
    ).toMatchObject({ bgmOnly: true, allowBgmWrite: true });
  });
  it.each([
    "背景音乐怎么添加？",
    "先不要加背景音乐",
    "背景音乐哪个好？",
    "do not add background music",
    "don't change BGM",
  ])("咨询或否定不授权修改：%s", (content) => {
    expect(resolveAssistantIntent(content).allowBgmWrite).toBe(false);
  });
  it("否定换曲不能扩大成替换授权", () => {
    expect(resolveAssistantIntent("不用换曲，只调低BGM音量")).toMatchObject({
      allowBgmWrite: true,
      allowBgmReplace: false,
    });
    expect(resolveAssistantIntent("不替换BGM，只调低音量")).toMatchObject({
      allowBgmWrite: true,
      allowBgmReplace: false,
    });
  });
  it("新目标覆盖旧配乐请求，混合请求保留视觉制作能力", () => {
    expect(
      resolveAssistantIntent("现在生成视频", [
        { role: "user", content: "加BGM" },
      ]).bgmOnly
    ).toBe(false);
    expect(resolveAssistantIntent("补齐图片并添加背景音乐").bgmOnly).toBe(
      false
    );
    expect(resolveAssistantIntent("只加BGM，不要生成图片和视频").bgmOnly).toBe(
      true
    );
    expect(resolveAssistantIntent("换一首背景音乐").allowBgmReplace).toBe(true);
  });
});
