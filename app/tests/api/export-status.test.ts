import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET } from "@/app/api/projects/[id]/export/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    generationTask: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/services/video-synthesis", () => ({
  synthesizeVideoToPath: vi.fn(),
}));
vi.mock("@/services/storage", () => ({ uploadFileFromPath: vi.fn() }));

const params = { params: Promise.resolve({ id: "owned-project" }) };
const get = (query: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/projects/owned-project/export${query}`
    ),
    params
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "owner" } } as never);
  vi.mocked(prisma.project.findFirst).mockResolvedValue({
    id: "owned-project",
  } as never);
  vi.mocked(prisma.generationTask.findFirst).mockResolvedValue({
    id: "completed-export",
    status: "COMPLETED",
    error: null,
    output: { videoUrl: "/uploads/result.mp4", progress: 100 },
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: new Date(),
  } as never);
});

describe("恢复最近导出结果", () => {
  it("鉴权失败时不读取任何任务", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await get("?latest=1")).status).toBe(401);
    expect(prisma.generationTask.findFirst).not.toHaveBeenCalled();
  });
  it("不属于当前用户的项目返回 404，不泄漏任务", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
    expect((await get("?latest=1")).status).toBe(404);
    expect(prisma.generationTask.findFirst).not.toHaveBeenCalled();
  });
  it("仅查询已鉴权项目的最近 EXPORT 任务并返回已完成视频", async () => {
    const result = await get("?latest=1");
    expect(result.status).toBe(200);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: "owned-project", userId: "owner" },
      select: { id: true },
    });
    expect(prisma.generationTask.findFirst).toHaveBeenCalledWith({
      where: { projectId: "owned-project", type: "EXPORT" },
      orderBy: { createdAt: "desc" },
    });
    expect(await result.json()).toMatchObject({
      taskId: "completed-export",
      status: "completed",
      videoUrl: "/uploads/result.mp4",
    });
  });
  it("未显式要求 latest 且无 taskId 时仍返回 400", async () => {
    expect((await get("")).status).toBe(400);
  });
  it("无历史导出时返回明确提示", async () => {
    vi.mocked(prisma.generationTask.findFirst).mockResolvedValue(null);
    const result = await get("?latest=1");
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "暂无导出记录" });
  });
});
