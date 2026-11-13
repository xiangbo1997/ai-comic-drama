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
import { POST as postScenes } from "@/app/api/projects/[id]/scenes/route";
import { POST as postCharacter } from "@/app/api/characters/route";
import { POST as postScript } from "@/app/api/projects/[id]/drama-script/route";
import { PATCH as patchProject } from "@/app/api/projects/[id]/route";
import { POST as cleanup } from "@/app/api/admin/cleanup/route";
import { saveScenesToProject } from "@/services/agents/workflow/scene-persistence";
import { extractProducerCharacterNames } from "@/lib/producer-character-extract";
import type { ScriptArtifact } from "@/services/agents/types";
import {
  createProducerRun,
  advanceProducerRun,
  readProducerRun,
} from "@/services/producer-runs";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: session.userId } })),
}));
vi.mock("@/lib/ai-config", () => ({
  getUserLLMConfig: vi.fn(async () => ({ model: "local-mock" })),
}));
vi.mock("@/services/drama-script", () => ({
  generateDramaScript: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/services/drama-script-context", () => ({
  derivePreviousEpisodeRecap: vi.fn(async () => undefined),
  readStoredGenre: vi.fn(() => undefined),
}));
vi.mock("@/services/series/chronicler", () => ({ chronicleEpisode: vi.fn() }));
vi.mock("@/services/storage", () => ({ deleteFile: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(async () => ({ id: session.userId })),
}));
vi.mock("@/lib/admin-audit", () => ({
  writeAuditLog: vi.fn(),
  requestIp: vi.fn(),
}));
vi.mock("@/lib/cleanup/attempt-retention", () => ({
  pruneSceneAttempts: vi.fn(async () => ({
    deletedAttempts: 0,
    deletedFiles: 0,
  })),
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

let projectId = "";
const scene = (description = "阿宁在门边停下，听见外面有人呼唤。") => ({
  shotType: "近景",
  description,
  characters: [],
  dialogue: null,
  narration: null,
  emotion: "fear",
  duration: 4,
});
const request = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
const apply = (operationId: string, scenes = [scene()]) =>
  postScenes(
    request(`/api/projects/${projectId}/scenes`, { scenes, operationId }),
    {
      params: Promise.resolve({ id: projectId }),
    }
  );
const script = (scenes: unknown[]) =>
  ({ title: "并发测试", characters: [], scenes }) as ScriptArtifact;

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `verify-${randomUUID()}@example.test` },
  });
  session.userId = user.id;
  const project = await prisma.project.create({
    data: { userId: user.id, title: "隔离数据库验收" },
  });
  projectId = project.id;
});
afterEach(async () => {
  await prisma.generationTask.deleteMany({
    where: {
      OR: [
        { projectId },
        { input: { path: ["userId"], equals: session.userId } },
      ],
    },
  });
  await prisma.user.delete({ where: { id: session.userId } });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("真实PostgreSQL并发与事务（模型和鉴权为替身）", () => {
  it("实际历史清理保留旧checkpoint/凭证并删除缺kind和null的普通过期任务", async () => {
    const kinds = [
      "producer_checkpoint",
      "producer_scene_apply",
      "drama_script",
      null,
      undefined,
    ];
    for (const kind of kinds) {
      await prisma.generationTask.create({
        data: {
          type: "SCRIPT_PARSE",
          status: "COMPLETED",
          projectId,
          updatedAt: new Date("2020-01-01"),
          input: {
            userId: session.userId,
            ...(kind === undefined ? {} : { kind }),
          },
        },
      });
    }
    const response = await cleanup(request("/api/admin/cleanup", {}));
    expect(response.status).toBe(200);
    expect((await response.json()).deletedTasks).toBe(3);
    const current = await prisma.generationTask.findMany({
      where: { projectId },
    });
    expect(
      current.map((row) => (row.input as { kind: string }).kind).sort()
    ).toEqual(["producer_checkpoint", "producer_scene_apply"]);
  });

  const settings = {
    idea: "失踪的哥哥带着一份陌生合同回到家中",
    style: "anime",
    aspectRatio: "9:16" as const,
    durationSec: 90,
    genre: "悬疑",
  };
  async function preparedRun() {
    const run = await createProducerRun(session.userId, randomUUID(), settings);
    const token = "integrity-tab";
    await advanceProducerRun(session.userId, run.id, {
      action: "claim",
      token,
    });
    await advanceProducerRun(session.userId, run.id, {
      action: "worldview",
      token,
      draft: {
        filmTitle: "归来",
        worldview: "城市每晚重置记忆",
        protagonist: "调查员",
        genre: "悬疑",
      },
    });
    const ready = await advanceProducerRun(session.userId, run.id, {
      action: "project",
      token,
    });
    projectId = ready.projectId!;
    const artifact = {
      filmTitle: "归来",
      worldview: "城市每晚重置记忆",
      protagonist: "调查员",
      scenes: [],
      genre: "悬疑",
    };
    const savedScript = await prisma.shortDramaScript.create({
      data: { projectId, scriptDoc: artifact },
    });
    await advanceProducerRun(session.userId, run.id, {
      action: "script",
      token,
      scriptId: savedScript.id,
    });
    for (const name of extractProducerCharacterNames(artifact as never)) {
      const created = await postCharacter(
        request("/api/characters", { name, producerProjectId: projectId })
      );
      expect([200, 201]).toContain(created.status);
    }
    await advanceProducerRun(session.userId, run.id, {
      action: "characters",
      token,
    });
    return { run, token, savedScript, artifact };
  }

  it("完成脚本checkpoint不可被其他scriptId重放覆盖，同ID也不重读改写正文", async () => {
    const { run, token, savedScript, artifact } = await preparedRun();
    const other = await prisma.shortDramaScript.create({ data: { projectId } });
    await expect(
      advanceProducerRun(session.userId, run.id, {
        action: "script",
        token,
        scriptId: other.id,
      })
    ).rejects.toMatchObject({ status: 409 });
    await prisma.shortDramaScript.update({
      where: { id: savedScript.id },
      data: { scriptDoc: { ...artifact, filmTitle: "手动修改版" } },
    });
    const retry = await advanceProducerRun(session.userId, run.id, {
      action: "script",
      token,
      scriptId: savedScript.id,
    });
    expect(retry.artifact?.filmTitle).toBe("归来");
  });

  it("收尾必须匹配本run分镜应用凭证，手动替换后拒绝误完成", async () => {
    const { run, token } = await preparedRun();
    await postScenes(
      request(`/api/projects/${projectId}/scenes`, { scenes: [scene()] }),
      { params: Promise.resolve({ id: projectId }) }
    );
    await expect(
      advanceProducerRun(session.userId, run.id, { action: "finalize", token })
    ).rejects.toMatchObject({ status: 409 });
    const applied = await apply(`producer-scenes:${run.id}`);
    expect(applied.status).toBe(201);
    // 模拟应用成功之后，用户在别处手动替换了这些分镜。
    await postScenes(
      request(`/api/projects/${projectId}/scenes`, {
        scenes: [scene("其他窗口已换成另一版剧情，旧草稿不得覆盖。")],
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    await expect(
      advanceProducerRun(session.userId, run.id, { action: "finalize", token })
    ).rejects.toMatchObject({ status: 409 });
    expect((await readProducerRun(session.userId, run.id)).status).not.toBe(
      "completed"
    );
  });

  it("匹配的持久分镜凭证允许收尾并保留已有项目配置", async () => {
    const { run, token } = await preparedRun();
    expect((await apply(`producer-scenes:${run.id}`)).status).toBe(201);
    await prisma.project.update({
      where: { id: projectId },
      data: { generationParams: { temperature: 0.7, genre: "悬疑" } },
    });
    const result = await advanceProducerRun(session.userId, run.id, {
      action: "finalize",
      token,
    });
    expect(result.status).toBe("completed");
    expect(
      (await prisma.project.findUniqueOrThrow({ where: { id: projectId } }))
        .generationParams
    ).toMatchObject({
      temperature: 0.7,
      producerReview: { createdByProducer: true },
    });
  });
  it("12个并发checkpoint创建只生成一个草稿，刷新后可读取且不泄露租约token", async () => {
    const operationId = randomUUID();
    const runs = await Promise.all(
      Array.from({ length: 12 }, () =>
        createProducerRun(session.userId, operationId, settings)
      )
    );
    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    await advanceProducerRun(session.userId, runs[0].id, {
      action: "claim",
      token: "tab-a",
    });
    const restored = await readProducerRun(session.userId, runs[0].id);
    expect(restored.settings).toEqual(settings);
    expect(restored).not.toHaveProperty("lease");
    expect(
      await prisma.generationTask.count({
        where: { input: { path: ["userId"], equals: session.userId } },
      })
    ).toBe(1);
    await expect(
      readProducerRun("another-user", runs[0].id)
    ).rejects.toMatchObject({ status: 404 });
  });

  it("项目创建响应丢失后可从checkpoint找回，重复推进不新增项目", async () => {
    const run = await createProducerRun(session.userId, randomUUID(), settings);
    const token = "tab-project";
    await advanceProducerRun(session.userId, run.id, {
      action: "claim",
      token,
    });
    await advanceProducerRun(session.userId, run.id, {
      action: "worldview",
      token,
      draft: {
        filmTitle: "归来",
        worldview: "城市每晚重置记忆",
        protagonist: "调查员",
        genre: "悬疑",
      },
    });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        advanceProducerRun(session.userId, run.id, { action: "project", token })
      )
    );
    expect(new Set(attempts.map((value) => value.projectId)).size).toBe(1);
    const restored = await readProducerRun(session.userId, run.id);
    expect(restored.projectId).toBe(attempts[0].projectId);
    expect(restored.completedSteps).toEqual(["worldview", "project"]);
    // beforeEach已有一个独立项目，此处只新增一个。
    expect(
      await prisma.project.count({ where: { userId: session.userId } })
    ).toBe(2);
  });

  it("活跃租约排除其他标签页，过期交接后旧持有者被拒绝", async () => {
    const run = await createProducerRun(session.userId, randomUUID(), settings);
    await advanceProducerRun(session.userId, run.id, {
      action: "claim",
      token: "tab-a",
    });
    await expect(
      advanceProducerRun(session.userId, run.id, {
        action: "claim",
        token: "tab-b",
      })
    ).rejects.toMatchObject({ status: 409 });
    const task = await prisma.generationTask.findUniqueOrThrow({
      where: { id: run.id },
    });
    const output = task.output as Record<string, unknown>;
    await prisma.generationTask.update({
      where: { id: run.id },
      data: { output: { ...output, lease: { token: "tab-a", expiresAt: 0 } } },
    });
    await advanceProducerRun(session.userId, run.id, {
      action: "claim",
      token: "tab-b",
    });
    await expect(
      advanceProducerRun(session.userId, run.id, {
        action: "heartbeat",
        token: "tab-a",
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (
        await advanceProducerRun(session.userId, run.id, {
          action: "heartbeat",
          token: "tab-b",
        })
      ).status
    ).toBe("running");
  });

  it("并发编辑不同配置字段会合并，向导新写字段不会被旧页面擦掉", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { generationParams: { genre: "悬疑" } },
    });
    const save = (generationParams: unknown) =>
      patchProject(
        new NextRequest(`http://localhost/api/projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify({ generationParamsBase: {}, generationParams }),
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
    const responses = await Promise.all([
      save({ temperature: 0.8 }),
      save({ styleStrength: 0.6 }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect(project.generationParams).toEqual({
      genre: "悬疑",
      temperature: 0.8,
      styleStrength: 0.6,
    });
  });

  it("并发修改同一个配置字段只接受一个，其余409保留已存结果", async () => {
    const save = (temperature: number) =>
      patchProject(
        new NextRequest(`http://localhost/api/projects/${projectId}`, {
          method: "PATCH",
          body: JSON.stringify({
            generationParamsBase: {},
            generationParams: { temperature },
          }),
        }),
        { params: Promise.resolve({ id: projectId }) }
      );
    const responses = await Promise.all([save(0.3), save(0.9)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    expect([0.3, 0.9]).toContain(
      (project.generationParams as { temperature: number }).temperature
    );
  });

  it("12个同时分镜提交只应用一次，响应丢失后重试保持sceneId", async () => {
    const operationId = `producer-scenes:${randomUUID()}`;
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => apply(operationId))
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(11);
    const outputs = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(outputs.map((rows) => rows[0].id)).size).toBe(1);
    const retry = await (await apply(operationId)).json();
    expect(retry[0].id).toBe(outputs[0][0].id);
    expect(await prisma.scene.count({ where: { projectId } })).toBe(1);
    expect(await prisma.generationTask.count({ where: { projectId } })).toBe(1);
  });

  it("同操作编号改正文返回409且不删除原分镜", async () => {
    const operationId = `producer-scenes:${randomUUID()}`;
    const original = await (await apply(operationId)).json();
    expect(
      (await apply(operationId, [scene("阿宁冲向楼梯，发现出口已经被封住。")]))
        .status
    ).toBe(409);
    const current = await prisma.scene.findMany({ where: { projectId } });
    expect(current[0].id).toBe(original[0].id);
    expect(current[0].description).toBe(scene().description);
  });

  it("12个同时制片人建角色只建一档并完成一次关联", async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        postCharacter(
          request("/api/characters", {
            name: "阿宁",
            description: "寻找失踪哥哥的少女",
            producerProjectId: projectId,
          })
        )
      )
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(11);
    const outputs = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(outputs.map((value) => value.id)).size).toBe(1);
    expect(
      await prisma.character.count({ where: { userId: session.userId } })
    ).toBe(1);
    expect(await prisma.projectCharacter.count({ where: { projectId } })).toBe(
      1
    );
  });

  it("12个同时脚本请求只启动一个持久任务", async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        postScript(
          request(`/api/projects/${projectId}/drama-script`, {
            worldview: "失踪的哥哥带着一份陌生合同回到家中",
            durationSec: 90,
            reuseProducerTask: true,
          }),
          { params: Promise.resolve({ id: projectId }) }
        )
      )
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const outputs = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(outputs.map((value) => value.taskId)).size).toBe(1);
    expect(await prisma.generationTask.count({ where: { projectId } })).toBe(1);
  });

  it("第二镜写入错误时整批回滚，第一镜正文和已有媒体保持原样", async () => {
    await saveScenesToProject(
      projectId,
      script([
        { ...scene(), id: 1 },
        { ...scene(), id: 2 },
      ])
    );
    const original = await prisma.scene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });
    await prisma.scene.update({
      where: { id: original[0].id },
      data: { imageUrl: "/uploads/existing.png", imageStatus: "COMPLETED" },
    });
    await expect(
      saveScenesToProject(
        projectId,
        script([
          { ...scene("第一镜试图修改，但事务失败后不应留下变化。"), id: 1 },
          { ...scene(), id: 2, duration: "invalid-duration" },
        ])
      )
    ).rejects.toThrow();
    const current = await prisma.scene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });
    expect(current.map((s) => [s.id, s.description])).toEqual(
      original.map((s) => [s.id, s.description])
    );
    expect(current[0].imageUrl).toBe("/uploads/existing.png");
    expect(current[0].imageStatus).toBe("COMPLETED");
  });

  it("手动零起镜序进入workflow时保留原镜ID、媒体与先后顺序", async () => {
    const response = await postScenes(
      request(`/api/projects/${projectId}/scenes`, {
        scenes: [
          scene("阿宁推开门，门后站着一个陌生人。"),
          scene("陌生人摘下帽子，露出哥哥熟悉的面孔。"),
        ],
      }),
      { params: Promise.resolve({ id: projectId }) }
    );
    expect(response.status).toBe(201);
    const original = await response.json();
    await prisma.scene.update({
      where: { id: original[0].id },
      data: { imageUrl: "/uploads/first.png" },
    });
    await prisma.scene.update({
      where: { id: original[1].id },
      data: { imageUrl: "/uploads/second.png" },
    });
    await saveScenesToProject(
      projectId,
      script([
        { ...scene(), id: 1 },
        { ...scene(), id: 2 },
      ])
    );
    const current = await prisma.scene.findMany({
      where: { projectId },
      orderBy: { order: "asc" },
    });
    expect(current.map((s) => s.id)).toEqual(
      original.map((s: { id: string }) => s.id)
    );
    expect(current.map((s) => s.imageUrl)).toEqual([
      "/uploads/first.png",
      "/uploads/second.png",
    ]);
    expect(current.map((s) => s.order)).toEqual([1, 2]);
  });
});
