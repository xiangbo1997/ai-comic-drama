import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAssistantReply } from "@/services/assistant-reply";
import {
  resolveAssistantScope,
  getAssistantState,
  sendAssistantMessage,
  updateAssistantMemory,
  clearAssistantMessages,
  type AssistantScope,
} from "@/services/assistant-store";
import { GET } from "@/app/api/assistant/route";
import { POST, DELETE } from "@/app/api/assistant/messages/route";
import { PATCH } from "@/app/api/assistant/memory/route";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: session.userId } })),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimiters: {
    default: vi.fn(async () => ({ success: true })),
    imageGeneration: vi.fn(async () => ({ success: true })),
  },
  rateLimitHeaders: () => ({}),
}));
vi.mock("@/services/assistant-reply", () => ({
  generateAssistantReply: vi.fn(),
  AssistantReplyError: class extends Error {},
}));

let userId = "";
let otherUserId = "";
let seriesId = "";
let projectId = "";
let episode2 = "";
let standalone = "";
let scope: AssistantScope;
const reply = () => ({
  content: "建议先建立主角的清晰动机。",
  context: { sources: ["世界观"], truncated: false },
});
const input = (content = "主角下一步该怎么做？") => ({
  content,
  requestId: randomUUID(),
});
const deferred = () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const promise = new Promise<ReturnType<typeof reply>>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(generateAssistantReply).mockResolvedValue(reply());
  const user = await prisma.user.create({
    data: { email: `assistant-${randomUUID()}@example.test` },
  });
  const other = await prisma.user.create({
    data: { email: `assistant-other-${randomUUID()}@example.test` },
  });
  userId = user.id;
  otherUserId = other.id;
  session.userId = userId;
  const series = await prisma.series.create({
    data: { title: "隔离测试剧", userId },
  });
  seriesId = series.id;
  const first = await prisma.project.create({
    data: { title: "第一集", userId, seriesId, episodeNumber: 1 },
  });
  projectId = first.id;
  episode2 = (
    await prisma.project.create({
      data: { title: "第二集", userId, seriesId, episodeNumber: 2 },
    })
  ).id;
  standalone = (
    await prisma.project.create({ data: { title: "独立作品", userId } })
  ).id;
  scope = await resolveAssistantScope(userId, { projectId });
});
afterEach(async () => {
  await prisma.user.deleteMany({
    where: { id: { in: [userId, otherUserId] } },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("助手真实PostgreSQL持久化和并发", () => {
  it("同剧多集共享确认记忆，独立作品/其他用户隔离", async () => {
    await updateAssistantMemory(userId, scope, "主角不会使用暴力", 0);
    const next = await resolveAssistantScope(userId, { projectId: episode2 });
    expect((await getAssistantState(userId, next)).memory).toEqual({
      content: "主角不会使用暴力",
      version: 1,
    });
    expect(
      (
        await getAssistantState(
          userId,
          await resolveAssistantScope(userId, { projectId: standalone })
        )
      ).memory.content
    ).toBe("");
    await expect(
      resolveAssistantScope(otherUserId, { projectId })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolveAssistantScope(otherUserId, { seriesId })
    ).rejects.toMatchObject({ status: 404 });
  });
  it("四个HTTP入口均拒绝其他用户作品，无模型调用", async () => {
    session.userId = otherUserId;
    const req = (path: string, method = "GET", body?: unknown) =>
      new NextRequest(`http://localhost${path}`, {
        method,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    expect(
      (await GET(req(`/api/assistant?projectId=${projectId}`))).status
    ).toBe(404);
    expect(
      (
        await POST(
          req("/api/assistant/messages", "POST", { projectId, ...input() })
        )
      ).status
    ).toBe(404);
    expect(
      (
        await PATCH(
          req("/api/assistant/memory", "PATCH", {
            projectId,
            content: "覆盖",
            version: 0,
          })
        )
      ).status
    ).toBe(404);
    expect(
      (
        await DELETE(
          req(`/api/assistant/messages?seriesId=${seriesId}`, "DELETE")
        )
      ).status
    ).toBe(404);
    expect(generateAssistantReply).not.toHaveBeenCalled();
  });
  it("跨用户错误关联的Series也无法解析", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { userId: otherUserId },
    });
    await expect(
      resolveAssistantScope(otherUserId, { projectId })
    ).rejects.toMatchObject({ status: 404 });
  });
  it("同requestId重复发送只调用一次模型，异内容冲突", async () => {
    const request = input();
    const first = await sendAssistantMessage(userId, scope, request);
    const second = await sendAssistantMessage(userId, scope, request);
    expect(first.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(second.messages).toEqual(first.messages);
    expect(generateAssistantReply).toHaveBeenCalledOnce();
    await expect(
      sendAssistantMessage(userId, scope, { ...request, content: "不同的问题" })
    ).rejects.toMatchObject({ status: 409 });
  });
  it("上游失败不保存半轮，重试可成功持久化", async () => {
    const request = input();
    vi.mocked(generateAssistantReply).mockRejectedValueOnce(
      new Error("mock timeout")
    );
    await expect(sendAssistantMessage(userId, scope, request)).rejects.toThrow(
      "mock timeout"
    );
    expect((await getAssistantState(userId, scope)).messages).toHaveLength(0);
    expect((await prisma.assistantRequest.findFirstOrThrow()).status).toBe(
      "FAILED"
    );
    await sendAssistantMessage(userId, scope, request);
    expect((await getAssistantState(userId, scope)).messages).toHaveLength(2);
  });
  it("同时发送只放行一个请求，处理中禁止清空与改记忆", async () => {
    const pending = deferred();
    vi.mocked(generateAssistantReply).mockReturnValueOnce(pending.promise);
    const first = sendAssistantMessage(userId, scope, input());
    await vi.waitFor(() =>
      expect(generateAssistantReply).toHaveBeenCalledOnce()
    );
    await expect(
      sendAssistantMessage(userId, scope, input())
    ).rejects.toMatchObject({ status: 409 });
    await expect(clearAssistantMessages(userId, scope)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      updateAssistantMemory(userId, scope, "新记忆", 0)
    ).rejects.toMatchObject({ status: 409 });
    pending.resolve(reply());
    await first;
    expect((await getAssistantState(userId, scope)).messages).toHaveLength(2);
  });
  it("两个首次请求竞争初始化也只生成一轮", async () => {
    const pending = deferred();
    vi.mocked(generateAssistantReply).mockReturnValue(pending.promise);
    const resultsPromise = Promise.allSettled([
      sendAssistantMessage(userId, scope, input()),
      sendAssistantMessage(userId, scope, input()),
    ]);
    await vi.waitFor(() =>
      expect(generateAssistantReply).toHaveBeenCalledOnce()
    );
    pending.resolve(reply());
    const results = await resultsPromise;
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(await prisma.assistantThread.count()).toBe(1);
    expect(generateAssistantReply).toHaveBeenCalledOnce();
  });
  it("记忆版本冲突拒绝覆盖，清空聊天保留记忆且级联删除消息", async () => {
    const request = input();
    await updateAssistantMemory(userId, scope, "保留设定", 0);
    await expect(
      updateAssistantMemory(userId, scope, "旧页面覆盖", 0)
    ).rejects.toMatchObject({ status: 409 });
    await sendAssistantMessage(userId, scope, request);
    const state = await clearAssistantMessages(userId, scope);
    expect(state.memory).toEqual({ content: "保留设定", version: 1 });
    expect(state.messages).toEqual([]);
    expect(await prisma.assistantRequest.count()).toBe(0);
    expect(await prisma.assistantMessage.count()).toBe(0);
    await sendAssistantMessage(userId, scope, request);
    expect(generateAssistantReply).toHaveBeenCalledTimes(2);
    expect((await getAssistantState(userId, scope)).messages).toHaveLength(2);
  });
  it("过期租约可接管，旧执行者不能提交或释放新租约", async () => {
    const old = deferred();
    const current = deferred();
    vi.mocked(generateAssistantReply)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const oldResult = sendAssistantMessage(userId, scope, input("旧问题")).then(
      () => null,
      (error: unknown) => error
    );
    await vi.waitFor(() =>
      expect(generateAssistantReply).toHaveBeenCalledOnce()
    );
    await prisma.assistantThread.update({
      where: { scopeKey: scope.key },
      data: { leaseExpiresAt: new Date(0) },
    });
    const newResult = sendAssistantMessage(userId, scope, input("新问题"));
    await vi.waitFor(() =>
      expect(generateAssistantReply).toHaveBeenCalledTimes(2)
    );
    old.resolve(reply());
    expect(await oldResult).toMatchObject({ status: 409 });
    expect((await getAssistantState(userId, scope)).busy).toBe(true);
    current.resolve(reply());
    await newResult;
    expect((await getAssistantState(userId, scope)).messages[0].content).toBe(
      "新问题"
    );
  });
  it("历史持久保留但读取与模型历史都有窗口", async () => {
    for (let i = 0; i < 22; i++)
      await sendAssistantMessage(userId, scope, input(`问题${i}`));
    const state = await getAssistantState(userId, scope);
    expect(state.messages).toHaveLength(40);
    expect(state.hasMore).toBe(true);
    expect(await prisma.assistantMessage.count()).toBe(44);
    expect(
      vi.mocked(generateAssistantReply).mock.calls.at(-1)?.[0].history
    ).toHaveLength(20);
    for (let i = 0; i < state.messages.length; i += 2)
      expect(
        state.messages.slice(i, i + 2).map((message) => message.role)
      ).toEqual(["user", "assistant"]);
  });
  it("删系列自动清除其助手数据，各集仍保留并变为独立作品", async () => {
    await sendAssistantMessage(userId, scope, input());
    await prisma.series.delete({ where: { id: seriesId } });
    expect(await prisma.assistantThread.count()).toBe(0);
    expect(await prisma.assistantMessage.count()).toBe(0);
    expect((await resolveAssistantScope(userId, { projectId })).type).toBe(
      "project"
    );
  });
});
