import { safeFetch } from "@/lib/url-guard";
import { trimUrl } from "./providers/base";
import type { TestResult } from "./connectivity-test-types";

/** 只检查登记与鉴权，不向聊天端点提交语音模型，也不偷偷产生付费音频。 */
export async function testTTSModelListing(
  apiKey: string,
  baseUrl: string,
  modelId?: string | null
): Promise<TestResult> {
  const response = await safeFetch(`${trimUrl(baseUrl)}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const authError = response.status === 401 || response.status === 403;
    return {
      success: false,
      errorType: authError ? "auth" : "network",
      message: `语音模型列表检查失败（HTTP ${response.status}），未执行语音合成`,
      suggestion: authError
        ? "请检查当前语音配置的API Key"
        : "请检查Base URL和网关的/models接口；本测试不会调用聊天接口",
    };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return {
      success: false,
      errorType: "config",
      message: "语音模型列表未返回有效JSON，请检查网关地址；未执行语音合成",
    };
  }
  const record =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const models = record.data ?? record.models;
  if (!Array.isArray(models))
    return {
      success: false,
      errorType: "config",
      message: "上游返回的模型列表格式不正确，未执行语音合成",
    };
  const ids = models.flatMap((model) =>
    typeof model === "string"
      ? [model]
      : model && typeof model === "object" && typeof model.id === "string"
        ? [model.id]
        : []
  );
  if (modelId && !ids.includes(modelId))
    return {
      success: false,
      errorType: "model",
      message: `模型列表未登记「${modelId}」，尚不能确认该语音模型可用；未执行语音合成`,
      suggestion:
        "请刷新模型列表核对模型ID；未列出不等于语音接口一定不支持，需向供应商确认",
    };
  return {
    success: true,
    message: `${modelId ? "语音模型已登记，" : ""}鉴权及模型列表连接成功；未执行真实语音合成`,
  };
}
