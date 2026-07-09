/**
 * AI Provider 连通性测试 —— 叶子探测函数集
 *
 * 本文件承载所有直接发起 fetch 的「单协议 / 单厂商」探测实现，供
 * connectivity-test.ts 的门面与分发逻辑调用。拆分动机：单文件超过 800 行
 * 的仓库约定上限，按「分发编排」与「叶子探测」两层拆开。
 *
 * 所有函数返回归一化的 TestResult；错误文案为用户可见（前端直接展示
 * data.message），改动需谨慎。
 */

import { isLLMModel } from "@/services/ai/providers/openai-compatible";
import { flow2apiChatUrl } from "@/services/ai/providers/flow2api-shared";
import type { TestResult } from "./connectivity-test-types";

export const IMAGE_TEST_PROMPT =
  "test image, a simple blue circle on white background";

// ============ 图像模型可用性探测 ============

export async function testOpenAIModelImage(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResult> {
  if (isLLMModel(modelId)) {
    return {
      success: false,
      message: `模型 ${modelId} 是文本模型，不支持图片生成`,
      errorType: "model",
      suggestion:
        "请选择真正的图片模型，例如 dall-e-3、gpt-image-1、grok-2-image 等",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        prompt: IMAGE_TEST_PROMPT,
        size: "1024x1024",
        n: 1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.data?.[0]?.url || data?.data?.[0]?.b64_json) {
        return {
          success: true,
          message: `模型 ${modelId} 已通过真实图片接口测试`,
        };
      }

      return {
        success: false,
        message: `模型 ${modelId} 响应成功，但未返回可解析的图片结果`,
        errorType: "config",
        suggestion: "该通道可能不是标准图片接口，请检查协议或更换供应商",
      };
    }

    const errorText = await response.text();
    const loweredError = errorText.toLowerCase();

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: `图片接口认证失败: ${errorText.slice(0, 300)}`,
        errorType: "auth",
        suggestion: "请检查 API Key 权限，确认该账号具备图片生成权限",
      };
    }

    if (
      response.status === 404 ||
      loweredError.includes("model") ||
      loweredError.includes("not found")
    ) {
      return {
        success: false,
        message: `模型 ${modelId} 无法通过图片接口调用: ${errorText.slice(0, 300)}`,
        errorType: "model",
        suggestion: "请确认该模型是图片模型，且服务商支持 /images/generations",
      };
    }

    return {
      success: false,
      message: `图片接口测试失败 (${response.status}): ${errorText.slice(0, 300)}`,
      errorType: response.status >= 500 ? "network" : "unknown",
      suggestion: "请检查图片接口是否已开通，或稍后重试",
    };
  } catch (error) {
    return {
      success: false,
      message: `图片接口网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查 Base URL 是否正确，并确认该地址支持图片接口",
    };
  }
}

export async function testSiliconFlowModelImage(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResult> {
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        prompt: IMAGE_TEST_PROMPT,
        image_size: "1024x1024",
        num_inference_steps: 1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data?.images?.[0]?.url || data?.data?.[0]?.url) {
        return {
          success: true,
          message: `模型 ${modelId} 已通过真实图片接口测试`,
        };
      }
    }

    const errorText = await response.text();
    return {
      success: false,
      message: `图片接口测试失败 (${response.status}): ${errorText.slice(0, 300)}`,
      errorType:
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "model"
            : "unknown",
      suggestion: "请确认该 SiliconFlow 模型支持生图，并且账号有调用权限",
    };
  } catch (error) {
    return {
      success: false,
      message: `图片接口网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查 SiliconFlow 地址是否正确",
    };
  }
}

export async function testProxyUnifiedImageModel(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResult> {
  if (isLLMModel(modelId)) {
    return {
      success: false,
      message: `模型 ${modelId} 是文本模型，不支持图片生成`,
      errorType: "model",
      suggestion: "通用中转图片模式需要返回图片 URL 的图像模型",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: IMAGE_TEST_PROMPT }],
        stream: false,
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return {
        success: false,
        message: `通用中转图片测试失败 (${response.status}): ${responseText.slice(0, 300)}`,
        errorType:
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 404
              ? "model"
              : "unknown",
        suggestion: "请确认该模型能通过统一端点返回图片结果，而不是纯文本回复",
      };
    }

    const data = JSON.parse(responseText);
    const content =
      typeof data?.choices?.[0]?.message?.content === "string"
        ? data.choices[0].message.content
        : "";
    const hasImageUrl =
      Boolean(data?.data?.[0]?.url) ||
      /!\[.*?\]\((https?:\/\/[^\s)]+)\)/.test(content) ||
      /(https?:\/\/[^\s]+\.(?:png|jpg|jpeg|webp))/i.test(content);

    if (!hasImageUrl) {
      return {
        success: false,
        message: `模型 ${modelId} 未返回可解析的图片结果`,
        errorType: "config",
        suggestion:
          "该统一端点当前更像文本接口，不能作为项目里的图片供应商使用",
      };
    }

    return {
      success: true,
      message: `模型 ${modelId} 已通过统一端点图片结果测试`,
    };
  } catch (error) {
    return {
      success: false,
      message: `通用中转图片测试失败: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查中转站是否支持通过 /chat/completions 返回图片 URL",
    };
  }
}

export async function testFalModelImage(
  apiKey: string,
  modelId: string
): Promise<TestResult> {
  try {
    const response = await fetch(`https://queue.fal.run/${modelId}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: IMAGE_TEST_PROMPT,
        image_size: "square",
        num_images: 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        message: `Fal 图片测试失败 (${response.status}): ${errorText.slice(0, 300)}`,
        errorType:
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 404
              ? "model"
              : "unknown",
        suggestion: "请确认模型名正确，并且 Fal 账号有权限调用该模型",
      };
    }

    const data = await response.json();
    if (!data?.request_id) {
      return {
        success: false,
        message: "Fal 返回成功，但未拿到 request_id",
        errorType: "config",
        suggestion: "该模型返回格式与项目运行时不匹配",
      };
    }

    return {
      success: true,
      message: `模型 ${modelId} 已通过真实图片任务提交测试`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Fal 图片测试失败: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络和 Fal API Key",
    };
  }
}

export async function testReplicateModelImage(
  apiKey: string,
  modelId: string
): Promise<TestResult> {
  if (!modelId.includes("/")) {
    return {
      success: false,
      message: `Replicate 模型 ${modelId} 格式不正确`,
      errorType: "config",
      suggestion:
        "请使用 owner/model 格式，例如 black-forest-labs/flux-schnell",
    };
  }

  try {
    const response = await fetch(
      `https://api.replicate.com/v1/models/${modelId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (response.ok) {
      return {
        success: true,
        message: `模型 ${modelId} 存在并可访问`,
      };
    }

    const errorText = await response.text();
    return {
      success: false,
      message: `Replicate 模型校验失败 (${response.status}): ${errorText.slice(0, 300)}`,
      errorType:
        response.status === 401 || response.status === 403
          ? "auth"
          : response.status === 404
            ? "model"
            : "unknown",
      suggestion: "请确认模型名正确，并且账号有访问该 Replicate 模型的权限",
    };
  } catch (error) {
    return {
      success: false,
      message: `Replicate 模型校验失败: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络或稍后重试",
    };
  }
}

// ============ 文本/多模态模型可用性探测 ============

// 测试 OpenAI 兼容接口的特定模型
export async function testOpenAIModelChat(
  apiKey: string,
  baseUrl: string,
  modelId: string
): Promise<TestResult> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      }),
    });

    if (response.ok) {
      return {
        success: true,
        message: `模型 ${modelId} 可用`,
      };
    }

    const errorText = await response.text();
    let errorJson: {
      error?: { message?: string; code?: string; type?: string };
    } = {};
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // 非 JSON 响应
    }

    const errorMessage = errorJson.error?.message || errorText.slice(0, 300);
    const errorCode = errorJson.error?.code || `HTTP_${response.status}`;

    // 根据错误类型提供详细信息
    if (response.status === 401) {
      return {
        success: false,
        message: `认证失败: ${errorMessage}`,
        errorCode,
        errorType: "auth",
        suggestion: "请检查 API Key 是否正确，或是否有权限访问该服务",
      };
    }

    if (
      response.status === 404 ||
      errorMessage.toLowerCase().includes("model")
    ) {
      return {
        success: false,
        message: `模型 ${modelId} 不可用: ${errorMessage}`,
        errorCode,
        errorType: "model",
        suggestion: `该中转节点可能不支持模型 ${modelId}，请尝试其他模型或检查模型名称`,
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        message: `请求频率限制: ${errorMessage}`,
        errorCode,
        errorType: "network",
        suggestion: "请稍后重试，或检查账户配额",
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        message: `服务器错误: ${errorMessage}`,
        errorCode,
        errorType: "network",
        suggestion: "服务端暂时不可用，请稍后重试",
      };
    }

    return {
      success: false,
      message: `测试失败 (${response.status}): ${errorMessage}`,
      errorCode,
      errorType: "unknown",
      suggestion: "请检查配置是否正确",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败";
    return {
      success: false,
      message: `网络错误: ${message}`,
      errorType: "network",
      suggestion: "请检查网络连接，或确认中转节点地址是否正确",
    };
  }
}

// 测试 Gemini 特定模型
export async function testGeminiModel(
  apiKey: string,
  baseUrl: string | null,
  modelId: string
): Promise<TestResult> {
  try {
    const url = baseUrl
      ? `${baseUrl}/models/${modelId}:generateContent?key=${apiKey}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      }),
    });

    if (response.ok) {
      return { success: true, message: `模型 ${modelId} 可用` };
    }

    const errorText = await response.text();
    let errorJson: {
      error?: { message?: string; code?: number; status?: string };
    } = {};
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // 非 JSON 响应
    }

    const errorMessage = errorJson.error?.message || errorText.slice(0, 300);

    if (response.status === 400 && errorMessage.includes("not found")) {
      return {
        success: false,
        message: `模型 ${modelId} 不存在: ${errorMessage}`,
        errorType: "model",
        suggestion: "请检查模型名称是否正确",
      };
    }

    if (response.status === 403) {
      return {
        success: false,
        message: `无权访问模型 ${modelId}: ${errorMessage}`,
        errorType: "auth",
        suggestion: "请检查 API Key 权限或账户配额",
      };
    }

    return {
      success: false,
      message: `测试失败 (${response.status}): ${errorMessage}`,
      errorType: "unknown",
    };
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络连接",
    };
  }
}

// 测试 Claude 特定模型
export async function testClaudeModel(
  apiKey: string,
  baseUrl: string | null,
  modelId: string
): Promise<TestResult> {
  try {
    const url = baseUrl
      ? `${baseUrl}/messages`
      : "https://api.anthropic.com/v1/messages";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    if (response.ok) {
      return { success: true, message: `模型 ${modelId} 可用` };
    }

    const errorText = await response.text();
    let errorJson: { error?: { message?: string; type?: string } } = {};
    try {
      errorJson = JSON.parse(errorText);
    } catch {
      // 非 JSON 响应
    }

    const errorMessage = errorJson.error?.message || errorText.slice(0, 300);

    if (
      response.status === 400 &&
      errorMessage.toLowerCase().includes("model")
    ) {
      return {
        success: false,
        message: `模型 ${modelId} 不可用: ${errorMessage}`,
        errorType: "model",
        suggestion: "请检查模型名称是否正确",
      };
    }

    if (response.status === 401) {
      return {
        success: false,
        message: `认证失败: ${errorMessage}`,
        errorType: "auth",
        suggestion: "请检查 API Key 是否正确",
      };
    }

    return {
      success: false,
      message: `测试失败 (${response.status}): ${errorMessage}`,
      errorType: "unknown",
    };
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error instanceof Error ? error.message : "请求失败"}`,
      errorType: "network",
      suggestion: "请检查网络连接",
    };
  }
}

/**
 * 为 flow2api 专属做最小 SSE 探测（图片/视频模型通用）：
 * 真发一次 stream:true 请求，只读到第一帧 data: 就 abort 关连接。
 * 验证 ① HTTP 200 ② SSE 格式正确 ③ 模型 ID 被上游识别 ④ Bearer Key 有效。
 * 不会真的把媒体生成完，也不会消耗用户配额（任务在 Cloudflare 端会立即取消）。
 */
export async function testFlow2apiModel(
  apiKey: string,
  baseUrl: string | null,
  modelId: string
): Promise<TestResult> {
  if (!baseUrl) {
    return {
      success: false,
      message: "缺少 Base URL",
      errorType: "config",
      suggestion: "请填写 https://flow2api.cloudsentryai.com",
    };
  }
  // flow2apiChatUrl 会对尾部 /v1 去重：用户把 Base URL 填成
  // https://host 或 https://host/v1 都能正确探测
  const url = flow2apiChatUrl(baseUrl);
  const controller = new AbortController();
  const probeTimeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "ping" }],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
      if (response.status === 401) {
        return {
          success: false,
          message: `flow2api 认证失败 (HTTP 401): API Key 无效`,
          errorType: "auth",
          suggestion: "检查 Bearer Token 是否正确",
        };
      }
      if (response.status === 403) {
        return {
          success: false,
          message: `flow2api 拒绝模型「${modelId}」(HTTP 403): 当前账户 Tier 不支持`,
          errorType: "model",
          suggestion:
            "改用非 Ultra / 非 4K 的模型，例如 veo_3_1_t2v_fast_landscape 或 gemini-3.0-pro-image-landscape",
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          message: `flow2api 路径未找到 (HTTP 404)：${snippet}`,
          errorType: "config",
          suggestion:
            "检查 Base URL 是否为 https://flow2api.cloudsentryai.com（不要带 /v1 后缀）",
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          message: `flow2api 限流 (HTTP 429)`,
          errorType: "network",
          suggestion: "等待 30-60 秒后重试",
        };
      }
      return {
        success: false,
        message: `flow2api 测试失败 (HTTP ${response.status}): ${snippet}`,
        errorType: "unknown",
      };
    }

    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream")) {
      return {
        success: false,
        message: `flow2api 返回了非 SSE 响应 (Content-Type: ${ct})`,
        errorType: "config",
        suggestion: "确认 Base URL 与协议正确",
      };
    }

    if (!response.body) {
      return {
        success: false,
        message: "flow2api 响应体为空",
        errorType: "unknown",
      };
    }

    // 读 SSE 前两帧再判定：首帧只代表任务已受理（"✨ 已启动"），
    // 账号档位/模型类错误在第二帧才出现（"错误: 当前模型需要 Ult 账号"）。
    // 只看首帧会出现"测试绿但生成必失败"的假阳性。
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let healthyFrames = 0;
    let errorPreview: string | null = null;

    try {
      let stop = false;
      while (!stop) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while (!stop && (idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!frame.includes("data:") || frame.includes("[DONE]")) continue;
          // 上游错误标记：reasoning 带 ❌/"错误:"，或顶层 {"error":...} 帧
          if (
            frame.includes("❌") ||
            frame.includes("错误:") ||
            frame.includes('"error"')
          ) {
            errorPreview = frame.replace(/\s+/g, " ").trim().slice(0, 200);
            stop = true;
          } else {
            healthyFrames++;
            if (healthyFrames >= 2) stop = true;
          }
        }
        if (buffer.length > 16384) break; // 防御：单帧不应该这么大
      }
    } finally {
      try {
        await reader.cancel();
      } catch {}
    }

    if (errorPreview) {
      return {
        success: false,
        message: `flow2api 模型「${modelId}」上游报错: ${errorPreview}`,
        errorType: "model",
        suggestion:
          "确认模型 ID 在 flow2api 清单内，且账号档位支持该模型（-4k / _ultra 模型需要 Ult 账号）",
      };
    }

    if (healthyFrames === 0) {
      return {
        success: false,
        message: "flow2api 未在 15 秒内返回首帧",
        errorType: "network",
        suggestion: "可能上游 Google token 不可用；让操作员检查 backend",
      };
    }

    return {
      success: true,
      message: `flow2api 模型「${modelId}」可用（SSE 前两帧正常）`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        message: "flow2api 测试超时（15 秒未返回首帧）",
        errorType: "network",
        suggestion: "网络问题或上游 Google 后端无 token；联系运维",
      };
    }
    return {
      success: false,
      message: `flow2api 测试异常: ${err instanceof Error ? err.message : String(err)}`,
      errorType: "unknown",
    };
  } finally {
    clearTimeout(probeTimeout);
  }
}
