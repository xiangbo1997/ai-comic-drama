import { describe, it, expect } from "vitest";
import { resolveVolcengineCredentials } from "@/services/ai/providers/tts/volcengine-config";

/**
 * 火山 TTS 凭证解析纯函数测试（D1）
 *
 * 核心保障：生成路径与连通性测试共用同一解析规则，优先级严格一致，
 * 从根上消除「测试通过、生成断裂」。env 显式注入，不污染全局。
 */
describe("resolveVolcengineCredentials", () => {
  const emptyEnv: Record<string, string | undefined> = {};

  it("优先读 extraConfig.accessToken / appId", () => {
    const result = resolveVolcengineCredentials(
      {
        apiKey: "from-api-key",
        extraConfig: { accessToken: "extra-token", appId: "extra-app" },
      },
      { VOLC_ACCESS_TOKEN: "env-token", VOLC_APP_ID: "env-app" }
    );
    expect(result).toEqual({ accessToken: "extra-token", appId: "extra-app" });
  });

  it("extraConfig 缺 accessToken 时回落到 config.apiKey", () => {
    const result = resolveVolcengineCredentials(
      { apiKey: "from-api-key", extraConfig: { appId: "extra-app" } },
      emptyEnv
    );
    expect(result.accessToken).toBe("from-api-key");
    expect(result.appId).toBe("extra-app");
  });

  it("均缺失时 accessToken 回落到 env.VOLC_ACCESS_TOKEN、appId 回落到 env.VOLC_APP_ID", () => {
    const result = resolveVolcengineCredentials(
      {},
      { VOLC_ACCESS_TOKEN: "env-token", VOLC_APP_ID: "env-app" }
    );
    expect(result).toEqual({ accessToken: "env-token", appId: "env-app" });
  });

  it("全部缺失时返回空字符串（供上游抛「未配置」错误）", () => {
    const result = resolveVolcengineCredentials({}, emptyEnv);
    expect(result).toEqual({ accessToken: "", appId: "" });
  });

  it("空白值被 trim 后视为缺失，触发下一级回落", () => {
    const result = resolveVolcengineCredentials(
      { apiKey: "   ", extraConfig: { accessToken: "  ", appId: "  " } },
      { VOLC_ACCESS_TOKEN: "env-token", VOLC_APP_ID: "env-app" }
    );
    expect(result).toEqual({ accessToken: "env-token", appId: "env-app" });
  });

  it("值两端空白被 trim", () => {
    const result = resolveVolcengineCredentials(
      { extraConfig: { accessToken: " tok ", appId: " app " } },
      emptyEnv
    );
    expect(result).toEqual({ accessToken: "tok", appId: "app" });
  });
});
