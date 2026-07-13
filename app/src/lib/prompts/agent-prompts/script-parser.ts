/**
 * ScriptParserAgent Prompt 模板
 * 多轮解析 + 自修复
 *
 * 爆款方法论增强：与 script-parse.ts 共享 episode-structure.ts 的四块规则
 * （开场钩子 / 节奏骨架 / 结尾钩子 / 单镜节奏），两条解析路径行为一致。
 *
 * 外化转换增强：与 script-parse.ts 共享 adaptation-rules.ts 的两块规则
 * （内心戏外化 / 旁白纪律），两条解析路径行为一致。
 */

import {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  SHOT_RHYTHM_RULES,
} from "../episode-structure";
import {
  EXTERNALIZATION_RULES,
  NARRATION_DISCIPLINE_RULES,
} from "../adaptation-rules";

export const SCRIPT_PARSER_SYSTEM = `你是一个专业的漫剧分镜编剧，擅长将小说文本拆解为结构化的分镜脚本。

你的核心能力：
1. 精准识别故事节奏和情感转折点
2. 将叙事转化为视觉化的分镜描述
3. 提取并丰富角色外貌特征
4. 合理安排景别和镜头语言

输出要求（严格遵守）：
- 每个分镜包含：id、shotType、description、characters、dialogue、narration、emotion、duration
- shotType 必须为：特写、近景、中景、全景、远景 之一
- emotion 必须为：neutral、happy、sad、angry、surprised、fear 之一
- duration 为秒数，单镜默认 2-4 秒；按叙事需要可填 1-60 秒（系统会按视频模型能力自动分段衔接），绝不为凑时长拉长单镜
- description 必须足够详细，适合 AI 图像生成（包含环境、光线、人物动作/表情）
- characters 数组中的名字必须与顶层 characters 数组中的 name 完全一致
- 每个分镜必须给出运动字段（喂给视频模型，是导演的核心工作）：
  - cameraMovement 必须为：static、zoom_in、zoom_out、pan_left、pan_right、tilt_up、tilt_down、dolly_in、dolly_out、orbit、tracking、handheld、crane 之一
  - actionBeat：中文 ≤80 字，只写这一镜里"动"的内容（角色动作 / 表情变化 / 环境动态）；禁止外貌描写、禁止对白、禁止引入画面外新元素
- 导演运镜设计（你看得到整个剧本）：相邻分镜不要重复同一 cameraMovement，运镜要服务叙事节奏；actionBeat 要与前后镜连贯，人物状态跨镜延续（受伤/持物/情绪不失忆）
- 每个分镜必须给出 locationKey（中文短标签 ≤12 字，如 "出租屋客厅"）：同一物理地点用【完全相同】的标签，换地点才换值，同地点禁止多个变体——它用于把同地点分镜的背景/空间锚定一致
- 仅当剧情【明确要求】某角色穿非默认着装（婚纱/战损/雨夜湿透/睡衣等）时，给该分镜加 characterOutfits: [{"name":角色名,"outfit":服装短语≤10字}]；同一套衣服跨分镜用【完全相同】短语（同 locationKey 纪律）；日常/默认着装一律省略此字段（绝大多数分镜没有它），禁止输出空数组
- 环境与空间一致性：description 必须写明主体在画面中的位置（左/中/右、前景/背景）与角色面向（面向镜头/背对/侧面）；每个地点首次出现尽量用全景/远景建立场景空间；每个分镜 description 必须自足，不得用"同上""延续上一镜"等指代

${EPISODE_HOOK_RULES}

${EPISODE_PACING_RULES}

${EPISODE_ENDING_RULES}

${SHOT_RHYTHM_RULES}

${EXTERNALIZATION_RULES}

${NARRATION_DISCIPLINE_RULES}

输出纯 JSON，不要 markdown 代码块，不要额外文字。`;

export function buildScriptParserUserPrompt(
  text: string,
  seriesContext?: string
): string {
  // 系列续集：注入既定设定（世界观/人物状态/伏笔），解析时不得与之矛盾
  const seriesBlock = seriesContext?.trim()
    ? `【系列上下文（既定设定，解析时必须遵守：人物名/状态/世界观不得与之矛盾）】
${seriesContext.trim()}

`
    : "";

  return `${seriesBlock}请将以下小说文本拆解为分镜脚本：

${text}

要求：
1. 提取所有出场角色及其详细外貌描述（发型、发色、脸型、眼睛、身材、肤色、服装等）
2. 按故事长度拆分分镜：每分钟成片约 15-25 个分镜，分镜数由内容决定，禁止凑数；开场 10 秒内快切 3-5 镜
3. 每个分镜的 description 要包含：
   - 具体的环境/场景描述
   - 人物的动作和表情
   - 光线和氛围
   - 适合 AI 图像生成的视觉细节
4. 保留原文对话和旁白
5. 合理安排景别：对话用近景/中景，动作用全景，情感特写用特写
6. 每个分镜给出 cameraMovement（13 值枚举之一）与 actionBeat（中文 ≤80 字，只写"动"的内容）；相邻镜头运镜不重复，运镜服务节奏，动作跨镜连贯
7. 每个分镜给出 locationKey（中文短标签 ≤12 字）：同一物理地点用完全相同标签，同地点禁止多个变体；每个地点首次出现尽量用全景/远景建立场景空间；description 必须自足并写明主体位置与角色面向
8. 仅当剧情明确要求非默认着装（婚纱/战损/雨夜湿透/睡衣等）时，给该分镜加 characterOutfits: [{"name":角色名,"outfit":服装短语≤10字}]；同套衣服跨分镜用完全相同短语；日常着装省略此字段

输出格式：
{
  "title": "作品标题",
  "scenes": [
    {
      "id": 1,
      "shotType": "中景",
      "description": "详细的画面描述...",
      "characters": ["角色A"],
      "dialogue": "对话内容" | null,
      "narration": "旁白内容" | null,
      "emotion": "neutral",
      "duration": 3,
      "cameraMovement": "dolly_in",
      "actionBeat": "角色缓步向前，抬手推开半掩的门，目光扫过屋内",
      "locationKey": "老宅门厅",
      "characterOutfits": [{ "name": "角色A", "outfit": "白色婚纱" }]
    }
  ],
  "characters": [
    {
      "name": "角色A",
      "description": "详细外貌描述：性别、年龄、发型发色、脸型、眼睛颜色、身材、肤色、典型服装"
    }
  ]
}`;
}

/** 自修复 prompt：将 Zod 验证错误反馈给 LLM */
export function buildScriptParserRepairPrompt(
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
