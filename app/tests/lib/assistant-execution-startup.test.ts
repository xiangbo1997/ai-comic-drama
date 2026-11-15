import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNode } from "@/instrumentation-node";
import { startAssistantExecutionWorker } from "@/services/assistant-execution/worker";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/env", () => ({
  DEFAULT_GENERATION_MAX_CONCURRENCY: 2,
  getLimitsEnv: () => ({}),
  getObservabilityEnv: () => ({}),
  getRedisEnv: () => ({}),
  getRuntimeEnv: () => ({ isProduction: false, nodeEnv: "test" }),
  getStorageEnv: () => ({}),
  validateEnv: () => ({ success: true, errors: [] }),
}));
vi.mock("@/services/assistant-execution/worker", () => ({
  startAssistantExecutionWorker: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("启动恢复仅运行在服务进程", () => {
  it("Next生产构建不启动执行器或恢复已确认任务", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await registerNode();
    expect(startAssistantExecutionWorker).not.toHaveBeenCalled();
  });
  it("服务启动注册持久任务扫描", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await registerNode();
    expect(startAssistantExecutionWorker).toHaveBeenCalledOnce();
  });
});
