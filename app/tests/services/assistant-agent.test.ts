import { beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  tools: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ warn: mocks.warn, info: mocks.info }),
}));
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
beforeEach(() => vi.resetAllMocks());
describe("助手模型工具循环", () => {
  it("文字编辑仍可继续处理并携带结果生成最终答复", async () => {
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
    expect(result.content).not.toContain("生成失败");
  });
  it("制作计划成功立即结束，不再请求可能超时的模型总结", async () => {
    const receipts: string[] = [];
    mocks.tools.mockReturnValue({
      tools: {
        plan_production: tool({
          inputSchema: z.object({}),
          execute: async () => {
            receipts.push("已创建计划，尚未开始制作");
            return { id: "plan", status: "planned" };
          },
        }),
      },
      receipts,
      sources: [],
      shouldStop: () => receipts.length > 0,
    });
    mocks.fetch.mockResolvedValueOnce(
      completion(
        {
          content: null,
          tool_calls: [
            {
              id: "plan",
              type: "function",
              function: { name: "plan_production", arguments: "{}" },
            },
          ],
        },
        "tool_calls"
      )
    );
    const result = await runAssistantAgent(input);
    expect(result.content).toContain("已创建计划，尚未开始制作");
    expect(result.content).not.toContain("失败");
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("只读工具仍携带结果让模型作答", async () => {
    mocks.tools.mockReturnValue({
      tools: {
        inspect: tool({
          inputSchema: z.object({}),
          execute: async () => ({ title: "当前作品" }),
        }),
      },
      receipts: [],
      sources: [],
    });
    mocks.fetch
      .mockResolvedValueOnce(
        completion(
          {
            content: null,
            tool_calls: [
              {
                id: "read",
                type: "function",
                function: { name: "inspect", arguments: "{}" },
              },
            ],
          },
          "tool_calls"
        )
      )
      .mockResolvedValueOnce(completion({ content: "**已读取真实作品**" }));
    expect((await runAssistantAgent(input)).content).toContain(
      "**已读取真实作品**"
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("只读调用超时给出可识别错误，日志不含供应商私密正文", async () => {
    mocks.tools.mockReturnValue({ tools: {}, receipts: [], sources: [] });
    mocks.fetch.mockRejectedValueOnce(
      new DOMException("private-key-and-prompt", "TimeoutError")
    );
    await expect(runAssistantAgent(input)).rejects.toMatchObject({
      name: "AssistantModelTimeoutError",
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      "private-key-and-prompt"
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).toContain("r1");
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
