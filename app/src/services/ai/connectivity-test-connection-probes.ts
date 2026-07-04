/**
 * AI Provider 连通性测试 —— 提供商连通性探测（无模型 ID）
 *
 * 承载「只验证 API Key/连通性、不指定具体模型」的叶子探测：OpenAI 兼容、
 * Gemini、Claude、Replicate、Fal、Runway、Luma、Kling、MiniMax、火山引擎、
 * Fish Audio、ElevenLabs。从 connectivity-test-probes.ts 拆出以满足 800 行
 * 上限。所有函数返回归一化 TestResult；错误文案为用户可见。
 */

import type { TestResult } from "./connectivity-test-types";

// OpenAI 兼容接口测试（DeepSeek、OpenAI、硅基流动等）
export async function testOpenAICompatible(
  apiKey: string,
  baseUrl: string
): Promise<TestResult> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Gemini 连通性测试（honors baseUrl）
export async function testGemini(
  apiKey: string,
  baseUrl: string | null
): Promise<TestResult> {
  const url = baseUrl
    ? `${baseUrl}/models?key=${apiKey}`
    : `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url);
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Claude 连通性测试（honors baseUrl）
export async function testClaude(
  apiKey: string,
  baseUrl: string | null
): Promise<TestResult> {
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
      model: "claude-3-5-haiku-20241022",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
    }),
  });
  if (response.ok || response.status === 400) {
    // 400 可能是参数问题，但说明 API Key 有效
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Replicate 测试
export async function testReplicate(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.replicate.com/v1/account", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Fal.ai 测试（没有专门验证端点，尝试获取队列状态）
export async function testFal(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://queue.fal.run/fal-ai/flux/requests", {
    headers: { Authorization: `Key ${apiKey}` },
  });
  if (response.ok || response.status === 404) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Runway 测试
export async function testRunway(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.dev.runwayml.com/v1/tasks", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Runway-Version": "2024-11-06",
    },
  });
  if (response.ok || response.status === 404) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// Luma 测试
export async function testLuma(apiKey: string): Promise<TestResult> {
  const response = await fetch(
    "https://api.lumalabs.ai/dream-machine/v1/generations",
    {
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );
  if (response.ok || response.status === 404) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// 可灵测试（需要签名，这里简单验证格式）
export async function testKling(
  accessKey: string,
  secretKey: string
): Promise<TestResult> {
  if (!accessKey || !secretKey) {
    return { success: false, message: "需要 Access Key 和 Secret Key" };
  }
  return { success: true, message: "配置格式正确（需实际调用验证）" };
}

// MiniMax 测试
export async function testMinimax(
  apiKey: string,
  groupId: string
): Promise<TestResult> {
  if (!groupId) {
    return { success: false, message: "需要 Group ID" };
  }
  const response = await fetch(
    `https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "abab6.5s-chat",
        messages: [{ role: "user", content: "Hi" }],
      }),
    }
  );
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// 火山引擎测试（TTS 需要复杂签名，这里简单验证格式）
export async function testVolcengine(
  appId: string,
  accessToken: string
): Promise<TestResult> {
  if (!appId || !accessToken) {
    return { success: false, message: "需要 App ID 和 Access Token" };
  }
  return { success: true, message: "配置格式正确（需实际调用验证）" };
}

// Fish Audio 测试
export async function testFishAudio(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.fish.audio/model", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}

// ElevenLabs 测试
export async function testElevenLabs(apiKey: string): Promise<TestResult> {
  const response = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": apiKey },
  });
  if (response.ok) {
    return { success: true, message: "连接成功" };
  }
  const error = await response.text();
  return {
    success: false,
    message: `连接失败: ${response.status} ${error.slice(0, 200)}`,
  };
}
