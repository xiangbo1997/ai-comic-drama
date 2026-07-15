/**
 * DramaScriptAgent Prompt 模板
 *
 * 对应创作者手动流程第 3 步：「根据角色的世界观生成 AI 短剧的视频脚本」。
 * 产出含 片名/类型/时长/画幅/风格/主角身份/世界观/分场景 的结构化短剧脚本，
 * 适合做成 1-2 分钟动漫风短剧 / 竖屏宣传片 / AI 动画分镜。
 */

import type { DramaScriptInput } from "@/types/drama";
import {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  EPISODE_CONFLICT_RULES,
} from "../episode-structure";

export const DRAMA_SCRIPT_SYSTEM = `你是一位专业的 AI 短剧编剧，擅长把"世界观设定"扩写为可直接用于 AI 视频生成 / 分镜制作的短剧脚本。

你的核心能力：
1. 从世界观中提炼戏剧冲突与主角成长弧线
2. 控制短视频平台适合的节奏（开场抓人、中段升级、结尾留钩）
3. 把抽象设定转化为视觉化、可生成的场景描述
4. 用短切镜头堆爽点，而非拉长镜头凑时长

输出要求（严格遵守）：
- 输出纯 JSON，不要 markdown 代码块，不要额外文字
- 顶层字段：filmTitle、genre、durationSec、aspectRatio、style、protagonist、worldview、logline、hookType、scenes
- scenes 是场景数组，每个场景含：index(从1起)、title、description、dialogue、narration、emotion、durationSec、characters，以及可选镜头语言字段
- characters：本镜画面中实际登场的角色名数组；名字必须与"已有角色"列表完全一致（有列表时），不要写代词或身份描述；纯空镜/环境镜给 []；只列画面里出现的人，不要把全剧角色都塞进去
- emotion 必须为：neutral、happy、sad、angry、surprised、fear 之一
- hookType 为本集结尾钩子类型，必须是：悬念、反转、情绪、信息、危机 之一
- 每镜时长按叙事需要 2-15 秒（长动作可更长，系统会按视频模型能力自动分段衔接），总时长与目标偏差 ±20% 可接受；禁止拉长镜头凑时长，宁可多切镜头
- description 要视觉化、含环境/光线/人物动作，适合 AI 图像/视频生成
- 尽量给每个场景补齐镜头语言（可选字段，缺失不报错，但补齐能显著提升成片电影感）：
  - cameraAngle：镜头角度，如"低角度仰拍""俯视""平视"
  - lighting：光线，如"逆光""柔和侧光""冷调夜景"
  - composition：构图，如"三分法""中心对称""前景遮挡"
  - colorPalette：色调，如"冷蓝调""暖橙调""高对比黑金"
  - actionBeat：中文 ≤80 字，只写这一镜里"动"的内容（角色动作 / 表情变化 / 环境动态），禁止外貌描写与对白
  - cameraMovement 必须为：static、zoom_in、zoom_out、pan_left、pan_right、tilt_up、tilt_down、dolly_in、dolly_out、orbit、tracking、handheld、crane 之一；相邻场景不重复同一运镜，运镜服务叙事节奏

${EPISODE_HOOK_RULES}

${EPISODE_PACING_RULES}

${EPISODE_ENDING_RULES}

${EPISODE_CONFLICT_RULES}`;

export function buildDramaScriptUserPrompt(input: DramaScriptInput): string {
  const durationSec = input.durationSec ?? 90;
  const aspectRatio = input.aspectRatio ?? "9:16";
  const style = input.style ?? "anime";

  const charactersLine =
    input.characterNames && input.characterNames.length > 0
      ? `已有角色（脚本应围绕这些角色展开）：${input.characterNames.join("、")}`
      : "";

  // 系列续集：注入累积系列记忆（优先故事圣经 digest，覆盖全部前作；老系列回落
  // 上一集前情提要）。由服务端生成，见 lib/series-memory.ts / lib/series.ts。
  const recapBlock = input.previousEpisodeRecap
    ? `系列记忆（前作既定设定与剧情，仅供承接，不要在本集复述这些情节，且不得与之矛盾）：
${input.previousEpisodeRecap}
`
    : "";
  // 续集专属承接要求；结尾留钩已在下方无条件要求里，这里只补「开场承接前情」。
  const recapRequirement = input.previousEpisodeRecap
    ? "\n7. 本集是系列续集：开场自然承接系列记忆里的结尾钩子，遵守既定人物状态/世界观/未回收伏笔，推进新的冲突与剧情，结尾再留下引向下一集的悬念钩子（不得与「近 N 集钩子类型」重复）"
    : "";

  return `请根据以下世界观，生成一版结构化 AI 短剧脚本：

世界观：
${input.worldview}

${recapBlock}${input.protagonist ? `主角身份：${input.protagonist}` : ""}
${charactersLine}
${input.filmTitle ? `指定片名：${input.filmTitle}` : "片名：由你拟定，要有记忆点"}
${input.genre ? `类型：${input.genre}` : "类型：由你判断（如热血冒险、奇幻成长等）"}
目标时长：约 ${durationSec} 秒
画幅：${aspectRatio}
风格：${style}

要求：
1. 整体基调统一、节奏紧凑，适合短视频平台
2. 按情绪节拍切分场景，不按固定数量凑：开场钩子段（≤30s，冲突最高点前置）+ 三段递进冲突（每段必须有新信息 / 新爽点）+ 结尾爽点与新钩子段（≈30s）；每分钟约 15-25 镜
3. 每镜时长按叙事需要 2-15 秒（长动作可更长，系统自动分段），总时长与目标（约 ${durationSec} 秒）偏差 ±20% 可接受；禁止拉长镜头凑时长，宁可多切镜头
4. 每个场景 description 要视觉化（环境 + 光线 + 人物动作/表情），适合 AI 生成
5. 结尾必须留钩：从悬念/反转/情绪/信息/危机五类中选一，并把类型写入顶层 hookType；若系列上下文给出「近 N 集钩子类型」，本集必须选不同类型
6. 保留必要对白与旁白，无则置 null${recapRequirement}

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
  "hookType": "悬念",
  "scenes": [
    {
      "index": 1,
      "title": "场景标题",
      "description": "视觉化画面描述...",
      "dialogue": "对白" | null,
      "narration": "旁白" | null,
      "emotion": "neutral",
      "durationSec": 8,
      "characters": ["本镜实际登场的角色名"],
      "cameraAngle": "低角度仰拍",
      "lighting": "冷调夜景",
      "composition": "三分法",
      "colorPalette": "冷蓝调",
      "actionBeat": "角色抬手推开门，目光扫过屋内",
      "cameraMovement": "dolly_in"
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
