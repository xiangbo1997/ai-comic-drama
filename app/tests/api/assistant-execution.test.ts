import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { GET, POST } from "@/app/api/assistant/executions/route";
import {
  GET as read,
  POST as control,
} from "@/app/api/assistant/executions/[id]/route";
import {
  createAssistantExecution,
  controlAssistantExecution,
} from "@/services/assistant-execution/store";
import { wakeAssistantExecutionWorker } from "@/services/assistant-execution/worker";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: { default: vi.fn(async () => ({ success: true })) },
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
}));
vi.mock("@/services/assistant-reply", () => ({
  AssistantReplyError: class extends Error {},
}));
vi.mock("@/services/assistant-execution/store", () => ({
  createAssistantExecution: vi.fn(),
  latestAssistantExecution: vi.fn(async () => null),
  readAssistantExecution: vi.fn(async () => ({ id: "run" })),
  controlAssistantExecution: vi.fn(),
}));
vi.mock("@/services/assistant-execution/worker", () => ({
  wakeAssistantExecutionWorker: vi.fn(),
}));
const requestId = "cd6e6199-37f8-48a9-90e8-68c680d50e56";
const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const params = { params: Promise.resolve({ id: "run" }) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
});
describe("助手执行API授权与预览", () => {
  it("四个入口未登录均401", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(
      (await GET(req("/api/assistant/executions?projectId=p1"))).status
    ).toBe(401);
    expect(
      (await POST(req("/api/assistant/executions", "POST", {}))).status
    ).toBe(401);
    expect(
      (await read(req("/api/assistant/executions/run"), params)).status
    ).toBe(401);
    expect(
      (await control(req("/api/assistant/executions/run", "POST", {}), params))
        .status
    ).toBe(401);
  });
  it("创建计划不启动worker且返回统一envelope", async () => {
    vi.mocked(createAssistantExecution).mockResolvedValue({
      id: "run",
      status: "planned",
    } as never);
    const response = await POST(
      req("/api/assistant/executions", "POST", {
        projectId: "p1",
        requestId,
        options: { maxCredits: 100 },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      execution: { id: "run", status: "planned" },
    });
    expect(wakeAssistantExecutionWorker).not.toHaveBeenCalled();
  });
  it("系列ID不能替代当前集，预算必须整数且有上限", async () => {
    for (const body of [
      { seriesId: "s1", requestId, options: { maxCredits: 10 } },
      { projectId: "p1", requestId, options: { maxCredits: 10001 } },
    ])
      expect(
        (await POST(req("/api/assistant/executions", "POST", body))).status
      ).toBe(400);
    expect(createAssistantExecution).not.toHaveBeenCalled();
  });
  it("确认后才唤醒后台执行器", async () => {
    vi.mocked(controlAssistantExecution).mockResolvedValue({
      id: "run",
      status: "running",
    } as never);
    expect(
      (
        await control(
          req("/api/assistant/executions/run", "POST", {
            action: "confirm",
            requestId,
          }),
          params
        )
      ).status
    ).toBe(200);
    expect(controlAssistantExecution).toHaveBeenCalledWith(
      "owner",
      "run",
      "confirm",
      requestId
    );
    expect(wakeAssistantExecutionWorker).toHaveBeenCalledOnce();
  });
  it("缺scope与任意工具名均400，不触发执行", async () => {
    expect((await GET(req("/api/assistant/executions"))).status).toBe(400);
    expect(
      (
        await control(
          req("/api/assistant/executions/run", "POST", {
            action: "generate_free",
            requestId,
          }),
          params
        )
      ).status
    ).toBe(400);
    expect(wakeAssistantExecutionWorker).not.toHaveBeenCalled();
  });
});
