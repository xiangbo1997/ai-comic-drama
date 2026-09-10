/**
 * MCP Resource 的数据裁剪与序列化。
 *
 * 核心约束：**一律剔除 imageUrl / videoUrl / audioUrl 等媒体 URL**。
 * 理由不是省字节，而是防幻觉——把一串模型打不开的链接塞进上下文，只会诱导它
 * 编造「这张图里角色穿着红色斗篷」之类根本没依据的判断。模型该看到的是文本事实
 * （有没有出图用 *Status 表达），看不了的东西就别给。
 */

/** 分镜表在单次返回里的默认条数上限，防止长剧集撑爆上下文 */
export const STORYBOARD_PAGE_SIZE = 40;

/** 单个 Resource 返回的字符数软上限，用于给客户端标注元信息 */
export const MAX_RESULT_CHARS = 25_000;

/** 媒体字段黑名单：任何以这些名字出现的字段都不会进入 MCP 返回 */
const MEDIA_URL_FIELDS = [
  "imageUrl",
  "videoUrl",
  "audioUrl",
  "thumbnailUrl",
  "gridImageUrl",
  "coverImageUrl",
  "canonicalImageUrl",
  "referenceImages",
  "outputUrl",
] as const;

/**
 * 递归剥离对象上的媒体 URL 字段。
 *
 * 兜底用：手写 select 已经不查这些列，但资料结构（如 scriptDoc 这类 Json 列）
 * 是自由形状的，过一道统一的剥离保证不会从 Json 里漏出链接。
 */
export function stripMediaUrls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripMediaUrls(item)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if ((MEDIA_URL_FIELDS as readonly string[]).includes(key)) continue;
      out[key] = stripMediaUrls(val);
    }
    return out as T;
  }
  return value;
}

/** 生成状态三元组：让模型知道「有没有出图」而不给出图片本身 */
export interface MediaProgress {
  imageStatus: string;
  videoStatus: string;
  audioStatus: string;
}

/** 分镜的纯文本视图（无任何媒体 URL） */
export interface SceneTextView extends MediaProgress {
  id: string;
  order: number;
  shotType: string | null;
  description: string;
  dialogue: string | null;
  narration: string | null;
  emotion: string | null;
  duration: number;
  cameraMovement: string | null;
}

/** 把 Scene 行裁成纯文本视图 */
export function toSceneTextView(scene: {
  id: string;
  order: number;
  shotType: string | null;
  description: string;
  dialogue: string | null;
  narration: string | null;
  emotion: string | null;
  duration: number;
  cameraMovement: string | null;
  imageStatus: string;
  videoStatus: string;
  audioStatus: string;
}): SceneTextView {
  return {
    id: scene.id,
    order: scene.order,
    shotType: scene.shotType,
    description: scene.description,
    dialogue: scene.dialogue,
    narration: scene.narration,
    emotion: scene.emotion,
    duration: scene.duration,
    cameraMovement: scene.cameraMovement,
    imageStatus: scene.imageStatus,
    videoStatus: scene.videoStatus,
    audioStatus: scene.audioStatus,
  };
}

/**
 * 把任意结构包装成 MCP Resource 的文本内容。
 *
 * 统一走 stripMediaUrls 兜底，并在超出软上限时挂 `anthropic/maxResultSizeChars`
 * 元信息，让客户端知道内容可能被截断、应改用分页参数。
 */
export function toResourceJson(
  uri: string,
  payload: unknown
): {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
  _meta?: Record<string, unknown>;
} {
  const text = JSON.stringify(stripMediaUrls(payload), null, 2);
  const result: {
    contents: Array<{ uri: string; mimeType: string; text: string }>;
    _meta?: Record<string, unknown>;
  } = {
    contents: [{ uri, mimeType: "application/json", text }],
  };
  if (text.length > MAX_RESULT_CHARS) {
    result._meta = { "anthropic/maxResultSizeChars": MAX_RESULT_CHARS };
  }
  return result;
}
