/**
 * Grok (xAI) 图像生成 Provider
 *
 * 支持两条路径：
 * - 无参考图 → `POST /images/generations`（OpenAI 标准文生图，历史行为不变）
 * - 有参考图 → `POST /images/edits`（grok2api 网关的**非标准** JSON 图片编辑协议）
 *
 * 图片编辑协议来自对 grok2api 网关的实测探测（2026-09-10），逐条证据见
 * GROK_EDIT_CONTRACT 的注释。之所以必须单独实现而不能复用 openai-compatible
 * 的 edits 分支：后者按 OpenAI 标准发 multipart，grok2api 直接以 HTTP 415
 * 「图片编辑仅支持 application/json」拒收。
 */

import type { ImageProvider } from "../types";
import { trimUrl, fetchWithError, pluckPath } from "./base";
import { isLikelyWrongCategoryModel } from "./openai-compatible";
import { createLogger } from "@/lib/logger";

const log = createLogger("ai:provider:grok");

/**
 * grok2api 图片编辑协议契约（2026-09-10 实测，用真实 key 对
 * `https://grok2api.cloudsentryai.com/v1` 逐步探测得出）。
 *
 * 每条都由网关的拒绝报错反证，不是从文档推断的：
 *
 * | 项           | 值                              | 实测证据（网关报错原文）                              |
 * | ------------ | ------------------------------- | ----------------------------------------------------- |
 * | 传输格式     | `application/json`（非 multipart）| multipart → HTTP 415「图片编辑仅支持 application/json」|
 * | 字段名       | `images`（复数）                 | 用 `image`/`image_url`/`init_image` → 「image 或 images 数量必须在 1 到 8 之间」 |
 * | 元素结构     | `[{ url: "https://..." }]`       | `images:[{b64_json}]` → 「每个 image 都必须提供有效 url」|
 * | 单数形式     | 不接受                           | `image:[{url}]` → 「图片编辑 JSON 请求无效」           |
 * | 参考图数量   | 1–8 张                          | 「image 或 images 数量必须在 1 到 8 之间」             |
 * | 图片来源     | 必须是网关可公网访问的 URL        | 传 data URL/base64 被拒；传 wikipedia URL → 「对话图片无效: 下载地址返回 400」——说明网关会**回源下载**该 URL |
 */
const GROK_EDIT_CONTRACT = {
  /** 参考图数量上限（网关硬校验 1–8） */
  maxImages: 8,
} as const;

/**
 * 编辑模型映射表：`生成模型名 → 编辑模型名`。
 *
 * 依据：grok2api README 说明，Grok Web 模式下 `grok-imagine-image` 只提供
 * Images Generations 能力，**图片编辑被拆成独立的 `-edit` 模型**。因此带参考图
 * 却仍用生成模型名去打 `/images/edits`，编辑语义不保证生效（实测该组合返回的是
 * 429 额度耗尽，能走到生成阶段，但无法确证编辑是否真的被应用）。
 *
 * 该账号 `/models` 实际返回的图像模型全集（2026-09-10）：
 *   grok-imagine-image, grok-imagine-image-2.0, grok-imagine-image-quality,
 *   grok-imagine-image-lite, grok-imagine-image-edit,
 *   grok-imagine-video, grok-imagine-video-1.5
 *
 * 网关目前只提供**一个**编辑模型（`grok-imagine-image-edit`），所以各生成档位
 * （基础/2.0/quality/lite）统一收敛到它——这不是偷懒，而是上游只有这一个可用目标。
 * 将来网关按档位拆分编辑模型时，在此表补条目即可，调用处无需改动。
 */
const EDIT_MODEL_MAP: ReadonlyMap<string, string> = new Map([
  ["grok-imagine-image", "grok-imagine-image-edit"],
  ["grok-imagine-image-2.0", "grok-imagine-image-edit"],
  ["grok-imagine-image-quality", "grok-imagine-image-edit"],
  ["grok-imagine-image-lite", "grok-imagine-image-edit"],
]);

/** 网关唯一的编辑模型；精确匹配失败时的兜底目标 */
const FALLBACK_EDIT_MODEL = "grok-imagine-image-edit";

/**
 * 把模型名解析成「带参考图时应该用的编辑模型」。
 *
 * 规则（按优先级）：
 * 1. 名字里已含 `-edit` → 原样返回（用户显式配了编辑模型，不二次改写）
 * 2. 命中 EDIT_MODEL_MAP 的精确映射 → 用映射值
 * 3. 看起来是 grok imagine 图像模型但不在表里（新版本号）→ 兜底到唯一编辑模型，
 *    因为「漏一个新版本号导致参考图静默失效」比「兜底到已知可用的编辑模型」更糟
 * 4. 其余（非 grok imagine 系，例如旧的 `grok-2-image`）→ 返回 null，
 *    表示**无法映射**：该模型在上游没有对应编辑模型，必须让上层产出告警而非
 *    悄悄换成一个用户没配过的模型
 *
 * @returns 应使用的编辑模型名；无法映射时返回 null
 */
export function resolveGrokEditModel(model: string): string | null {
  const name = model.trim().toLowerCase();
  if (!name) return null;
  if (name.includes("-edit")) return model.trim();

  const mapped = EDIT_MODEL_MAP.get(name);
  if (mapped) return mapped;

  // 未登记的 grok imagine 图像模型（如未来的 grok-imagine-image-3.0）：
  // 兜底到网关唯一的编辑模型，避免因清单滞后而静默丢弃参考图。
  if (name.includes("imagine") && name.includes("image")) {
    return FALLBACK_EDIT_MODEL;
  }

  return null;
}

/** 图片编辑请求体（grok2api 非标准 JSON 协议） */
interface GrokEditBody {
  model: string;
  prompt: string;
  images: ReadonlyArray<{ url: string }>;
}

/**
 * 构造图片编辑请求体。按契约把 URL 列表包成 `images: [{ url }]`，并截断到 8 张。
 * 导出供单测直接对齐契约，避免把协议正确性压在网络层 mock 上。
 */
export function buildGrokEditBody(
  model: string,
  prompt: string,
  referenceUrls: ReadonlyArray<string>
): GrokEditBody {
  return {
    model,
    prompt,
    images: referenceUrls
      .slice(0, GROK_EDIT_CONTRACT.maxImages)
      .map((url) => ({ url })),
  };
}

/**
 * 参考图 URL 是否是「网关回源下载不到」的本地盘地址。
 *
 * 为什么必须显式检查：未配 R2 时项目把产物落本地盘 `public/uploads`，URL 形如
 * `/uploads/...` 或 `http://localhost:3000/uploads/...`。grok2api 的编辑协议是
 * **网关自己去下载**这个 URL（见契约表末行实测证据），它在公网上够不到这些地址，
 * 结果是参考图失效——而失败形态是上游一句含糊的「对话图片无效」，排查时完全
 * 指不到「存储没配 R2」这个真因。
 */
export function isGatewayUnreachableUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  // 相对路径（本地盘降级的典型形态）网关必然够不到
  if (trimmed.startsWith("/")) return true;
  try {
    const { hostname, protocol } = new URL(trimmed);
    if (protocol !== "http:" && protocol !== "https:") return true;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".local") ||
      // 内网段：网关在公网侧，这些地址对它不可达
      /^10\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    );
  } catch {
    // 解析不了的字符串（如 data URL 被截断、纯文件名）一律视为不可达
    return true;
  }
}

export const grokImage: ImageProvider = {
  async generateImage(options, config, requestOptions) {
    const { prompt, referenceImage, referenceImages } = options;
    const { apiKey, baseUrl, model } = config;

    // 软告警而非硬阻断，理由同 openai-compatible.generateImage
    if (model && isLikelyWrongCategoryModel(model)) {
      log.warn(
        `模型「${model}」看起来像文本对话模型，但仍按 Grok 图像生成请求发出；` +
          `若上游报错，请确认「设置 > AI 模型配置 > 图像生成」的模型选择`
      );
    }

    const effectiveModel = model || "grok-2-image";

    // 合并参考图：referenceImages 数组优先；否则用单张 referenceImage
    // （入参形态与 openai-compatible.generateImage 对齐）
    const refs =
      referenceImages && referenceImages.length > 0
        ? referenceImages
        : referenceImage
          ? [referenceImage]
          : [];

    if (refs.length > 0) {
      const editModel = resolveGrokEditModel(effectiveModel);
      if (editModel) {
        return await generateImageWithEdits(
          apiKey,
          baseUrl,
          effectiveModel,
          editModel,
          prompt,
          refs,
          requestOptions?.signal
        );
      }
      // 无法映射到编辑模型：不静默丢弃参考图，显式告警后退回文生图。
      // 能力表（provider-factory.MODEL_CAPABILITY_OVERRIDES）对这类模型仍判定
      // 「不支持参考图」，上游 strategy-resolver 会产出面向用户的 warnings。
      log.warn("Grok 模型无对应编辑模型，参考图无法使用，本次退回纯文生图", {
        model: effectiveModel,
        droppedReferenceCount: refs.length,
      });
    }

    const url = `${trimUrl(baseUrl)}/images/generations`;

    const response = await fetchWithError(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: effectiveModel,
          prompt,
          n: 1,
        }),
        signal: requestOptions?.signal,
      },
      "Grok 图像生成失败",
      "submit" // 非幂等图像生成提交：只重试 429/连接前失败，防重复出图浪费上游配额
    );

    const data = await response.json();
    return data.data?.[0]?.url || data.data?.[0]?.b64_json;
  },
};

/**
 * 走 grok2api 的 JSON 图片编辑协议（`POST /images/edits`）。
 *
 * 与 openai-compatible 的同名路径差异：这里是 **JSON + images:[{url}]**，
 * 不是 OpenAI 标准的 multipart；后者会被 grok2api 以 415 拒收（见契约表）。
 */
async function generateImageWithEdits(
  apiKey: string,
  baseUrl: string,
  requestedModel: string,
  editModel: string,
  prompt: string,
  referenceUrls: ReadonlyArray<string>,
  signal?: AbortSignal
): Promise<string> {
  if (editModel !== requestedModel) {
    log.info("带参考图：已自动切到 Grok 编辑模型", {
      requestedModel,
      editModel,
      reason:
        "Grok Web 模式下生成模型不提供图片编辑能力，编辑为独立的 -edit 模型",
    });
  }

  // 本地盘降级告警：网关需回源下载参考图 URL，够不到本地地址（见
  // isGatewayUnreachableUrl 注释）。不静默失败，显式指向真因（存储未配 R2）。
  const unreachable = referenceUrls.filter(isGatewayUnreachableUrl);
  if (unreachable.length > 0) {
    log.warn(
      "参考图 URL 对 Grok 网关不可达，图片编辑很可能失败：" +
        "grok2api 需要自行回源下载参考图，而当前 URL 是本地/内网地址。" +
        "请配置 Cloudflare R2（R2_ENDPOINT 等）让参考图有公网地址。",
      {
        unreachableCount: unreachable.length,
        totalCount: referenceUrls.length,
        sample: unreachable[0],
      }
    );
  }

  if (referenceUrls.length > GROK_EDIT_CONTRACT.maxImages) {
    log.warn("参考图数量超过 Grok 网关上限，已截断", {
      provided: referenceUrls.length,
      limit: GROK_EDIT_CONTRACT.maxImages,
    });
  }

  const url = `${trimUrl(baseUrl)}/images/edits`;
  const response = await fetchWithError(
    url,
    {
      method: "POST",
      headers: {
        // 必须是 JSON：multipart 会被网关以 415 拒收
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildGrokEditBody(editModel, prompt, referenceUrls)),
      signal,
    },
    "Grok 图片编辑失败",
    "submit" // 同文生图：非幂等提交，只重试 429/连接前失败
  );

  const data = await response.json();
  // 响应结构与 OpenAI 一致（data[0].url / b64_json）；用 pluckPath 在上游返回
  // 非标准结构时给出可读中文错误，而不是崩在裸下标的 TypeError 上。
  const first = pluckPath<Record<string, unknown>>(
    data,
    ["data", 0],
    "Grok 图片编辑响应"
  );
  const result = first.url ?? first.b64_json;
  if (typeof result !== "string" || !result) {
    throw new Error(
      "Grok 图片编辑响应缺少图像数据（data[0].url / data[0].b64_json 均为空）"
    );
  }
  return result;
}
