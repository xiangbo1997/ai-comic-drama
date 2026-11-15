import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  scene: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    generationTask: { findUnique: mocks.read, update: mocks.update },
    scene: { updateMany: mocks.scene },
    $transaction: mocks.transaction,
  },
}));
import { GET } from "@/app/api/generate/tasks/[taskId]/route";
const poll = () =>
  GET(new NextRequest("http://localhost/api/generate/tasks/t"), {
    params: Promise.resolve({ taskId: "t" }),
  });
const task = () => ({
  id: "t",
  type: "IMAGE_GENERATE",
  status: "PROCESSING",
  input: { userId: "u", executionRunId: "run" },
  sceneId: "s",
  updatedAt: new Date(Date.now() - 60 * 60 * 1000),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "u" } });
  mocks.read.mockResolvedValue(task());
});

describe("内部自动制作任务轮询", () => {
  it("长生成内部任务不被普通僵尸清理器伪造为确定失败", async () => {
    expect(await (await poll()).json()).toEqual({ status: "PROCESSING" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("普通手动任务继续使用既有过期回收", async () => {
    mocks.read.mockResolvedValue({ ...task(), input: { userId: "u" } });
    expect(await (await poll()).json()).toMatchObject({ status: "FAILED" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it("内部标识不能绕过任务归属校验", async () => {
    mocks.read.mockResolvedValue({
      ...task(),
      input: { userId: "other", executionRunId: "run" },
    });
    expect((await poll()).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
