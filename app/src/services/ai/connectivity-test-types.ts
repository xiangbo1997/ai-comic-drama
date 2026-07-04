/**
 * AI Provider 连通性测试 —— 共享类型
 *
 * 单独成文件以避免 connectivity-test.ts（分发门面）与
 * connectivity-test-probes.ts（叶子探测）之间的循环依赖。
 */

/** 提供商分类（与 Prisma AIProvider.category 对齐） */
export type ProviderCategory = "LLM" | "IMAGE" | "VIDEO" | "TTS";

/** 单次连通性测试的归一化结果 */
export interface TestResult {
  success: boolean;
  message: string;
  errorCode?: string;
  errorType?: "auth" | "network" | "model" | "config" | "unknown";
  suggestion?: string;
}

/**
 * 门面入参：由两条路由各自的配置来源（请求体 / DB 解密）装配后传入。
 *
 * - 已保存配置路由会置 enableCustomProviderFallback / enableFlow2apiVideoProbe，
 *   以保留其对「自定义提供商 + flow2api 视频」的额外分支能力；
 * - 未保存配置路由不置这两个开关，行为与历史保持一致。
 */
export interface ResolvedTestConfig {
  category: ProviderCategory;
  /** Prisma AIProvider.slug */
  slug: string;
  apiKey: string;
  baseUrl: string | null;
  /** 有值则测模型可用性，否则只测提供商连通性 */
  modelId?: string | null;
  extraConfig: Record<string, string> | null;
  /** 生效协议（配置级优先，否则提供商默认） */
  apiProtocol?: string | null;
  /**
   * 是否启用「自定义提供商按协议分发」分支（configs/[id]/test 历史行为）。
   * 关闭时 slug 走固定 switch（test 路由历史行为）。
   */
  enableCustomProviderFallback?: boolean;
  /**
   * 是否启用 flow2api 视频 SSE 探测（configs/[id]/test 历史行为）。
   */
  enableFlow2apiVideoProbe?: boolean;
}
