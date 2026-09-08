/**
 * 图像生成请求的解析 / 归一化（纯函数，无 IO）
 *
 * 从 api/generate/image/route.ts 原样提取（零行为变更）：请求体字段解构 +
 * 档位合法化 + 成本预估 + 参考图排序去重。route 保留鉴权、限流、内容安全、
 * 候选循环、VLM 择优与错误映射。
 */

import { normalizeCandidateCount } from "@/services/generation";

/**
 * 图像生成成本（积分）。
 *
 * ⚠️ 这里是**兜底默认值**，不是真源：运行时单价由 `lib/system-config.ts` 的
 * `COST_IMAGE_NORMAL` / `COST_IMAGE_WITH_REF` 决定，route 读配置后作为
 * `costs` 参数传进 normalizeImageRequest。本常量仅在未显式传参时使用
 * （保持纯函数可独立测试，且值与配置默认值一致）。
 */
export const IMAGE_COST = {
  normal: 1, // 普通生成
  withRef: 3, // 带参考图（角色一致性）
};

/** 单价入参：由调用方从系统配置读出后传入 */
export interface ImageCosts {
  normal: number;
  withRef: number;
}

/** 原始请求体（客户端可传字段，全部按 unknown 收，由本模块归一化） */
export interface ImageRequestBody {
  prompt?: unknown;
  referenceImage?: unknown;
  /**
   * Stage 修复：客户端三视图会传 referenceImages 数组（front/side/back），
   * 此前未解构导致多张参考图被丢弃，三视图锁形象在服务端实质失效。
   */
  referenceImages?: unknown;
  aspectRatio?: unknown;
  style?: unknown;
  projectId?: unknown;
  sceneId?: unknown;
  imageConfigId?: unknown;
  /**
   * Stage 1.3 引入：客户端可显式传入 negativePrompt。orchestrator 将在 Stage 1.4
   * 正式消费（目前先记录，便于观察管线是否打通）。
   */
  negativePrompt?: unknown;
  /**
   * 迭代式生成：iterate=true 时 referenceImages 是「上一版整图」，
   * note 是用户追加指令（"改成夜晚"）——note 会被提权到 finalPrompt 最前，
   * iterate 透传给 orchestrator 切换 reference_edit 措辞。
   */
  note?: unknown;
  iterate?: unknown;
  /** AI 场记修复：前镜当前图作迭代一致性锚图，orchestrator 按 provider 能力门控注入。 */
  iterationAnchorUrl?: unknown;
  /**
   * 多候选抽卡档位（批次 2 · 1.4A）：1 / 2 / 4，缺省 1。
   * count=1 时行为与单发生成完全一致（零回归）；2/4 张并行生成后 VLM 择优。
   */
  count?: unknown;
}

/** 归一化后的图像生成请求（route 后续逻辑只读这份结构） */
export interface NormalizedImageRequest {
  prompt: string;
  referenceImage: string | undefined;
  referenceImages: string[] | undefined;
  /** 画幅：仅放行三个合法枚举值，其余（含非法字符串）为 undefined 走下游缺省 */
  aspectRatio: "1:1" | "9:16" | "16:9" | undefined;
  style: string | undefined;
  projectId: string | undefined;
  sceneId: string | undefined;
  imageConfigId: string | undefined;
  negativePrompt: string | undefined;
  /** 用户追加指令（已 trim；无则空串，与拆分前的 iterationNote 语义一致） */
  note: string;
  iterate: boolean;
  /** 迭代一致性锚图（已 trim；非字符串/空为 undefined） */
  iterationAnchorUrl: string | undefined;
  /**
   * 落 GenerationTask.input 的原始留痕值（审计用）。
   * 与归一化后的 note / iterate / iterationAnchorUrl 分开，保持拆分前的落库内容
   * 逐字节一致：note 不 trim、iterate 保留原值、锚图仅做 string 类型判定。
   */
  rawInput: {
    note: string | null;
    /** 原样落库的 iterate（非布尔输入按 Boolean 收敛，满足 Prisma Json 约束） */
    iterate: boolean;
    iterationAnchorUrl: string | null;
  };
  /** 档位合法化后的候选张数（仅 1 / 2 / 4） */
  candidateCount: number;
  /**
   * 显式参考图列表（去重后）：客户端显式指定的 referenceImage 作为列表第一项优先生效；
   * 无任何参考图时为 undefined（orchestrator 走无参考图路径）。
   */
  explicitRefs: string[] | undefined;
  /** 是否携带显式参考图（决定单张成本档位） */
  hasExplicitRef: boolean;
  /** 单张预估成本（带参考图更高） */
  perImageCost: number;
  /** 前置余额校验用的总预估成本 = 单张 × 候选张数 */
  cost: number;
}

/** 非空字符串取值，其余一律 undefined（防止把 number/object 误当字符串下传） */
function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 画幅白名单（与 orchestrator 的 aspectRatio 联合类型一致） */
const ASPECT_RATIOS = ["1:1", "9:16", "16:9"] as const;

/**
 * 画幅归一化：只放行三个合法值。
 * 下游两个消费点对非法值本就无行为（orchestrator 类型只接受这三个；
 * buildEnhancedPrompt 仅在 === "9:16" 时分支），故过滤不改变行为。
 */
function asAspectRatio(value: unknown): "1:1" | "9:16" | "16:9" | undefined {
  return typeof value === "string" &&
    (ASPECT_RATIOS as readonly string[]).includes(value)
    ? (value as "1:1" | "9:16" | "16:9")
    : undefined;
}

/**
 * 解析并归一化图像生成请求体。
 *
 * 与拆分前 route 内联逻辑逐条对应：
 *   - 档位合法化：仅放行 1 / 2 / 4，非法值回落 1（零回归基石）；
 *   - 成本预估：编排器使用参考图时成本更高，此处做保守预扣；
 *   - 参考图排序：referenceImages 数组优先，否则回落单张 referenceImage
 *     （客户端显式指定的 referenceImage 作为列表第一项优先生效），并按序去重。
 *
 * prompt 缺失时返回 prompt 为空串，由 route 统一返回 400（错误映射留在 route）。
 */
export function normalizeImageRequest(
  body: ImageRequestBody,
  costs: ImageCosts = IMAGE_COST
): NormalizedImageRequest {
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const referenceImage = asOptionalString(body.referenceImage);
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.filter(
        (v): v is string => typeof v === "string" && v.length > 0
      )
    : undefined;

  // 档位合法化：仅放行 1 / 2 / 4，非法值回落 1（零回归基石）
  const candidateCount = normalizeCandidateCount(body.count);

  // 成本预估（编排器使用参考图时成本更高，此处做保守预扣）
  const hasExplicitRef = !!(
    referenceImage ||
    (referenceImages && referenceImages.length > 0)
  );
  // 单张预估成本；多候选按 candidateCount × 单价做前置余额校验（实际按成功张数扣费）
  const perImageCost = hasExplicitRef ? costs.withRef : costs.normal;
  const cost = perImageCost * candidateCount;

  // 显式参考图：数组优先；否则单张。按序去重，避免同一张图重复占参考位
  // （多视图/迭代锚图场景下客户端可能重复传同一 URL）。
  const orderedRefs =
    referenceImages && referenceImages.length > 0
      ? referenceImages
      : referenceImage
        ? [referenceImage]
        : undefined;
  const explicitRefs = orderedRefs
    ? Array.from(new Set(orderedRefs))
    : undefined;

  // 迭代式生成：用户追加指令 trim 后提权（空串表示无追加指令）
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const iterate = body.iterate === true;
  const rawAnchor =
    typeof body.iterationAnchorUrl === "string"
      ? body.iterationAnchorUrl.trim()
      : "";

  return {
    prompt,
    referenceImage,
    referenceImages,
    aspectRatio: asAspectRatio(body.aspectRatio),
    style: asOptionalString(body.style),
    projectId: asOptionalString(body.projectId),
    sceneId: asOptionalString(body.sceneId),
    imageConfigId: asOptionalString(body.imageConfigId),
    negativePrompt: asOptionalString(body.negativePrompt),
    note,
    iterate,
    iterationAnchorUrl: rawAnchor || undefined,
    // 原始留痕：与拆分前 route 里 `note ?? null` /
    // `typeof x === "string" ? x : null` 的落库值等价。
    // iterate 落 `body.iterate === true`（即实际生效的布尔值）——拆分前写的是
    // `iterate ?? false`，非布尔真值（如字符串 "1"）会被原样塞进 Json；
    // 但生效判据一直是 `iterate === true`，故留痕改记生效值更贴合审计语义，
    // 且满足 Prisma InputJsonValue 的类型约束。
    rawInput: {
      note: typeof body.note === "string" ? body.note : null,
      iterate,
      iterationAnchorUrl:
        typeof body.iterationAnchorUrl === "string"
          ? body.iterationAnchorUrl
          : null,
    },
    candidateCount,
    explicitRefs,
    hasExplicitRef,
    perImageCost,
    cost,
  };
}
