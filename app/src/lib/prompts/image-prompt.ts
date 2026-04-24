/**
 * 图像生成 Prompt 模板
 */

/** 风格前缀映射 */
const STYLE_MAP: Record<string, string> = {
  anime: "anime style, Japanese animation, vibrant colors, clean lines",
  realistic:
    "photorealistic, highly detailed, cinematic lighting, 8k resolution",
  comic: "comic book style, bold outlines, dynamic composition, cel shading",
  watercolor: "watercolor painting style, soft edges, flowing colors",
  oil: "oil painting style, rich textures, classical composition",
  sketch: "pencil sketch style, detailed linework, artistic shading",
  "3d": "3D rendered, Pixar style, smooth surfaces, volumetric lighting",
  cyberpunk: "cyberpunk style, neon lights, futuristic, high contrast",
  fantasy: "fantasy art style, magical atmosphere, ethereal lighting",
};

export function getStylePrefix(style?: string): string {
  return STYLE_MAP[style || "anime"] || STYLE_MAP.anime;
}

/** 景别描述映射 */
const SHOT_MAP: Record<string, string> = {
  特写: "extreme close-up shot, face detail",
  近景: "close-up shot, head and shoulders",
  中景: "medium shot, waist up",
  全景: "full shot, entire body visible",
  远景: "wide shot, environment emphasis",
  俯拍: "high angle shot, looking down",
  仰拍: "low angle shot, looking up",
  平拍: "eye level shot",
};

export function getShotTypeDescription(shotType?: string): string {
  return SHOT_MAP[shotType || "中景"] || "medium shot";
}

/** 简易 prompt 风格前缀（与 script.ts 中的 generateImagePrompt 对齐） */
const SIMPLE_STYLE_MAP: Record<string, string> = {
  anime: "anime style, high quality anime illustration,",
  realistic: "photorealistic, cinematic lighting,",
  comic: "comic book style, bold lines,",
  watercolor: "watercolor painting style, soft colors,",
};

export function getSimpleStylePrefix(style: string): string {
  return SIMPLE_STYLE_MAP[style] || "anime style,";
}
