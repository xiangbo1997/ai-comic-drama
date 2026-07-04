import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertSafeUrl } from "@/lib/url-guard";
import {
  testProviderConnectivity,
  type ProviderCategory,
} from "@/services/ai/connectivity-test";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:test");

// POST /api/ai-models/test - 测试 API 连接（无需先保存配置）
// 测试请求体里携带的、尚未保存的配置：providerId + apiKey +（可选）
// customBaseUrl / extraConfig / modelId / apiProtocol。
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      providerId,
      apiKey,
      customBaseUrl,
      extraConfig,
      modelId,
      apiProtocol,
    } = body;

    if (!providerId || !apiKey) {
      return NextResponse.json(
        { error: "providerId 和 apiKey 是必填项" },
        { status: 400 }
      );
    }

    // 获取提供商信息
    const provider = await prisma.aIProvider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      return NextResponse.json({ error: "提供商不存在" }, { status: 404 });
    }

    const effectiveBaseUrl = customBaseUrl || provider.baseUrl;

    // SSRF 防护：customBaseUrl 由用户完全控制，直接 fetch 会被诱导访问
    // 云元数据(169.254.169.254)/内网。校验协议白名单 + DNS 解析后内网拦截。
    if (effectiveBaseUrl) {
      try {
        await assertSafeUrl(effectiveBaseUrl);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "非法的 Base URL" },
          { status: 400 }
        );
      }
    }

    const effectiveProtocol = apiProtocol || provider.apiProtocol;

    const startTime = Date.now();
    const testResult = await testProviderConnectivity({
      category: provider.category as ProviderCategory,
      slug: provider.slug,
      apiKey,
      baseUrl: effectiveBaseUrl,
      modelId,
      extraConfig,
      apiProtocol: effectiveProtocol,
    });
    const latency = Date.now() - startTime;

    return NextResponse.json({
      success: testResult.success,
      message: testResult.message,
      errorCode: testResult.errorCode,
      errorType: testResult.errorType,
      suggestion: testResult.suggestion,
      latency,
      testedModel: modelId,
      testedUrl: effectiveBaseUrl,
    });
  } catch (error) {
    log.error("Test connection error:", error);
    return NextResponse.json({ error: "测试连接失败" }, { status: 500 });
  }
}
