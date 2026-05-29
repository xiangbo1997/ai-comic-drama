import { describe, it, expect, vi } from "vitest";
import { runClosedLoop } from "@/services/agents/closed-loop";
import type { ObserverVerdict, WorkflowContext } from "@/services/agents/types";

/** 最小 WorkflowContext stub（仅 emit 被用到） */
function fakeCtx(): WorkflowContext {
  return {
    workflowRunId: "wf-1",
    projectId: "p-1",
    userId: "u-1",
    config: {
      mode: "auto",
      maxImageReflectionRounds: 3,
      style: "anime",
    },
    artifacts: {
      get: () => undefined,
      set: () => {},
      getAll: () => [],
    },
    emit: vi.fn(),
  } as unknown as WorkflowContext;
}

function verdict(
  overall: number,
  pass: boolean,
  retryable = true
): ObserverVerdict {
  return {
    pass,
    score: { overall, dimensions: {}, pass, feedback: `s${overall}` },
    retryable,
    suggestions: [],
  };
}

describe("runClosedLoop()", () => {
  it("首轮通过：立即返回，不调用 reflect", async () => {
    const reflect = vi.fn();
    const r = await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 3,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => "img-1",
        evaluate: async () => verdict(90, true),
        reflect,
      },
      fakeCtx()
    );

    expect(r.passed).toBe(true);
    expect(r.best).toBe("img-1");
    expect(r.bestScore).toBe(90);
    expect(r.rounds).toBe(1);
    expect(reflect).not.toHaveBeenCalled();
  });

  it("不通过则反思重试，返回历史最优", async () => {
    let n = 0;
    const scores = [50, 88, 70]; // 第2轮最高
    const r = await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 3,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => `img-${++n}`,
        evaluate: async () => verdict(scores[n - 1], false),
        reflect: async (s) => ({ p: s.p + "+" }),
      },
      fakeCtx()
    );

    // 全程不 pass，用尽 maxRounds+1=4 次... 但只有3个score，第4次 undefined→NaN
    // 取最高分 88 对应 img-2
    expect(r.best).toBe("img-2");
    expect(r.bestScore).toBe(88);
    expect(r.passed).toBe(false);
  });

  it("retryable=false：立即停止，不反思", async () => {
    const reflect = vi.fn();
    const r = await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 3,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => "img-1",
        evaluate: async () => verdict(40, false, false),
        reflect,
      },
      fakeCtx()
    );

    expect(r.rounds).toBe(1);
    expect(r.best).toBe("img-1");
    expect(reflect).not.toHaveBeenCalled();
  });

  it("评估返回 null：默认接受当前候选", async () => {
    const r = await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 3,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => "img-1",
        evaluate: async () => null,
        reflect: async (s) => s,
      },
      fakeCtx()
    );

    expect(r.best).toBe("img-1");
    expect(r.passed).toBe(true);
  });

  it("评估返回 null 且 acceptOnEvalFailure=false：不接受", async () => {
    const r = await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 3,
        workflowStep: "generate_images",
        taskLabel: "test",
        acceptOnEvalFailure: false,
        generate: async () => "img-1",
        evaluate: async () => null,
        reflect: async (s) => s,
      },
      fakeCtx()
    );

    expect(r.best).toBeNull();
    expect(r.passed).toBe(false);
  });

  it("generate 抛异常：break，返回已有最优", async () => {
    let n = 0;
    const r = await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 3,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => {
          n++;
          if (n === 2) throw new Error("boom");
          return `img-${n}`;
        },
        evaluate: async () => verdict(60, false),
        reflect: async (s) => s,
      },
      fakeCtx()
    );

    // 第1轮生成 img-1 评分60不过→reflect→第2轮 generate 抛错 break
    expect(r.best).toBe("img-1");
    expect(r.bestScore).toBe(60);
  });

  it("防死循环：生成次数上界 = maxRounds + 1", async () => {
    let gen = 0;
    await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 2,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => `img-${++gen}`,
        evaluate: async () => verdict(30, false),
        reflect: async (s) => s,
      },
      fakeCtx()
    );

    expect(gen).toBe(3); // maxRounds(2) + 1
  });

  it("history 累积每轮记录，传给 reflect", async () => {
    const seenHistoryLengths: number[] = [];
    await runClosedLoop<{ p: string }, string>(
      {
        initialState: { p: "init" },
        maxRounds: 2,
        workflowStep: "generate_images",
        taskLabel: "test",
        generate: async () => "img",
        evaluate: async () => verdict(30, false),
        reflect: async (s, _v, history) => {
          seenHistoryLengths.push(history.length);
          return s;
        },
      },
      fakeCtx()
    );

    // 第1轮后 reflect 见 history=1，第2轮后 reflect 见 history=2
    expect(seenHistoryLengths).toEqual([1, 2]);
  });
});
