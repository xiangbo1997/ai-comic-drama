import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { continueProducerRun } from "@/lib/producer-workflow-client";
import {
  advanceProducerRun,
  createAndLinkCharacter,
  createProducerDraftFinalizer,
  getProducerRun,
  runDramaScript,
} from "@/lib/producer-client";
import { draftWorldview, draftCharacterRoster } from "@/lib/assist-client";
import type { ProducerRunSnapshot } from "@/lib/producer-run";

const { finalizer } = vi.hoisted(() => ({ finalizer: vi.fn() }));
vi.mock("@/lib/producer-client", () => ({
  advanceProducerRun: vi.fn(),
  createAndLinkCharacter: vi.fn(),
  createProducerDraftFinalizer: vi.fn(() => finalizer),
  getProducerRun: vi.fn(),
  runDramaScript: vi.fn(),
}));
vi.mock("@/lib/assist-client", () => ({
  draftWorldview: vi.fn(),
  draftCharacterRoster: vi.fn(),
}));
const artifact = {
  filmTitle: "门外",
  genre: "悬疑",
  worldview: "每晚有人敲门",
  protagonist: "阿宁",
  style: "anime",
  aspectRatio: "9:16",
  durationSec: 90,
  logline: "门外的自己",
  scenes: [
    {
      index: 1,
      title: "敲门",
      description: "阿宁在深夜听见门外传来敲门声",
      dialogue: null,
      narration: null,
      emotion: "fear",
      durationSec: 4,
      characters: ["阿宁"],
    },
  ],
};
const makeRun = (): ProducerRunSnapshot => ({
  id: "run1",
  projectId: "p1",
  settings: {
    idea: "门外站着另一个自己",
    style: "anime",
    aspectRatio: "9:16",
    durationSec: 90,
    genre: "悬疑",
  },
  version: 1,
  status: "paused",
  completedSteps: ["worldview", "project", "script", "characters"],
  artifact,
  scriptId: "script1",
  worldviewDraft: {
    filmTitle: "门外",
    worldview: "每晚有人敲门",
    protagonist: "调查员",
    genre: "悬疑",
  },
  createdCharNames: ["阿宁"],
  leaseExpiresAt: null,
  error: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProducerRun).mockResolvedValue({
    ...makeRun(),
    status: "completed",
    completedSteps: ["worldview", "project", "script", "characters", "scenes"],
  });
});
afterEach(() => vi.useRealTimers());
describe("服务端checkpoint驱动续跑", () => {
  it("从空checkpoint完整执行五步并持久保存每步产物", async () => {
    let run: ProducerRunSnapshot = {
      ...makeRun(),
      projectId: null,
      completedSteps: [],
      worldviewDraft: undefined,
      artifact: undefined,
      scriptId: undefined,
      createdCharNames: [],
    };
    vi.mocked(draftWorldview).mockResolvedValue(makeRun().worldviewDraft!);
    vi.mocked(runDramaScript).mockResolvedValue({
      scriptId: "script1",
      artifact,
    });
    vi.mocked(draftCharacterRoster).mockResolvedValue({
      characters: [
        { name: "阿宁", gender: "女", age: "25", description: "调查员" },
      ],
    });
    vi.mocked(advanceProducerRun).mockImplementation(async (_id, action) => {
      if (action.action === "worldview")
        run = {
          ...run,
          worldviewDraft: action.draft,
          completedSteps: ["worldview"],
        };
      if (action.action === "project")
        run = {
          ...run,
          projectId: "p1",
          completedSteps: [...run.completedSteps, "project"],
        };
      if (action.action === "script")
        run = {
          ...run,
          scriptId: action.scriptId,
          artifact,
          completedSteps: [...run.completedSteps, "script"],
        };
      if (action.action === "roster") run = { ...run, roster: action.roster };
      if (action.action === "character")
        run = { ...run, createdCharNames: [action.name] };
      if (action.action === "characters")
        run = { ...run, completedSteps: [...run.completedSteps, "characters"] };
      return run;
    });
    const onStep = vi.fn();
    const result = await continueProducerRun("run1", vi.fn(), onStep);
    expect(result.status).toBe("completed");
    expect(onStep.mock.calls.map(([step]) => step)).toEqual([
      "worldview",
      "project",
      "script",
      "characters",
      "scenes",
    ]);
    expect(createAndLinkCharacter).toHaveBeenCalledWith(
      "p1",
      "阿宁",
      expect.objectContaining({ gender: "女" })
    );
  });
  it("画像失败时保存空画像降级，仍建档并持久记录", async () => {
    let run: ProducerRunSnapshot = {
      ...makeRun(),
      completedSteps: ["worldview", "project", "script"],
      createdCharNames: [],
    };
    vi.mocked(draftCharacterRoster).mockRejectedValue(new Error("画像不可用"));
    vi.mocked(advanceProducerRun).mockImplementation(async (_id, action) => {
      if (action.action === "roster") run = { ...run, roster: action.roster };
      if (action.action === "character")
        run = { ...run, createdCharNames: [action.name] };
      if (action.action === "characters")
        run = { ...run, completedSteps: [...run.completedSteps, "characters"] };
      return run;
    });
    await continueProducerRun("run1", vi.fn(), vi.fn());
    expect(advanceProducerRun).toHaveBeenCalledWith(
      "run1",
      expect.objectContaining({ action: "roster", roster: [] })
    );
    expect(createAndLinkCharacter).toHaveBeenCalledOnce();
  });
  it("已完成checkpoint只展示结果，不再次制作", async () => {
    vi.mocked(advanceProducerRun).mockResolvedValue({
      ...makeRun(),
      status: "completed",
    });
    expect((await continueProducerRun("run1", vi.fn(), vi.fn())).status).toBe(
      "completed"
    );
    expect(finalizer).not.toHaveBeenCalled();
    expect(advanceProducerRun).toHaveBeenCalledOnce();
  });
  it("长步骤续租失败后不保存过期结果，释放状态提示恢复", async () => {
    vi.useFakeTimers();
    let resolveDraft!: (
      value: NonNullable<ProducerRunSnapshot["worldviewDraft"]>
    ) => void;
    vi.mocked(draftWorldview).mockReturnValue(
      new Promise((resolve) => {
        resolveDraft = resolve;
      })
    );
    vi.mocked(advanceProducerRun).mockImplementation(async (_id, action) => {
      if (action.action === "heartbeat") throw new Error("会话已转移");
      return { ...makeRun(), completedSteps: [] };
    });
    const result = continueProducerRun("run1", vi.fn(), vi.fn());
    const assertion = expect(result).rejects.toThrow("会话已转移");
    await vi.advanceTimersByTimeAsync(20001);
    resolveDraft(makeRun().worldviewDraft!);
    await assertion;
    expect(advanceProducerRun).not.toHaveBeenCalledWith(
      "run1",
      expect.objectContaining({ action: "worldview" })
    );
  });
  it("恢复4/5只收尾，不重做世界观/项目/脚本/角色", async () => {
    vi.mocked(advanceProducerRun).mockResolvedValue(makeRun());
    const result = await continueProducerRun("run1", vi.fn(), vi.fn());
    expect(result.status).toBe("completed");
    expect(draftWorldview).not.toHaveBeenCalled();
    expect(runDramaScript).not.toHaveBeenCalled();
    expect(createAndLinkCharacter).not.toHaveBeenCalled();
    expect(createProducerDraftFinalizer).toHaveBeenCalledOnce();
    expect(finalizer).toHaveBeenCalledWith(
      "p1",
      artifact,
      ["阿宁"],
      "悬疑",
      expect.objectContaining({ runId: "run1" })
    );
  });
  it("收尾失败释放租约并保存错误，下一次从服务端重读", async () => {
    vi.mocked(advanceProducerRun).mockResolvedValue(makeRun());
    finalizer.mockRejectedValueOnce(new Error("保存失败"));
    await expect(continueProducerRun("run1", vi.fn(), vi.fn())).rejects.toThrow(
      "保存失败"
    );
    expect(advanceProducerRun).toHaveBeenLastCalledWith(
      "run1",
      expect.objectContaining({ action: "release", error: "保存失败" })
    );
    await continueProducerRun("run1", vi.fn(), vi.fn());
    expect(advanceProducerRun).toHaveBeenCalledWith(
      "run1",
      expect.objectContaining({ action: "claim" })
    );
    expect(finalizer).toHaveBeenCalledTimes(2);
  });
  it("恢复角色步骤复用已完成角色和已存画像，逐个保存进度", async () => {
    let run = {
      ...makeRun(),
      completedSteps: [
        "worldview",
        "project",
        "script",
      ] as ProducerRunSnapshot["completedSteps"],
      roster: [
        { name: "阿宁", gender: "女", age: "25", description: "调查员" },
      ],
    };
    vi.mocked(advanceProducerRun).mockImplementation(async (_id, action) => {
      if (action.action === "characters")
        run = { ...run, completedSteps: [...run.completedSteps, "characters"] };
      return run;
    });
    await continueProducerRun("run1", vi.fn(), vi.fn());
    expect(draftCharacterRoster).not.toHaveBeenCalled();
    expect(createAndLinkCharacter).not.toHaveBeenCalled();
    expect(advanceProducerRun).toHaveBeenCalledWith(
      "run1",
      expect.objectContaining({ action: "characters" })
    );
  });
  it("新角色建档成功后记录单角色checkpoint再推进", async () => {
    let run = {
      ...makeRun(),
      completedSteps: [
        "worldview",
        "project",
        "script",
      ] as ProducerRunSnapshot["completedSteps"],
      createdCharNames: [] as string[],
      roster: [],
    };
    vi.mocked(advanceProducerRun).mockImplementation(async (_id, action) => {
      if (action.action === "character")
        run = { ...run, createdCharNames: [action.name] };
      if (action.action === "characters")
        run = { ...run, completedSteps: [...run.completedSteps, "characters"] };
      return run;
    });
    await continueProducerRun("run1", vi.fn(), vi.fn());
    expect(createAndLinkCharacter).toHaveBeenCalledWith(
      "p1",
      "阿宁",
      undefined
    );
    expect(advanceProducerRun).toHaveBeenCalledWith(
      "run1",
      expect.objectContaining({ action: "character", name: "阿宁" })
    );
  });
  it("页面已离开时不继续发生成请求", async () => {
    vi.mocked(advanceProducerRun).mockResolvedValue(makeRun());
    await expect(
      continueProducerRun("run1", vi.fn(), vi.fn(), () => true)
    ).rejects.toThrow("已暂停");
    expect(finalizer).not.toHaveBeenCalled();
  });
  it("被另一标签页持有时不推进任何操作", async () => {
    vi.mocked(advanceProducerRun).mockRejectedValue(
      new Error("另一个窗口正在制作")
    );
    await expect(continueProducerRun("run1", vi.fn(), vi.fn())).rejects.toThrow(
      "另一个窗口"
    );
    expect(finalizer).not.toHaveBeenCalled();
  });
});
