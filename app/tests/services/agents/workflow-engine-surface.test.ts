/**
 * workflow-engine 对外契约特征测试
 *
 * 该模块被 3 条 API 路由直接 import（workflow/route.ts、workflow/[id]/route.ts、
 * workflow/[id]/events/route.ts）与 agents/index.ts 再导出。按管线步骤拆分到
 * `workflow/` 子目录后，导出面若少一个符号，编译期能拦住路由但拦不住动态引用；
 * 这里把「导出了哪些、各是什么类型」钉死，让后续再拆分时立刻可见破坏。
 */

import { describe, it, expect } from "vitest";

// workflow-engine 透过 lib/prisma 建 pg Pool（仅构造对象，不发起连接），无
// DATABASE_URL 时 import 阶段即抛错。给一个占位串让模块能载入；本测试只读导出面，
// 不调用任何触库函数。
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

const engine = await import("@/services/agents/workflow-engine");

describe("workflow-engine 导出面", () => {
  it("导出且仅导出 4 个公开符号", () => {
    expect(Object.keys(engine).sort()).toEqual([
      "cancelWorkflow",
      "getWorkflowStatus",
      "startWorkflow",
      "subscribeWorkflowEvents",
    ]);
  });

  it("四个符号均为函数", () => {
    expect(typeof engine.startWorkflow).toBe("function");
    expect(typeof engine.getWorkflowStatus).toBe("function");
    expect(typeof engine.cancelWorkflow).toBe("function");
    expect(typeof engine.subscribeWorkflowEvents).toBe("function");
  });

  it("函数形参个数不变（调用方按此传参）", () => {
    // startWorkflow(projectId, userId, inputText, config)
    expect(engine.startWorkflow.length).toBe(4);
    // getWorkflowStatus(workflowRunId) / cancelWorkflow(workflowRunId)
    expect(engine.getWorkflowStatus.length).toBe(1);
    expect(engine.cancelWorkflow.length).toBe(1);
    // subscribeWorkflowEvents(workflowRunId, listener)
    expect(engine.subscribeWorkflowEvents.length).toBe(2);
  });

  it("subscribeWorkflowEvents 与 event-bus 是同一实现（re-export 未被复制）", async () => {
    const bus = await import("@/services/agents/event-bus");
    expect(engine.subscribeWorkflowEvents).toBe(bus.subscribeWorkflowEvents);
  });
});
