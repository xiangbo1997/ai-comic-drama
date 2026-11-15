import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { rateLimiters } from "@/lib/rate-limit";
import {
  resolveAssistantScope,
  sendAssistantMessage,
  updateAssistantMemory,
} from "@/services/assistant-store";
import { GET } from "@/app/api/assistant/route";
import { POST, DELETE } from "@/app/api/assistant/messages/route";
import { PATCH } from "@/app/api/assistant/memory/route";
import { assistantBody } from "@/lib/assistant-api";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: vi.fn(), imageGeneration: vi.fn() },
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/services/assistant-store", () => ({
  AssistantStoreError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  },
  resolveAssistantScope: vi.fn(),
  getAssistantState: vi.fn(async () => ({ messages: [] })),
  sendAssistantMessage: vi.fn(async () => ({ messages: [] })),
  updateAssistantMemory: vi.fn(async () => ({
    memory: { content: "设定", version: 1 },
  })),
  clearAssistantMessages: vi.fn(async () => ({ messages: [] })),
}));
vi.mock("@/services/assistant-reply", () => ({
  AssistantReplyError: class extends Error {},
}));
const request = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(rateLimiters.default).mockResolvedValue({ success: true } as never);
  vi.mocked(rateLimiters.imageGeneration).mockResolvedValue({
    success: true,
  } as never);
  vi.mocked(resolveAssistantScope).mockResolvedValue({
    key: "project:p1",
    type: "project",
    id: "p1",
    title: "作品",
  });
});
describe("助手路由校验", () => {
  it("所有入口拒绝未登录请求", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(request("/api/assistant?projectId=p1"))).status).toBe(
      401
    );
    expect(
      (await POST(request("/api/assistant/messages", "POST", {}))).status
    ).toBe(401);
    expect(
      (await DELETE(request("/api/assistant/messages?projectId=p1", "DELETE")))
        .status
    ).toBe(401);
    expect(
      (await PATCH(request("/api/assistant/memory", "PATCH", {}))).status
    ).toBe(401);
    expect(resolveAssistantScope).not.toHaveBeenCalled();
  });
  it("缺少/重复/多个作用域均返回400", async () => {
    for (const query of [
      "",
      "?projectId=p1&seriesId=s1",
      "?projectId=p1&projectId=p2",
    ])
      expect((await GET(request(`/api/assistant${query}`))).status).toBe(400);
    expect(resolveAssistantScope).not.toHaveBeenCalled();
  });
  it("实际导入Zod4扩展schema可处理有效POST和PATCH", async () => {
    expect(
      (
        await POST(
          request("/api/assistant/messages", "POST", {
            projectId: "p1",
            content: "谁适合当主角？",
            requestId: "cd6e6199-37f8-48a9-90e8-68c680d50e56",
          })
        )
      ).status
    ).toBe(200);
    expect(sendAssistantMessage).toHaveBeenCalledOnce();
    expect(
      (
        await PATCH(
          request("/api/assistant/memory", "PATCH", {
            projectId: "p1",
            content: "设定",
            version: 0,
          })
        )
      ).status
    ).toBe(200);
    expect(updateAssistantMemory).toHaveBeenCalledWith(
      "owner",
      expect.anything(),
      "设定",
      0
    );
  });
  it("过长输入或非法requestId不调用模型服务", async () => {
    for (const body of [
      { projectId: "p1", content: "问题", requestId: "bad" },
      {
        projectId: "p1",
        content: "字".repeat(4001),
        requestId: "cd6e6199-37f8-48a9-90e8-68c680d50e56",
      },
    ])
      expect(
        (await POST(request("/api/assistant/messages", "POST", body))).status
      ).toBe(400);
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });
  it("模型调用受按用户限流保护", async () => {
    vi.mocked(rateLimiters.imageGeneration).mockResolvedValue({
      success: false,
      retryAfter: 10,
    } as never);
    expect(
      (await POST(request("/api/assistant/messages", "POST", {}))).status
    ).toBe(429);
    expect(sendAssistantMessage).not.toHaveBeenCalled();
  });
  it("无Content-Length的大流在字节上限处取消", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60_000));
        controller.enqueue(new Uint8Array(60_000));
      },
      cancel,
    });
    await expect(
      assistantBody({ body, headers: new Headers() } as NextRequest)
    ).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("12000字中文确认记忆在字节预算内合法", async () => {
    expect(
      (
        await PATCH(
          request("/api/assistant/memory", "PATCH", {
            projectId: "p1",
            content: "剧".repeat(12000),
            version: 0,
          })
        )
      ).status
    ).toBe(200);
  });
  it("解析错误不泄露内部异常", async () => {
    vi.mocked(resolveAssistantScope).mockRejectedValueOnce(
      new Error("secret-provider-key")
    );
    const response = await GET(request("/api/assistant?projectId=p1"));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-provider-key");
  });
});
