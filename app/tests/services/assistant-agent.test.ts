import { beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), tools: vi.fn() }));
vi.mock("@/lib/url-guard", () => ({ safeFetch: mocks.fetch }));
vi.mock("@/lib/observability/langfuse", () => ({
  observeLLM: async (_: unknown, action: () => Promise<unknown>) => action(),
}));
vi.mock("@/services/assistant-tools", () => ({
  createAssistantTools: mocks.tools,
}));
import { runAssistantAgent } from "@/services/assistant-agent";

const input = {
  messages: [{ role: "user" as const, content: "把标题改为回声" }],
  config: {
    model: "gpt-test",
    protocol: "openai" as const,
    apiKey: "private-key",
    baseUrl: "https://models.example/v1",
  },
  userId: "u1",
  projectId: "p1",
  requestId: "r1",
};
const completion = (message: object, reason = "stop") =>
  new Response(
    JSON.stringify({
      id: "reply",
      object: "chat.completion",
      created: 1,
      model: "gpt-test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", ...message },
          finish_reason: reason,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
    { headers: { "Content-Type": "application/json" } }
  );
beforeEach(() => vi.clearAllMocks());
describe("助手模型工具循环", () => {
  it("实际执行模型工具调用，再携带结果请求最终 Markdown 答复", async () => {
    const receipts: string[] = [];
    const execute = vi.fn(async () => {
      receipts.push("已保存标题：回声");
      return { success: true };
    });
    mocks.tools.mockReturnValue({
      tools: {
        update_project: tool({
          inputSchema: z.object({ title: z.string() }),
          execute,
        }),
      },
      receipts,
      sources: [],
    });
    mocks.fetch
      .mockResolvedValueOnce(
        completion(
          {
            content: null,
            tool_calls: [
              {
                id: "call1",
                type: "function",
                function: {
                  name: "update_project",
                  arguments: '{"title":"回声"}',
                },
              },
            ],
          },
          "tool_calls"
        )
      )
      .mockResolvedValueOnce(completion({ content: "**标题已更新**" }));
    const result = await runAssistantAgent(input);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const second = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(
      second.messages.some(
        (message: { role: string }) => message.role === "tool"
      )
    ).toBe(true);
    expect(result.content).toContain("**标题已更新**");
    expect(result.content).toContain("已保存标题：回声");
    expect(mocks.tools).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", projectId: "p1" })
    );
  });
  it("保存后模型失败仍返回真实回执，且不自动重试上游", async () => {
    const receipts: string[] = [];
    mocks.tools.mockReturnValue({
      tools: {
        save: tool({
          inputSchema: z.object({}),
          execute: async () => {
            receipts.push("已保存分镜");
            return { success: true };
          },
        }),
      },
      receipts,
      sources: [],
    });
    mocks.fetch
      .mockResolvedValueOnce(
        completion(
          {
            content: null,
            tool_calls: [
              {
                id: "call1",
                type: "function",
                function: { name: "save", arguments: "{}" },
              },
            ],
          },
          "tool_calls"
        )
      )
      .mockRejectedValueOnce(new Error("private-upstream-failure"));
    const result = await runAssistantAgent(input);
    expect(result.content).toContain("已保存分镜");
    expect(result.content).not.toContain("private-upstream");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("Claude 和 Gemini 使用各自协议传递工具定义", async () => {
    mocks.tools.mockReturnValue({
      tools: {
        inspect: tool({
          inputSchema: z.object({}),
          execute: async () => ({ ok: true }),
        }),
      },
      receipts: [],
      sources: [],
    });
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "a",
          type: "message",
          role: "assistant",
          model: "claude-test",
          content: [{ type: "text", text: "已读取" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    await runAssistantAgent({
      ...input,
      config: { ...input.config, protocol: "claude", model: "claude-test" },
    });
    expect(mocks.fetch.mock.calls[0][0]).toBe(
      "https://models.example/v1/messages"
    );
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).tools[0].name).toBe(
      "inspect"
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { role: "model", parts: [{ text: "已读取" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    );
    await runAssistantAgent({
      ...input,
      config: { ...input.config, protocol: "gemini", model: "gemini-test" },
    });
    expect(mocks.fetch.mock.calls[1][0]).toContain(
      "/models/gemini-test:generateContent"
    );
    expect(
      JSON.parse(mocks.fetch.mock.calls[1][1].body).tools[0]
        .functionDeclarations[0].name
    ).toBe("inspect");
  });
});
