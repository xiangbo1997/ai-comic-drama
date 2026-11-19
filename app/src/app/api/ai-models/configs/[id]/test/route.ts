import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decrypt, decryptExtraConfig } from "@/lib/encryption";
import { AI_PROVIDER_PROTOCOLS } from "@/types/ai";
import { preserveMaskedExtraConfig } from "../../extra-config-mask";
import { assertSafeUrl } from "@/lib/url-guard";
import { webSearchTransport } from "@/lib/ai-web-search";
import {
  testProviderConnectivity,
  type ProviderCategory,
} from "@/services/ai/connectivity-test";

import { createLogger } from "@/lib/logger";
const log = createLogger("api:ai-models:configs:[id]:test");

// 测试请求体校验：modelId/customBaseUrl 均可选；约束长度与格式，防注入/超长输入
const TestConfigSchema = z.object({
  apiKey: z.string().trim().min(1).max(8192).optional(),
  extraConfig: z.record(z.string().max(100), z.string().max(16384)).optional(),
  modelId: z.string().trim().max(255).optional(),
  apiProtocol: z.enum(AI_PROVIDER_PROTOCOLS).optional(),
  // customBaseUrl 允许空字符串（用户清空时回退默认配置），非空时必须是合法
  // http(s) URL（拒绝 file:// / gopher:// 等非 HTTP 协议，运行时再做 SSRF 校验）
  customBaseUrl: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .url()
        .max(500)
        .refine((u) => /^https?:\/\//i.test(u), {
          message: "Base URL 必须以 http:// 或 https:// 开头",
        }),
    ])
    .optional(),
});

// POST /api/ai-models/configs/[id]/test - 测试已保存配置的 API Key 连接
// 支持传入 modelId 和 customBaseUrl 来测试当前 UI 选择的配置
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // 校验路由参数 id 格式（cuid/字母数字下划线连字符），防止异常值
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "无效的配置 ID" }, { status: 400 });
    }

    // 解析并校验请求体，获取可选的 modelId 和 customBaseUrl
    let bodyModelId: string | undefined;
    let bodyCustomBaseUrl: string | undefined;
    let bodyApiProtocol: string | undefined;
    let bodyApiKey: string | undefined;
    let bodyExtraConfig: Record<string, string> | undefined;
    try {
      const raw = await request.json();
      const parsed = TestConfigSchema.safeParse(raw);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "请求参数无效", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      bodyModelId = parsed.data.modelId;
      bodyCustomBaseUrl = parsed.data.customBaseUrl;
      bodyApiProtocol = parsed.data.apiProtocol;
      bodyApiKey = parsed.data.apiKey;
      bodyExtraConfig = parsed.data.extraConfig;
    } catch {
      // 请求体为空或非 JSON，使用保存的配置（合法场景，不报错）
    }

    // 获取配置
    const config = await prisma.userAIConfig.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
      include: {
        provider: true,
      },
    });

    if (!config) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    // 解密 API Key
    const savedApiKey = decrypt(config.apiKey, config.apiKeyIv);
    const apiKey = bodyApiKey || savedApiKey;
    // extraConfig 里的 accessToken / secretKey 等在库中是 enc:v1: 密文，
    // 必须解密后再交给连通性测试，否则火山 / 百度 / Kling 一律测出鉴权失败。
    const savedExtraConfig = decryptExtraConfig(config.extraConfig) as Record<
      string,
      string
    > | null;
    const extraConfig = bodyExtraConfig
      ? {
          ...savedExtraConfig,
          ...(preserveMaskedExtraConfig(
            bodyExtraConfig,
            savedExtraConfig
          ) as Record<string, string>),
        }
      : savedExtraConfig;

    // 优先使用请求体中的参数，否则使用保存的配置
    const effectiveModelId = bodyModelId || config.selectedModel;
    const effectiveBaseUrl =
      bodyCustomBaseUrl !== undefined
        ? bodyCustomBaseUrl || config.provider.baseUrl
        : config.customBaseUrl || config.provider.baseUrl;

    // SSRF 防护：customBaseUrl 由用户控制，直接 fetch 会被诱导访问
    // 云元数据/内网。校验协议白名单 + DNS 解析后内网拦截。
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

    // 获取 API 协议（优先使用配置级别的，否则使用提供商默认的）
    const apiProtocol =
      bodyApiProtocol || config.apiProtocol || config.provider.apiProtocol;

    const startTime = Date.now();
    const testResult = await testProviderConnectivity({
      category: config.provider.category as ProviderCategory,
      slug: config.provider.slug,
      apiKey,
      baseUrl: effectiveBaseUrl,
      modelId: effectiveModelId,
      extraConfig,
      apiProtocol,
      // 已保存配置路由保留额外能力：自定义提供商按协议分发 + flow2api 视频探测
      enableCustomProviderFallback: true,
      enableFlow2apiVideoProbe: true,
    });
    const latency = Date.now() - startTime;

    // 未保存的表单可以测试，但不能把旧协议/旧模型配置标记为测试通过。
    const testsSavedConfig =
      apiKey === savedApiKey &&
      JSON.stringify(Object.entries(extraConfig || {}).sort()) ===
        JSON.stringify(Object.entries(savedExtraConfig || {}).sort()) &&
      apiProtocol === (config.apiProtocol || config.provider.apiProtocol) &&
      effectiveModelId === config.selectedModel &&
      effectiveBaseUrl === (config.customBaseUrl || config.provider.baseUrl);
    let verificationStored = false;
    if (testsSavedConfig && webSearchTransport(extraConfig) === "responses") {
      // 联网请求可能耗时数分钟；只认证发起时那份配置，不能覆盖期间的新设置。
      const saved = await prisma.userAIConfig.updateMany({
        where: {
          id,
          userId: session.user.id,
          updatedAt: config.updatedAt,
          provider: { updatedAt: config.provider.updatedAt },
        },
        data: {
          testStatus: testResult.success ? "SUCCESS" : "FAILED",
          lastTestedAt: new Date(),
        },
      });
      verificationStored = saved.count === 1;
    } else if (testsSavedConfig) {
      await prisma.userAIConfig.update({
        where: { id },
        data: {
          testStatus: testResult.success ? "SUCCESS" : "FAILED",
          lastTestedAt: new Date(),
        },
      });
      verificationStored = true;
    }

    return NextResponse.json({
      success: testResult.success && (!testsSavedConfig || verificationStored),
      message:
        testResult.message +
        (testsSavedConfig && !verificationStored
          ? " 配置已变化，此次结果未标记为当前配置通过，请重新测试。"
          : ""),
      verificationStored,
      errorCode: testResult.errorCode,
      errorType: testResult.errorType,
      suggestion: testResult.suggestion,
      latency,
      testedModel: effectiveModelId,
      testedUrl: effectiveBaseUrl,
    });
  } catch (error) {
    log.error("Test config error:", error);
    return NextResponse.json({ error: "测试连接失败" }, { status: 500 });
  }
}
