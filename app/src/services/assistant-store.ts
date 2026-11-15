import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { generateAssistantReply } from "@/services/assistant-reply";

export interface AssistantScope {
  key: string;
  type: "series" | "project";
  id: string;
  title: string;
  projectId?: string;
}
export type AssistantScopeInput = { projectId?: string; seriesId?: string };
export class AssistantStoreError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
const LEASE_MS = 150_000;
const MESSAGE_LIMIT = 40;

export async function resolveAssistantScope(
  userId: string,
  input: AssistantScopeInput
): Promise<AssistantScope> {
  if (Number(!!input.projectId) + Number(!!input.seriesId) !== 1) {
    throw new AssistantStoreError(400, "请选择一部作品或系列");
  }
  let seriesId = input.seriesId;
  if (input.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, userId },
      select: { id: true, title: true, seriesId: true },
    });
    if (!project) throw new AssistantStoreError(404, "作品不存在");
    if (!project.seriesId)
      return {
        key: `project:${project.id}`,
        type: "project",
        id: project.id,
        title: project.title,
        projectId: project.id,
      };
    seriesId = project.seriesId;
  }
  const series = await prisma.series.findFirst({
    where: { id: seriesId, userId },
    select: { id: true, title: true },
  });
  if (!series) throw new AssistantStoreError(404, "系列不存在");
  return {
    key: `series:${series.id}`,
    type: "series",
    id: series.id,
    title: series.title,
    ...(input.projectId && { projectId: input.projectId }),
  };
}

function threadData(userId: string, scope: AssistantScope) {
  return {
    scopeKey: scope.key,
    userId,
    ...(scope.type === "series"
      ? { seriesId: scope.id }
      : { projectId: scope.id }),
  };
}

export async function getAssistantState(userId: string, scope: AssistantScope) {
  const thread = await prisma.assistantThread.findFirst({
    where: { scopeKey: scope.key, userId },
    include: {
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MESSAGE_LIMIT + 1,
      },
    },
  });
  const messages = (thread?.messages ?? [])
    .slice(0, MESSAGE_LIMIT)
    .reverse()
    .map(({ id, role, content, createdAt }) => ({
      id,
      role,
      content,
      createdAt,
    }));
  return {
    scope,
    messages,
    memory: {
      content: thread?.memoryContent ?? "",
      version: thread?.memoryVersion ?? 0,
    },
    hasMore: (thread?.messages.length ?? 0) > MESSAGE_LIMIT,
    busy:
      !!thread?.leaseExpiresAt && thread.leaseExpiresAt.getTime() > Date.now(),
  };
}

export async function sendAssistantMessage(
  userId: string,
  scope: AssistantScope,
  input: {
    content: string;
    requestId: string;
    configId?: string;
    model?: string;
  }
) {
  const token = randomUUID();
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        content: input.content,
        configId: input.configId ?? null,
        model: input.model ?? null,
        projectId: scope.projectId ?? null,
      })
    )
    .digest("hex");
  // 租约仅覆盖短事务，模型调用绝不占用数据库事务/连接。
  const claim = await prisma.$transaction(async (tx) => {
    const thread = await tx.assistantThread.upsert({
      where: { scopeKey: scope.key },
      create: threadData(userId, scope),
      update: { scopeKey: scope.key },
    });
    if (thread.userId !== userId)
      throw new AssistantStoreError(404, "对话不存在");
    const existing = await tx.assistantRequest.findUnique({
      where: {
        threadId_requestId: { threadId: thread.id, requestId: input.requestId },
      },
    });
    if (existing && existing.fingerprint !== fingerprint)
      throw new AssistantStoreError(
        409,
        "该请求编号已用于其他内容，请重新发送"
      );
    if (existing?.status === "COMPLETED")
      return { replay: true as const, threadId: thread.id };
    const now = new Date();
    const acquired = await tx.assistantThread.updateMany({
      where: {
        id: thread.id,
        userId,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: {
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    if (!acquired.count)
      throw new AssistantStoreError(409, "助手正在回复，请稍后再试");
    // 进程退出后的过期请求可显式重试；旧执行者凭旧token无法提交。
    await tx.assistantRequest.updateMany({
      where: { threadId: thread.id, status: "PROCESSING" },
      data: { status: "FAILED" },
    });
    const request = await tx.assistantRequest.upsert({
      where: {
        threadId_requestId: { threadId: thread.id, requestId: input.requestId },
      },
      create: { threadId: thread.id, requestId: input.requestId, fingerprint },
      update: { status: "PROCESSING" },
    });
    return {
      replay: false as const,
      threadId: thread.id,
      requestId: request.id,
    };
  });
  if (claim.replay) return getAssistantState(userId, scope);
  try {
    const state = await getAssistantState(userId, scope);
    const reply = await generateAssistantReply({
      userId,
      scope,
      history: state.messages.slice(-20).map(({ role, content }) => ({
        role: role as "user" | "assistant",
        content,
      })),
      memory: state.memory.content,
      content: input.content,
      configId: input.configId,
      model: input.model,
    });
    await prisma.$transaction(async (tx) => {
      const committed = await tx.assistantThread.updateMany({
        where: {
          id: claim.threadId,
          userId,
          leaseToken: token,
          leaseExpiresAt: { gt: new Date() },
        },
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      if (!committed.count)
        throw new AssistantStoreError(409, "本次回复已过期，请重新发送");
      const lastMessage = state.messages.at(-1);
      const createdAt = new Date(
        Math.max(
          Date.now(),
          lastMessage ? new Date(lastMessage.createdAt).getTime() + 1 : 0
        )
      );
      await tx.assistantMessage.createMany({
        data: [
          {
            threadId: claim.threadId,
            requestId: claim.requestId,
            role: "user",
            content: input.content,
            createdAt,
          },
          {
            threadId: claim.threadId,
            requestId: claim.requestId,
            role: "assistant",
            content: reply.content,
            createdAt: new Date(createdAt.getTime() + 1),
          },
        ],
      });
      await tx.assistantRequest.update({
        where: { id: claim.requestId },
        data: { status: "COMPLETED" },
      });
    });
    return {
      ...(await getAssistantState(userId, scope)),
      context: reply.context,
    };
  } catch (error) {
    // 条件释放避免旧请求的失败清理误删新请求租约。
    await prisma.$transaction(async (tx) => {
      const released = await tx.assistantThread.updateMany({
        where: { id: claim.threadId, userId, leaseToken: token },
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      if (released.count)
        await tx.assistantRequest.updateMany({
          where: { id: claim.requestId, status: "PROCESSING" },
          data: { status: "FAILED" },
        });
    });
    throw error;
  }
}

export async function updateAssistantMemory(
  userId: string,
  scope: AssistantScope,
  content: string,
  version: number
) {
  return prisma.$transaction(async (tx) => {
    const thread = await tx.assistantThread.upsert({
      where: { scopeKey: scope.key },
      create: threadData(userId, scope),
      update: { scopeKey: scope.key },
    });
    const changed = await tx.assistantThread.updateMany({
      where: {
        id: thread.id,
        userId,
        memoryVersion: version,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      },
      data: { memoryContent: content, memoryVersion: { increment: 1 } },
    });
    if (!changed.count)
      throw new AssistantStoreError(
        409,
        "记忆已更新或助手正在回复，请刷新后重试"
      );
    return { memory: { content, version: version + 1 } };
  });
}

export async function clearAssistantMessages(
  userId: string,
  scope: AssistantScope
) {
  await prisma.$transaction(async (tx) => {
    const thread = await tx.assistantThread.findFirst({
      where: { scopeKey: scope.key, userId },
    });
    if (!thread) return;
    const locked = await tx.assistantThread.updateMany({
      where: {
        id: thread.id,
        userId,
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      },
      data: { leaseToken: null, leaseExpiresAt: null },
    });
    if (!locked.count)
      throw new AssistantStoreError(409, "助手正在回复，暂时无法清空对话");
    await tx.assistantRequest.deleteMany({ where: { threadId: thread.id } });
  });
  return getAssistantState(userId, scope);
}
