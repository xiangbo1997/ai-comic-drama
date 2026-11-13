import { describe, expect, it, vi } from "vitest";
import { buildDramaScriptUserPrompt } from "@/lib/prompts/agent-prompts/drama-script";
import { buildStoryboardTableUserPrompt } from "@/lib/prompts/agent-prompts/storyboard-table";
import type { DramaScriptArtifact } from "@/types/drama";
import type { WorkflowContext } from "@/services/agents/types";

vi.mock("@/services/ai", async () => {
  const { isTimeoutAbortError } = await import("@/services/ai/abort");
  return {
    chatCompletion: vi.fn(),
    LONG_FORM_LLM_TIMEOUT_MS: 300_000,
    isTimeoutAbortError,
  };
});

import { chatCompletion } from "@/services/ai";
import { DramaScriptAgent } from "@/services/agents/drama-script-agent";

function readExample(prompt: string) {
  return JSON.parse(prompt.split("输出格式：\n")[1]);
}

describe("创作提示词的输出示例可直接遵循", () => {
  it.each([10, 30, 60, 90, 180, 600])(
    "%s 秒创作的示例是合法 JSON，节拍按目标时长排序且不越界",
    (durationSec) => {
      const example = readExample(
        buildDramaScriptUserPrompt({ worldview: "海底图书馆", durationSec })
      );
      expect(example.durationSec).toBe(durationSec);
      const times: number[] = example.beatSheet.map(
        (beat: { atSec: number }) => beat.atSec
      );
      expect(times[0]).toBeLessThanOrEqual(3);
      expect(times.at(-1)).toBeGreaterThanOrEqual(durationSec * 0.8);
      expect(times.every((time) => time >= 0 && time < durationSec)).toBe(true);
      expect(times.every((time, i) => i === 0 || time > times[i - 1])).toBe(
        true
      );
      expect(example.scenes[0].dialogue).toBeTypeOf("string");
      expect(example.scenes[0].narration).toBeNull();
    }
  );

  it("格式示例中的用户参数含引号、换行时仍是合法 JSON", () => {
    const example = readExample(
      buildDramaScriptUserPrompt({
        worldview: "海底图书馆",
        style: '水彩"梦境\n风',
        aspectRatio: '9:16"',
      })
    );
    expect(example.style).toBe('水彩"梦境\n风');
    expect(example.aspectRatio).toBe('9:16"');
  });

  it("默认 90 秒示例与实际默认目标一致", () => {
    const example = readExample(
      buildDramaScriptUserPrompt({ worldview: "海底图书馆" })
    );
    expect(example.durationSec).toBe(90);
  });

  it.each([10, 30, 60, 90, 180, 600])(
    "%s 秒字段示例通过真实创作 Agent 的生产 schema，不触发修复重试",
    async (durationSec) => {
      const input = { worldview: "海底图书馆", durationSec };
      const example = readExample(buildDramaScriptUserPrompt(input));
      const mockedChat = vi.mocked(chatCompletion);
      mockedChat.mockReset();
      mockedChat.mockResolvedValueOnce(JSON.stringify(example));
      const context = {
        config: { mode: "auto", maxImageReflectionRounds: 0, style: "anime" },
      } as WorkflowContext;
      const result = await new DramaScriptAgent().run(input, context);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);
      expect(result.data).toEqual(example);
      expect(mockedChat).toHaveBeenCalledTimes(1);
    }
  );

  it("九宫格示例不再示范违背开场钩子要求的风景空镜", () => {
    const script: DramaScriptArtifact = {
      filmTitle: "末班列车",
      genre: "悬疑",
      durationSec: 30,
      aspectRatio: "9:16",
      style: "anime",
      protagonist: "检票员",
      worldview: "无人列车",
      logline: "检票员发现自己的死亡车票",
      scenes: [],
    };
    const example = readExample(buildStoryboardTableUserPrompt(script));
    expect(example.cells[0].shot).not.toContain("大全景");
    expect(example.cells[0].closeup).not.toContain("壮阔全景");
  });
});
