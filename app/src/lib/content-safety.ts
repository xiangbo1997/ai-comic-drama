/**
 * 内容安全检查模块
 * 支持本地关键词检测 + 阿里云/腾讯云专业内容审核API
 */

import crypto from "crypto";

import { createLogger } from "@/lib/logger";
const log = createLogger("lib:content-safety");

// 违规关键词列表（基础版本，作为兜底检测）
const BLOCKED_KEYWORDS = [
  // 暴力相关
  "杀人",
  "自杀",
  "谋杀",
  "血腥",
  "残忍",
  "虐待",
  // 色情相关
  "色情",
  "裸体",
  "性行为",
  "淫秽",
  // 政治敏感
  "颠覆",
  "分裂国家",
  // 其他违规
  "毒品",
  "赌博",
  "诈骗",
];

// 敏感词替换映射（用于轻度违规内容的净化）
const SENSITIVE_REPLACEMENTS: Record<string, string> = {
  死亡: "离开",
  死了: "走了",
  杀死: "击败",
  血: "红色液体",
};

export interface ContentCheckResult {
  safe: boolean;
  reason?: string;
  blockedKeywords?: string[];
  sanitizedText?: string;
  // 专业API返回的详细信息
  riskLevel?: "pass" | "review" | "block";
  labels?: string[];
  suggestion?: string;
}

export interface ImageCheckResult extends ContentCheckResult {
  // 图片审核特有字段
  scenes?: Array<{
    scene: string;
    suggestion: "pass" | "review" | "block";
    rate: number;
  }>;
}

/**
 * 阿里云内容安全服务
 */
class AliyunContentSafetyService {
  private accessKeyId: string;
  private accessKeySecret: string;
  private endpoint: string;

  constructor() {
    this.accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID || "";
    this.accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET || "";
    this.endpoint =
      process.env.ALIYUN_CONTENT_SAFETY_ENDPOINT ||
      "green.cn-shanghai.aliyuncs.com";
  }

  isConfigured(): boolean {
    return !!(this.accessKeyId && this.accessKeySecret);
  }

  /**
   * 文本内容审核
   */
  async checkText(text: string): Promise<ContentCheckResult> {
    if (!this.isConfigured()) {
      return { safe: true, riskLevel: "pass" };
    }

    try {
      const params = {
        scenes: ["antispam"],
        tasks: [{ content: text }],
      };

      const result = await this.request("/green/text/scan", params);

      if (result.data && result.data[0]) {
        const taskResult = result.data[0];
        const sceneResult = taskResult.results?.[0];

        if (sceneResult) {
          const suggestion = sceneResult.suggestion as
            | "pass"
            | "review"
            | "block";
          return {
            safe: suggestion === "pass",
            riskLevel: suggestion,
            labels: sceneResult.label ? [sceneResult.label] : [],
            reason:
              suggestion !== "pass"
                ? `内容审核: ${sceneResult.label}`
                : undefined,
            suggestion: this.getSuggestionText(suggestion),
          };
        }
      }

      return { safe: true, riskLevel: "pass" };
    } catch (error) {
      log.error("阿里云文本审核失败:", error);
      // API 调用失败时，降级到本地检测
      return { safe: true, riskLevel: "pass" };
    }
  }

  /**
   * 图片内容审核
   */
  async checkImage(imageUrl: string): Promise<ImageCheckResult> {
    if (!this.isConfigured()) {
      return { safe: true, riskLevel: "pass" };
    }

    try {
      const params = {
        scenes: ["porn", "terrorism", "ad"],
        tasks: [{ url: imageUrl }],
      };

      const result = await this.request("/green/image/scan", params);

      if (result.data && result.data[0]) {
        const taskResult = result.data[0];
        const scenes: ImageCheckResult["scenes"] = [];
        let overallSafe = true;
        let overallSuggestion: "pass" | "review" | "block" = "pass";
        const labels: string[] = [];

        for (const sceneResult of taskResult.results || []) {
          const suggestion = sceneResult.suggestion as
            | "pass"
            | "review"
            | "block";
          scenes.push({
            scene: sceneResult.scene,
            suggestion,
            rate: sceneResult.rate || 0,
          });

          if (suggestion === "block") {
            overallSafe = false;
            overallSuggestion = "block";
            if (sceneResult.label) labels.push(sceneResult.label);
          } else if (suggestion === "review" && overallSuggestion !== "block") {
            overallSuggestion = "review";
            if (sceneResult.label) labels.push(sceneResult.label);
          }
        }

        return {
          safe: overallSafe,
          riskLevel: overallSuggestion,
          scenes,
          labels,
          reason: !overallSafe ? `图片审核: ${labels.join(", ")}` : undefined,
          suggestion: this.getSuggestionText(overallSuggestion),
        };
      }

      return { safe: true, riskLevel: "pass" };
    } catch (error) {
      log.error("阿里云图片审核失败:", error);
      return { safe: true, riskLevel: "pass" };
    }
  }

  /**
   * 发送请求到阿里云API
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async request(path: string, body: object): Promise<any> {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-acs-version": "2022-03-02",
      "x-acs-action": path.includes("text")
        ? "TextModeration"
        : "ImageModeration",
      "x-acs-date": timestamp,
      "x-acs-signature-nonce": nonce,
    };

    // 生成签名
    const signature = this.generateSignature(
      "POST",
      path,
      headers,
      JSON.stringify(body)
    );
    headers["Authorization"] = `acs ${this.accessKeyId}:${signature}`;

    const response = await fetch(`https://${this.endpoint}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`阿里云API调用失败: ${response.status}`);
    }

    return response.json();
  }

  /**
   * 生成签名
   */
  private generateSignature(
    method: string,
    path: string,
    headers: Record<string, string>,
    _body: string
  ): string {
    const canonicalHeaders = Object.keys(headers)
      .filter((k) => k.startsWith("x-acs-"))
      .sort()
      .map((k) => `${k.toLowerCase()}:${headers[k]}`)
      .join("\n");

    const stringToSign = [
      method,
      headers["Content-Type"],
      "",
      canonicalHeaders,
      path,
    ].join("\n");

    return crypto
      .createHmac("sha1", this.accessKeySecret)
      .update(stringToSign)
      .digest("base64");
  }

  private getSuggestionText(suggestion: "pass" | "review" | "block"): string {
    switch (suggestion) {
      case "pass":
        return "内容正常";
      case "review":
        return "内容疑似违规，建议人工审核";
      case "block":
        return "内容违规，已被拦截";
    }
  }
}

/**
 * 腾讯云内容安全服务（备选）
 */
class TencentContentSafetyService {
  private secretId: string;
  private secretKey: string;

  constructor() {
    this.secretId = process.env.TENCENT_SECRET_ID || "";
    this.secretKey = process.env.TENCENT_SECRET_KEY || "";
  }

  isConfigured(): boolean {
    return !!(this.secretId && this.secretKey);
  }

  /**
   * 文本内容审核
   */
  async checkText(text: string): Promise<ContentCheckResult> {
    if (!this.isConfigured()) {
      return { safe: true, riskLevel: "pass" };
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const date = new Date().toISOString().split("T")[0];

      const params = {
        Content: Buffer.from(text).toString("base64"),
      };

      const headers = this.generateHeaders(
        "TextModeration",
        params,
        timestamp,
        date
      );

      const response = await fetch("https://tms.tencentcloudapi.com", {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });

      const result = await response.json();

      if (result.Response) {
        const suggestion = result.Response.Suggestion;
        return {
          safe: suggestion === "Pass",
          riskLevel:
            suggestion === "Pass"
              ? "pass"
              : suggestion === "Review"
                ? "review"
                : "block",
          labels: result.Response.Label ? [result.Response.Label] : [],
          reason:
            suggestion !== "Pass"
              ? `内容审核: ${result.Response.Label}`
              : undefined,
        };
      }

      return { safe: true, riskLevel: "pass" };
    } catch (error) {
      log.error("腾讯云文本审核失败:", error);
      return { safe: true, riskLevel: "pass" };
    }
  }

  private generateHeaders(
    action: string,
    params: object,
    timestamp: number,
    date: string
  ): Record<string, string> {
    const service = "tms";
    const host = "tms.tencentcloudapi.com";

    // 简化的签名计算（生产环境需要完整实现 TC3-HMAC-SHA256）
    const payload = JSON.stringify(params);
    const hashedPayload = crypto
      .createHash("sha256")
      .update(payload)
      .digest("hex");

    const canonicalRequest = [
      "POST",
      "/",
      "",
      `content-type:application/json\nhost:${host}\n`,
      "content-type;host",
      hashedPayload,
    ].join("\n");

    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = crypto
      .createHash("sha256")
      .update(canonicalRequest)
      .digest("hex");
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

    // 派生签名密钥
    const kDate = crypto
      .createHmac("sha256", `TC3${this.secretKey}`)
      .update(date)
      .digest();
    const kService = crypto
      .createHmac("sha256", kDate)
      .update(service)
      .digest();
    const kSigning = crypto
      .createHmac("sha256", kService)
      .update("tc3_request")
      .digest();
    const signature = crypto
      .createHmac("sha256", kSigning)
      .update(stringToSign)
      .digest("hex");

    return {
      "Content-Type": "application/json",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Version": "2020-12-29",
      "X-TC-Timestamp": timestamp.toString(),
      Authorization: `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
    };
  }
}

// 创建服务实例
const aliyunService = new AliyunContentSafetyService();
const tencentService = new TencentContentSafetyService();

/**
 * 检查文本内容是否安全（本地检测）
 */
export function checkTextSafety(text: string): ContentCheckResult {
  if (!text || text.trim().length === 0) {
    return { safe: true };
  }

  const lowerText = text.toLowerCase();
  const foundBlocked: string[] = [];

  for (const keyword of BLOCKED_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      foundBlocked.push(keyword);
    }
  }

  if (foundBlocked.length > 0) {
    return {
      safe: false,
      reason: "内容包含违规关键词",
      blockedKeywords: foundBlocked,
    };
  }

  return { safe: true };
}

/**
 * 净化文本内容（替换敏感词）
 */
export function sanitizeText(text: string): string {
  let result = text;

  for (const [sensitive, replacement] of Object.entries(
    SENSITIVE_REPLACEMENTS
  )) {
    result = result.replace(new RegExp(sensitive, "gi"), replacement);
  }

  return result;
}

/**
 * 检查并净化文本
 */
export function checkAndSanitize(text: string): ContentCheckResult {
  const safetyCheck = checkTextSafety(text);

  if (!safetyCheck.safe) {
    return safetyCheck;
  }

  const sanitized = sanitizeText(text);

  return {
    safe: true,
    sanitizedText: sanitized,
  };
}

/**
 * 检查图片生成提示词是否安全（本地检测）
 */
export function checkImagePromptSafety(prompt: string): ContentCheckResult {
  const imageBlockedKeywords = [
    ...BLOCKED_KEYWORDS,
    "真人",
    "明星",
    "名人",
    "政治人物",
    "儿童",
    "未成年",
    "武器",
    "枪",
    "刀",
  ];

  const lowerPrompt = prompt.toLowerCase();
  const foundBlocked: string[] = [];

  for (const keyword of imageBlockedKeywords) {
    if (lowerPrompt.includes(keyword.toLowerCase())) {
      foundBlocked.push(keyword);
    }
  }

  if (foundBlocked.length > 0) {
    return {
      safe: false,
      reason: "图片生成提示词包含不允许的内容",
      blockedKeywords: foundBlocked,
    };
  }

  return { safe: true };
}

/**
 * 内容安全检查中间件（用于API路由）
 * 优先使用专业API，失败时降级到本地检测
 */
export async function contentSafetyMiddleware(
  text: string,
  type: "text" | "image" | "video" = "text"
): Promise<ContentCheckResult> {
  // 1. 先进行本地基础检查
  const localCheck = checkTextSafety(text);
  if (!localCheck.safe) {
    return localCheck;
  }

  // 2. 图片/视频生成有额外的本地检查
  if (type === "image" || type === "video") {
    const imageCheck = checkImagePromptSafety(text);
    if (!imageCheck.safe) {
      return imageCheck;
    }
  }

  // 3. 调用专业内容审核API
  let professionalCheck: ContentCheckResult = { safe: true, riskLevel: "pass" };

  if (aliyunService.isConfigured()) {
    professionalCheck = await aliyunService.checkText(text);
  } else if (tencentService.isConfigured()) {
    professionalCheck = await tencentService.checkText(text);
  }

  // 如果专业API判定不安全，返回专业API结果
  if (!professionalCheck.safe) {
    return professionalCheck;
  }

  // 如果是 review 状态，可以选择放行但标记
  if (professionalCheck.riskLevel === "review") {
    return {
      safe: true,
      riskLevel: "review",
      sanitizedText: sanitizeText(text),
      suggestion: professionalCheck.suggestion,
      labels: professionalCheck.labels,
    };
  }

  return { safe: true, sanitizedText: sanitizeText(text), riskLevel: "pass" };
}

/**
 * 图片内容审核（用于生成后的图片检查）
 */
export async function checkImageContent(
  imageUrl: string
): Promise<ImageCheckResult> {
  if (aliyunService.isConfigured()) {
    return aliyunService.checkImage(imageUrl);
  }

  // 如果没有配置专业API，返回通过
  return { safe: true, riskLevel: "pass" };
}

/**
 * 获取内容安全服务状态
 */
export function getContentSafetyStatus(): {
  aliyun: boolean;
  tencent: boolean;
  localOnly: boolean;
} {
  return {
    aliyun: aliyunService.isConfigured(),
    tencent: tencentService.isConfigured(),
    localOnly: !aliyunService.isConfigured() && !tencentService.isConfigured(),
  };
}
