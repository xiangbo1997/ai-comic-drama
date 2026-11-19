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
import { prisma } from "@/lib/prisma";
import { chargeCredits } from "@/lib/credits";
import {
  createAssistantExecution,
  controlAssistantExecution,
  readAssistantExecution,
  mutateExecution,
} from "@/services/assistant-execution/store";
import { buildAssistantExecutionPlan } from "@/services/assistant-execution/planner";
import { runAssistantExecution } from "@/services/assistant-execution/runner";
import {
  describeAssistantCapabilities,
  executeAssistantAction,
  reconcileAssistantAction,
  type AssistantActionInput,
  type AssistantActionResult,
} from "@/services/assistant-execution/tools";
import type { AssistantExecutionOptions } from "@/lib/assistant-execution";
import { readAssistantReviewFingerprint } from "@/services/assistant-execution/review-fingerprint";

vi.mock("@/services/assistant-execution/tools", () => ({
  describeAssistantCapabilities: vi.fn(),
  executeAssistantAction: vi.fn(),
  reconcileAssistantAction: vi.fn(),
}));
let userId = "";
let otherId = "";
let projectId = "";
let sceneId = "";
const options: AssistantExecutionOptions = {
  maxCredits: 100,
  maxRepairRounds: 1,
  generateVideos: true,
};
const caps = () => ({
  models: { image: "mock-image", video: "mock-video", llm: "mock-vision" },
  configFingerprint: "stable-prices-and-config",
  warnings: [],
  imageReady: true,
  videoReady: true,
  imageMaxCost: 3,
  locationCost: 1,
  videoCosts: { [sceneId]: 5 },
  canRepair: true,
  supportsCharacterReferences: true,
  canInspect: true,
  canLink: true,
});
const plan = (overrides: Partial<AssistantExecutionOptions> = {}) =>
  createAssistantExecution(userId, randomUUID(), projectId, {
    ...options,
    ...overrides,
  });
const confirm = (id: string) =>
  controlAssistantExecution(userId, id, "confirm", randomUUID());
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};

async function perform(
  input: AssistantActionInput,
  extra: Partial<AssistantActionResult> = {},
  beforeFinish?: Promise<void>
) {
  const task = await prisma.generationTask.create({
    data: {
      projectId,
      sceneId: input.targetId === sceneId ? sceneId : null,
      type: input.kind === "video" ? "VIDEO_GENERATE" : "IMAGE_GENERATE",
      status: "PENDING",
      cost: input.maxCost,
      input: {
        userId,
        executionRunId: input.runId,
        operationKey: input.operationKey,
      },
    },
  });
  await input.onTaskCreated?.(task.id);
  await beforeFinish;
  const result = {
    taskId: task.id,
    actualCost: input.maxCost,
    artifact:
      input.kind === "inspect"
        ? {
            reviewFingerprint: await readAssistantReviewFingerprint(
              userId,
              projectId
            ),
          }
        : {},
    ...extra,
  };
  await prisma.$transaction(async (tx) => {
    if (input.kind === "image" || input.kind === "repair")
      await tx.scene.update({
        where: { id: sceneId },
        data: { imageUrl: `mock://image/${task.id}`, imageStatus: "COMPLETED" },
      });
    if (input.kind === "video")
      await tx.scene.update({
        where: { id: sceneId },
        data: { videoUrl: `mock://video/${task.id}`, videoStatus: "COMPLETED" },
      });
    if (result.actualCost)
      await chargeCredits(tx, {
        userId,
        amount: result.actualCost,
        type: input.kind === "video" ? "GENERATE_VIDEO" : "GENERATE_IMAGE",
        source: "test:assistant",
        sourceId: task.id,
      });
    await tx.generationTask.update({
      where: { id: task.id },
      data: { status: "COMPLETED", output: result as never },
    });
  });
  return result;
}

beforeEach(async () => {
  vi.clearAllMocks();
  userId = (
    await prisma.user.create({
      data: { email: `execution-${randomUUID()}@example.test`, credits: 100 },
    })
  ).id;
  otherId = (
    await prisma.user.create({
      data: {
        email: `execution-other-${randomUUID()}@example.test`,
        credits: 100,
      },
    })
  ).id;
  projectId = (
    await prisma.project.create({ data: { title: "临时执行测试", userId } })
  ).id;
  sceneId = (
    await prisma.scene.create({
      data: {
        projectId,
        order: 0,
        description: "主角推开大厅的门",
        locationKey: "大厅",
      },
    })
  ).id;
  await prisma.projectLocation.create({
    data: {
      projectId,
      locationKey: "大厅",
      description: "既有地点描述",
      imageUrl: "mock://existing-location",
    },
  });
  vi.mocked(describeAssistantCapabilities).mockImplementation(async () =>
    caps()
  );
  vi.mocked(executeAssistantAction).mockImplementation((input) =>
    perform(
      input,
      input.kind === "prepare" ? { artifact: { locations: ["大厅"] } } : {}
    )
  );
  vi.mocked(reconcileAssistantAction).mockImplementation(
    async (input, taskId) => {
      const task = taskId
        ? await prisma.generationTask.findUnique({ where: { id: taskId } })
        : await prisma.generationTask.findFirst({
            where: {
              input: { path: ["operationKey"], equals: input.operationKey },
            },
          });
      if (!task || task.status === "PENDING")
        return { status: "not_started", ...(task && { taskId: task.id }) };
      if ((task.output as { unknown?: boolean } | null)?.unknown)
        return { status: "unknown", taskId: task.id };
      if (task.status === "COMPLETED")
        return {
          status: "completed",
          taskId: task.id,
          result: task.output as unknown as AssistantActionResult,
        };
      return {
        status: task.status === "FAILED" ? "failed" : "processing",
        taskId: task.id,
      };
    }
  );
});
afterEach(async () => {
  await prisma.generationTask.deleteMany({ where: { projectId } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("自主执行真实PG状态、租约与预算", () => {
  it("计划仅预览，未确认worker不得执行，requestId幂等", async () => {
    const requestId = randomUUID();
    const first = await createAssistantExecution(
      userId,
      requestId,
      projectId,
      options
    );
    const second = await createAssistantExecution(
      userId,
      requestId,
      projectId,
      options
    );
    expect(second.id).toBe(first.id);
    expect(first.status).toBe("planned");
    await runAssistantExecution(first.id);
    expect(executeAssistantAction).not.toHaveBeenCalled();
    await expect(
      createAssistantExecution(userId, requestId, projectId, {
        ...options,
        maxCredits: 99,
      })
    ).rejects.toMatchObject({ status: 409 });
  });
  it("所有run读写与plan都验证当前集所有权", async () => {
    const created = await plan();
    await expect(
      readAssistantExecution(otherId, created.id)
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controlAssistantExecution(otherId, created.id, "confirm", randomUUID())
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      buildAssistantExecutionPlan(otherId, projectId, options)
    ).rejects.toMatchObject({ status: 404 });
  });
  it("确认时素材/配置变更返回409，最坏预算不足不能确认", async () => {
    const created = await plan();
    await prisma.scene.update({
      where: { id: sceneId },
      data: { description: "用户改了镜头" },
    });
    await expect(confirm(created.id)).rejects.toMatchObject({ status: 409 });
    const tooSmall = await plan({ maxCredits: 1 });
    expect(tooSmall.plan.blockers.join()).toContain("超过设置");
    await expect(confirm(tooSmall.id)).rejects.toMatchObject({ status: 400 });
  });
  it("同当前集两个确认并发仅一个可运行", async () => {
    const a = await plan();
    const b = await plan();
    const results = await Promise.allSettled([confirm(a.id), confirm(b.id)]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected")
    ).toMatchObject({ reason: { status: 409 } });
  });
  it("确认等待素材锁时发生编辑会拒绝旧计划", async () => {
    const created = await plan();
    const held = deferred();
    const release = deferred();
    const editor = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "Project" WHERE "id"=${projectId} FOR UPDATE`;
      held.resolve();
      await release.promise;
      await tx.scene.update({
        where: { id: sceneId },
        data: { description: "确认竞态中的用户新稿" },
      });
    });
    await held.promise;
    const confirming = confirm(created.id).then(
      () => null,
      (error: unknown) => error
    );
    await vi.waitFor(() =>
      expect(describeAssistantCapabilities).toHaveBeenCalledTimes(2)
    );
    release.resolve();
    await editor;
    expect(await confirming).toMatchObject({ status: 409 });
    expect((await readAssistantExecution(userId, created.id)).status).toBe(
      "planned"
    );
  });
  it("确认后执行前用户编辑会暂停且不会调用生成", async () => {
    const created = await plan();
    await confirm(created.id);
    await prisma.scene.update({
      where: { id: sceneId },
      data: { description: "确认后的新稿" },
    });
    await runAssistantExecution(created.id);
    expect((await readAssistantExecution(userId, created.id)).status).toBe(
      "paused"
    );
    expect(executeAssistantAction).not.toHaveBeenCalled();
  });
  it("真实后台按计划制作并持久费用，重复worker不二次收费", async () => {
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("completed");
    expect(state.budget).toEqual({ limit: 100, spent: 8, reserved: 0 });
    expect(state.steps.map((step) => step.kind)).toEqual([
      "prepare",
      "image",
      "inspect",
      "links",
      "video",
    ]);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits
    ).toBe(92);
    const count = vi.mocked(executeAssistantAction).mock.calls.length;
    await runAssistantExecution(created.id);
    expect(executeAssistantAction).toHaveBeenCalledTimes(count);
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(2);
  });
  it("保留已有图片与视频，不自动覆盖", async () => {
    await prisma.scene.update({
      where: { id: sceneId },
      data: { imageUrl: "mock://old-image", videoUrl: "mock://old-video" },
    });
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.some(
          ([input]) => input.kind === "image" || input.kind === "video"
        )
    ).toBe(false);
    expect(
      await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } })
    ).toMatchObject({
      imageUrl: "mock://old-image",
      videoUrl: "mock://old-video",
    });
  });
  it("停止等待当前任务结算，不启动后续视觉/视频", async () => {
    const wait = deferred();
    vi.mocked(executeAssistantAction).mockImplementation(async (input) => {
      return perform(
        input,
        {},
        input.kind === "image" ? wait.promise : undefined
      );
    });
    const created = await plan();
    await confirm(created.id);
    const running = runAssistantExecution(created.id);
    await vi.waitFor(async () =>
      expect(
        (await readAssistantExecution(userId, created.id)).steps.find(
          (step) => step.kind === "image"
        )?.taskId
      ).toBeTruthy()
    );
    const stopping = await controlAssistantExecution(
      userId,
      created.id,
      "stop",
      randomUUID()
    );
    expect(stopping.status).toBe("stopping");
    wait.resolve();
    await running;
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("stopped");
    expect(state.budget).toEqual({ limit: 100, spent: 3, reserved: 0 });
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.some(([input]) => input.kind === "video")
    ).toBe(false);
  });
  it("余额不足在上游前暂停，补充积分resume不重复已完成步", async () => {
    const created = await plan();
    await confirm(created.id);
    await prisma.user.update({ where: { id: userId }, data: { credits: 0 } });
    await runAssistantExecution(created.id);
    expect((await readAssistantExecution(userId, created.id)).status).toBe(
      "paused"
    );
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.some(([input]) => input.kind === "image")
    ).toBe(false);
    await prisma.user.update({ where: { id: userId }, data: { credits: 100 } });
    await controlAssistantExecution(userId, created.id, "resume", randomUUID());
    await runAssistantExecution(created.id);
    expect(
      (await readAssistantExecution(userId, created.id)).budget.spent
    ).toBe(8);
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.filter(([input]) => input.kind === "prepare")
    ).toHaveLength(1);
  });
  it("严重问题修复次数有上限，未通过检查不能跳到视频或resume绕过", async () => {
    vi.mocked(executeAssistantAction).mockImplementation((input) =>
      perform(
        input,
        input.kind === "inspect"
          ? { issues: [{ sceneId, note: "主角服装明显错误" }] }
          : {}
      )
    );
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("paused");
    expect(state.repairRounds).toBe(1);
    expect(state.budget.spent).toBe(6);
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.filter(([input]) => input.kind === "repair")
    ).toHaveLength(1);
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.some(([input]) => input.kind === "video")
    ).toBe(false);
    await expect(
      controlAssistantExecution(userId, created.id, "resume", randomUUID())
    ).rejects.toMatchObject({ status: 409 });
  });
  it("检查不完整需要人工确认，不能继续视频", async () => {
    vi.mocked(executeAssistantAction).mockImplementation((input) =>
      perform(input, input.kind === "inspect" ? { requiresReview: true } : {})
    );
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    expect((await readAssistantExecution(userId, created.id)).status).toBe(
      "paused"
    );
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.some(([input]) => input.kind === "video")
    ).toBe(false);
  });
  it("检查后用户换图使检查指纹失效，不再启动视频", async () => {
    vi.mocked(executeAssistantAction).mockImplementation(async (input) => {
      const result = await perform(input);
      if (input.kind === "inspect")
        await prisma.scene.update({
          where: { id: sceneId },
          data: { imageUrl: "mock://user-new-selection" },
        });
      return result;
    });
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("paused");
    expect(state.resumeBlocked).toBe(true);
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.some(([input]) => input.kind === "video")
    ).toBe(false);
    await expect(
      controlAssistantExecution(userId, created.id, "resume", randomUUID())
    ).rejects.toMatchObject({ status: 409 });
  });
  it("付费产物冲突先结算再暂停，当前已完成步骤不会自动重试", async () => {
    vi.mocked(executeAssistantAction).mockImplementation((input) =>
      perform(input, input.kind === "image" ? { requiresReview: true } : {})
    );
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("paused");
    expect(state.budget).toEqual({ limit: 100, spent: 3, reserved: 0 });
    expect(state.steps.find((step) => step.kind === "image")?.status).toBe(
      "completed"
    );
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.filter(([input]) => input.kind === "image")
    ).toHaveLength(1);
  });
  it("未知上游保留预算，不会重复派单，新run也不能绕过", async () => {
    vi.mocked(executeAssistantAction).mockImplementation(async (input) => {
      if (input.kind !== "image") return perform(input);
      const task = await prisma.generationTask.create({
        data: {
          projectId,
          type: "IMAGE_GENERATE",
          status: "FAILED",
          cost: 3,
          input: {
            userId,
            executionRunId: input.runId,
            operationKey: input.operationKey,
          },
          output: { unknown: true },
        },
      });
      await input.onTaskCreated?.(task.id);
      throw new Error("上游连接中断");
    });
    const created = await plan();
    await confirm(created.id);
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("paused");
    expect(state.budget.reserved).toBe(3);
    expect(state.steps.find((step) => step.kind === "image")?.status).toBe(
      "unknown"
    );
    await runAssistantExecution(created.id, true);
    expect(
      vi
        .mocked(executeAssistantAction)
        .mock.calls.filter(([input]) => input.kind === "image")
    ).toHaveLength(1);
    const replacement = await plan();
    await expect(confirm(replacement.id)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("重启时已完成receipt可记账续行，PROCESSING则暂停而不再次提交", async () => {
    const created = await plan();
    await confirm(created.id);
    await mutateExecution(created.id, userId, (state) => {
      state.steps[0].status = "completed";
      const image = state.steps.find((step) => step.kind === "image")!;
      image.status = "running";
      state.budget.reserved = 3;
    });
    await prisma.generationTask.create({
      data: {
        projectId,
        type: "IMAGE_GENERATE",
        status: "PROCESSING",
        cost: 3,
        input: {
          userId,
          executionRunId: created.id,
          operationKey: `assistant:${created.id}:image:${sceneId}`,
        },
      },
    });
    await runAssistantExecution(created.id);
    expect((await readAssistantExecution(userId, created.id)).status).toBe(
      "paused"
    );
    expect(executeAssistantAction).not.toHaveBeenCalled();
    const task = await prisma.generationTask.findFirstOrThrow({
      where: { projectId, type: "IMAGE_GENERATE" },
    });
    await prisma.generationTask.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        output: { taskId: task.id, actualCost: 3, artifact: {} },
      },
    });
    await runAssistantExecution(created.id, true);
    const recovered = await readAssistantExecution(userId, created.id);
    expect(recovered.status).toBe("paused");
    expect(recovered.budget).toEqual({ limit: 100, spent: 3, reserved: 0 });
    expect(executeAssistantAction).not.toHaveBeenCalled();
  });
  it("缺地点标签的最坏费用已计入，prepare结果动态展开参考板", async () => {
    await prisma.scene.update({
      where: { id: sceneId },
      data: { locationKey: null },
    });
    vi.mocked(executeAssistantAction).mockImplementation((input) =>
      perform(
        input,
        input.kind === "prepare" ? { artifact: { locations: ["新地点"] } } : {}
      )
    );
    const created = await plan();
    expect(created.plan.baseCredits).toBe(9);
    await confirm(created.id);
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.steps.find((step) => step.kind === "location")?.targetId).toBe(
      "新地点"
    );
    expect(state.budget.spent).toBe(9);
  });
  it("两个并发扣完余额的真实事务只允许一次成功且余额不负", async () => {
    await prisma.user.update({ where: { id: userId }, data: { credits: 10 } });
    const charge = () =>
      prisma.$transaction((tx) =>
        chargeCredits(tx, {
          userId,
          amount: 10,
          type: "GENERATE_IMAGE",
          source: "test:concurrent",
          sourceId: randomUUID(),
        })
      );
    const results = await Promise.allSettled([charge(), charge()]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).credits
    ).toBe(0);
    expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(1);
  });
  it("旧计划带剧情标题地点时暂停，不继续付费生成，保留已完成费用", async () => {
    await prisma.scene.update({
      where: { id: sceneId },
      data: { locationKey: "剑悬颈", description: "刑台上剑悬颈" },
    });
    await prisma.shortDramaScript.create({
      data: {
        projectId,
        scriptDoc: {
          scenes: [{ title: "剑悬颈", description: "刑台上剑悬颈" }],
        },
      },
    });
    const created = await plan();
    await confirm(created.id);
    await mutateExecution(created.id, userId, (state) => {
      delete state.plan.locationLabelsVersion;
      state.steps[0].status = "completed";
      state.budget.spent = 7;
    });
    await runAssistantExecution(created.id);
    const state = await readAssistantExecution(userId, created.id);
    expect(state.status).toBe("paused");
    expect(state.resumeBlocked).toBe(true);
    expect(state.error).toContain("剧情标题");
    expect(state.budget.spent).toBe(7);
    expect(executeAssistantAction).not.toHaveBeenCalled();
  });
});
