/**
 * DramaScriptAgent Prompt 模板
 *
 * 对应创作者手动流程第 3 步：「根据角色的世界观生成 AI 短剧的视频脚本」。
 * 产出含 片名/类型/时长/画幅/风格/主角身份/世界观/分场景 的结构化短剧脚本，
 * 适合做成 1-2 分钟动漫风短剧 / 竖屏宣传片 / AI 动画分镜。
 */

import type { DramaScriptInput } from "@/types/drama";

export const DRAMA_SCRIPT_SYSTEM = `你是一位专业的 AI 短剧编剧，擅长把"世界观设定"扩写为可直接用于 AI 视频生成 / 分镜制作的短剧脚本。

你的核心能力：
1. 从世界观中提炼戏剧冲突与主角成长弧线
2. 控制短视频平台适合的节奏（开场抓人、中段升级、结尾留钩）
3. 把抽象设定转化为视觉化、可生成的场景描述
4. 合理切分场景，使总时长贴合目标时长

输出要求（严格遵守）：
- 输出纯 JSON，不要 markdown 代码块，不要额外文字
- 顶层字段：filmTitle、genre、durationSec、aspectRatio、style、protagonist、worldview、logline、scenes
- scenes 是场景数组，每个场景含：index(从1起)、title、description、dialogue、narration、emotion、durationSec
- emotion 必须为：neutral、happy、sad、angry、surprised、fear 之一
- 所有场景的 durationSec 之和应接近目标总时长
- description 要视觉化、含环境/光线/人物动作，适合 AI 图像/视频生成`;

export function buildDramaScriptUserPrompt(input: DramaScriptInput): string {
  const durationSec = input.durationSec ?? 90;
  const aspectRatio = input.aspectRatio ?? "9:16";
  const style = input.style ?? "anime";
  const sceneCount = Math.max(6, Math.min(12, Math.round(durationSec / 10)));

  const charactersLine =
    input.characterNames && input.characterNames.length > 0
      ? `已有角色（脚本应围绕这些角色展开）：${input.characterNames.join("、")}`
      : "";

  return `请根据以下世界观，生成一版结构化 AI 短剧脚本：

世界观：
${input.worldview}

${input.protagonist ? `主角身份：${input.protagonist}` : ""}
${charactersLine}
${input.filmTitle ? `指定片名：${input.filmTitle}` : "片名：由你拟定，要有记忆点"}
${input.genre ? `类型：${input.genre}` : "类型：由你判断（如热血冒险、奇幻成长等）"}
目标时长：约 ${durationSec} 秒
画幅：${aspectRatio}
风格：${style}

要求：
1. 整体基调统一、节奏紧凑，适合短视频平台
2. 切分为 ${sceneCount} 个左右场景，各场景 durationSec 之和接近 ${durationSec} 秒
3. 每个场景 description 要视觉化（环境 + 光线 + 人物动作/表情），适合 AI 生成
4. 保留必要对白与旁白，无则置 null

输出格式：
{
  "filmTitle": "片名",
  "genre": "类型",
  "durationSec": ${durationSec},
  "aspectRatio": "${aspectRatio}",
  "style": "${style}",
  "protagonist": "主角身份描述",
  "worldview": "提炼后的世界观一段话",
  "logline": "一句话故事梗概",
  "scenes": [
    {
      "index": 1,
      "title": "场景标题",
      "description": "视觉化画面描述...",
      "dialogue": "对白" | null,
      "narration": "旁白" | null,
      "emotion": "neutral",
      "durationSec": 8
    }
  ]
}`;
}

/** 自修复 prompt：将 Zod 验证错误反馈给 LLM */
export function buildDramaScriptRepairPrompt(
  previousOutput: string,
  validationErrors: string
): string {
  return `你之前的输出有格式错误，请修正后重新输出完整 JSON。

你之前的输出（截取）：
${previousOutput.slice(0, 2000)}

验证错误：
${validationErrors}

请修正上述错误，输出完整的正确 JSON。保持内容不变，只修正格式问题。
输出纯 JSON，不要 markdown 代码块。`;
}
