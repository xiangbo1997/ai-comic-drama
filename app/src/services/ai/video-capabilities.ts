/**
 * 视频模型能力表
 *
 * 不同视频 provider 的原生片段能力差异极大：
 * - flow2api / Veo：无视请求 duration，固定输出 ~8s 片段，但支持首尾帧插值（FL）。
 * - runway / fal / proxy-unified：接受 duration 参数，档位 5/10/15。
 *
 * 分段生成（scene → N 段视频 → 拼接单 videoUrl）需要先知道模型的真实能力，
 * 才能规划段数与每段请求参数。本表是所有分段决策的唯一数据源，镜像图像端
 * `provider-factory.ts#IMAGE_PROVIDER_CAPABILITIES` 的组织方式。
 *
 * 两级查表：先按**模型 ID**（VIDEO_MODEL_CAPABILITIES），未命中再按
 * **protocol**（VIDEO_PROVIDER_CAPABILITIES）。因为中转协议下的模型能力
 * 可以完全不同（proxy-unified 背后可能是 Veo，也可能是 5/10/15 档模型）。
 */

/** 单个视频模型的能力声明 */
export interface VideoModelCapability {
  /**
   * 原生片段时长（秒）：模型「实际」输出的单段长度。
   * 对忽略 duration 参数的模型（Veo）这是固定值；对接受参数的模型是最大可请求档。
   */
  nativeClipSeconds: number;
  /**
   * 可请求的 duration 档位（升序）。acceptsDurationParam=false 时为空数组
   * （请求 duration 无意义，不下发）。
   */
  requestableDurations: readonly number[];
  /** 是否接受并遵循 duration 参数。false = 模型忽略请求时长（Veo）。 */
  acceptsDurationParam: boolean;
  /**
   * 是否支持首尾帧插值（first-last-frame）：分段链最后一段用它衔接下一分镜的
   * 开场图。仅 flow2api/Veo（FL 模型）支持；runway/fal 的 i2v 只吃首帧。
   */
  supportsFirstLastFrame: boolean;
  /** 链式分段的最大段数（防止 60s 拆出过多段拖垮生成时间）。 */
  maxChainSegments: number;
}

/** 未知 protocol 的兜底能力：等价当前单段行为（5/10/15 档、单段不分段）。 */
const DEFAULT_VIDEO_CAPABILITY: VideoModelCapability = {
  nativeClipSeconds: 15,
  requestableDurations: [5, 10, 15],
  acceptsDurationParam: true,
  supportsFirstLastFrame: false,
  maxChainSegments: 6,
};

/**
 * 各 protocol 的能力表。
 *
 * flow2api（Veo）：固定 ~8s，忽略 duration，但支持 FL 首尾帧。
 * runway：gen3a_turbo 接受 5/10；此处沿用 5/10/15 档保持与既有计费/UI 一致，
 *   模型不支持的档位由上游 API 自行处理（不影响分段规划的时长语义）。
 * fal：接受 duration 参数（minimax 系列 5/10），无 FL 组合。
 * proxy-unified：中转协议透传 duration，能力随后端模型而定，取通用 5/10/15。
 */
const VIDEO_PROVIDER_CAPABILITIES: Record<string, VideoModelCapability> = {
  flow2api: {
    nativeClipSeconds: 8,
    requestableDurations: [],
    acceptsDurationParam: false,
    supportsFirstLastFrame: true,
    maxChainSegments: 6,
  },
  // runway gen3a_turbo / fal minimax 实际仅接受 5/10 档（provider 内部也按此吸附）。
  // 能力表与 provider 档位必须一致，否则会出现「按 15s 计费、实出 10s」的失配；
  // 声明 [5,10] 后 15s 请求会诚实规划成 [10,5] 两段。
  runway: {
    nativeClipSeconds: 10,
    requestableDurations: [5, 10],
    acceptsDurationParam: true,
    supportsFirstLastFrame: false,
    maxChainSegments: 6,
  },
  fal: {
    nativeClipSeconds: 10,
    requestableDurations: [5, 10],
    acceptsDurationParam: true,
    supportsFirstLastFrame: false,
    maxChainSegments: 6,
  },
  "proxy-unified": {
    nativeClipSeconds: 15,
    requestableDurations: [5, 10, 15],
    acceptsDurationParam: true,
    supportsFirstLastFrame: false,
    maxChainSegments: 6,
  },
  // openai 走 proxyUnifiedVideo，与 proxy-unified 同能力
  openai: {
    nativeClipSeconds: 15,
    requestableDurations: [5, 10, 15],
    acceptsDurationParam: true,
    supportsFirstLastFrame: false,
    maxChainSegments: 6,
  },
};

/**
 * 按模型 ID 前缀细分的能力表（优先于 protocol 表）。
 *
 * 存在原因：同一个 protocol 下的模型能力可以完全不同。最典型的是
 * `proxy-unified` —— 中转站背后可能是 Veo（固定 8s、忽略 duration），
 * 也可能是普通 5/10/15 档模型。只按 protocol 判断会给 Veo 规划出错误的
 * 段数与 duration 参数，导致「按 15s 计费、实出 8s」的失配。
 *
 * **收录标准（严格）**：只写本仓库代码已能证实的能力，来源逐条标在注释里。
 * 无法从仓库内证实的模型（kling / luma / sora / pika / wan / hunyuan 等）
 * 一律不收录 —— 让它们回落到 protocol 表，好过编一个错误的时长把计费带偏。
 *
 * 匹配规则：模型 ID 转小写后按 `includes` 命中；条目按声明顺序检查，
 * 因此更具体的前缀（veo + _fl）必须排在更宽泛的前缀（veo）之前。
 */
const VIDEO_MODEL_CAPABILITIES: ReadonlyArray<{
  /** 小写模型 ID 需包含的全部片段（AND 语义） */
  match: readonly string[];
  capability: VideoModelCapability;
}> = [
  {
    // Veo 首尾帧插值档：flow2api-video.ts#chooseModel 对 lastFrameImage 路由
    // `veo_3_1_i2v_s_fast_fl`，planImageInputs 亦按 `_fl` 后缀分槽首/尾帧。
    // 时长语义同其他 Veo（忽略 duration、固定 ~8s，见 protocol 表 flow2api 条目）。
    match: ["veo", "_fl"],
    capability: {
      nativeClipSeconds: 8,
      requestableDurations: [],
      acceptsDurationParam: false,
      supportsFirstLastFrame: true,
      maxChainSegments: 6,
    },
  },
  {
    // 非 FL 的 Veo（t2v / i2v / r2v）：同样忽略 duration、固定 ~8s，
    // 但**不支持**首尾帧——flow2api-video.ts 只有 `_fl` 系模型吃第 2 张尾帧图，
    // 其余模型第 2 张会被 planImageInputs 裁掉。protocol 表把 flow2api 整体标成
    // supportsFirstLastFrame=true，对这些变体是高估，这里按模型纠正。
    match: ["veo"],
    capability: {
      nativeClipSeconds: 8,
      requestableDurations: [],
      acceptsDurationParam: false,
      supportsFirstLastFrame: false,
      maxChainSegments: 6,
    },
  },
  {
    // Runway Gen-3 Alpha Turbo：providers/runway.ts 的 RUNWAY_DURATIONS = [5,10]，
    // 请求前按此吸附；prisma/seed.ts 亦以 gen3a_turbo 为唯一 Runway 模型。
    match: ["gen3a_turbo"],
    capability: {
      nativeClipSeconds: 10,
      requestableDurations: [5, 10],
      acceptsDurationParam: true,
      supportsFirstLastFrame: false,
      maxChainSegments: 6,
    },
  },
  {
    // MiniMax video-01 系列（fal.ts 默认模型 fal-ai/minimax/video-01-live/...）：
    // providers/fal.ts 的 FAL_DURATIONS = [5,10]，与 video-capabilities 既有注释
    // 「fal：接受 duration 参数（minimax 系列 5/10）」一致。
    match: ["minimax"],
    capability: {
      nativeClipSeconds: 10,
      requestableDurations: [5, 10],
      acceptsDurationParam: true,
      supportsFirstLastFrame: false,
      maxChainSegments: 6,
    },
  },
];

/** 按模型 ID 查能力；未命中返回 null 交由 protocol 表兜底 */
function matchModelCapability(model: string): VideoModelCapability | null {
  const id = model.toLowerCase();
  for (const entry of VIDEO_MODEL_CAPABILITIES) {
    if (entry.match.every((fragment) => id.includes(fragment))) {
      return entry.capability;
    }
  }
  return null;
}

/**
 * 获取视频模型能力。
 *
 * 查表顺序：模型 ID 表 → protocol 表 → 默认能力。
 * 模型优先的原因见 VIDEO_MODEL_CAPABILITIES 注释：中转协议（proxy-unified）
 * 背后可能挂着能力迥异的模型，只认 protocol 会规划出错误的分段与计费。
 *
 * @param protocol provider 协议（flow2api/runway/fal/proxy-unified/openai…）
 * @param model 具体模型 ID；命中模型表时优先于 protocol
 * @returns 命中的能力；均未命中回落 DEFAULT_VIDEO_CAPABILITY（当前单段行为）
 */
export function getVideoModelCapability(
  protocol: string,
  model?: string
): VideoModelCapability {
  if (model) {
    const byModel = matchModelCapability(model);
    if (byModel) return byModel;
  }
  return VIDEO_PROVIDER_CAPABILITIES[protocol] ?? DEFAULT_VIDEO_CAPABILITY;
}
