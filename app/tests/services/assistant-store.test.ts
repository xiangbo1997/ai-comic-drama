import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  resolveAssistantScope,
  getAssistantState,
} from "@/services/assistant-store";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    series: { findFirst: vi.fn() },
    assistantThread: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/assistant-reply", () => ({
  generateAssistantReply: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

describe("助手作用域隔离", () => {
  it("当前集所属系列需再次验证所有权", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "p1",
      title: "第一集",
      seriesId: "s1",
    } as never);
    vi.mocked(prisma.series.findFirst).mockResolvedValue(null);
    await expect(
      resolveAssistantScope("owner", { projectId: "p1" })
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.series.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1", userId: "owner" } })
    );
  });
  it("系列内不同集共享同一记忆键", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "p1",
      title: "第一集",
      seriesId: "s1",
    } as never);
    vi.mocked(prisma.series.findFirst).mockResolvedValue({
      id: "s1",
      title: "同一部剧",
    } as never);
    expect(await resolveAssistantScope("owner", { projectId: "p1" })).toEqual({
      key: "series:s1",
      type: "series",
      id: "s1",
      title: "同一部剧",
      projectId: "p1",
    });
  });
  it("独立作品拥有独立记忆，空对话读取不写库", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "p1",
      title: "独立剧",
      seriesId: null,
    } as never);
    vi.mocked(prisma.assistantThread.findFirst).mockResolvedValue(null);
    const scope = await resolveAssistantScope("owner", { projectId: "p1" });
    expect(scope.key).toBe("project:p1");
    expect(await getAssistantState("owner", scope)).toMatchObject({
      messages: [],
      memory: { content: "", version: 0 },
      hasMore: false,
    });
  });
});
