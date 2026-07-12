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
 * 获取视频模型能力。
 *
 * @param protocol provider 协议（flow2api/runway/fal/proxy-unified/openai…）
 * @param _model 具体模型 ID（当前能力仅按 protocol 区分；参数预留供将来按模型细分）
 * @returns 命中的能力；未知 protocol 回落 DEFAULT_VIDEO_CAPABILITY（当前单段行为）
 */
export function getVideoModelCapability(
  protocol: string,
  _model?: string
): VideoModelCapability {
  return VIDEO_PROVIDER_CAPABILITIES[protocol] ?? DEFAULT_VIDEO_CAPABILITY;
}
