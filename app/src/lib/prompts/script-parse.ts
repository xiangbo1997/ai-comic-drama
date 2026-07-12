/**
 * 剧本拆解 Prompt 模板
 *
 * Stage 1.8 加强：
 * - 强制输出 cameraAngle / lighting / composition / colorPalette 四字段
 * - few-shot 示例明确镜头语言表达
 * - 保持向后兼容：这些字段都是可选，老记录不受影响
 *
 * LLM 导演增强：
 * - 追加 cameraMovement（运镜，13 值枚举）与 actionBeat（运动节拍，中文）两字段，
 *   直接喂给视频 prompt。你看得到全剧本，请把「镜头怎么动」设计成有节奏的整体：
 *   相邻镜头不要重复同一运镜，运镜服务于叙事节奏。
 *
 * 爆款方法论增强：
 * - 追加开场钩子 / 节奏骨架 / 结尾钩子 / 单镜节奏四块规则（episode-structure.ts 单一真源），
 *   把「留存生死线」「爽点密度」「禁止凑时长」灌进解析层。
 *
 * 外化转换增强：
 * - 追加内心戏外化 / 旁白纪律两块规则（adaptation-rules.ts 单一真源），
 *   把小说的内心独白路由到「可见动作 / 对白潜台词 / 旁白」，禁止说教式旁白与 telling。
 */

import {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  SHOT_RHYTHM_RULES,
} from "./episode-structure";
import {
  EXTERNALIZATION_RULES,
  NARRATION_DISCIPLINE_RULES,
} from "./adaptation-rules";

export const SCRIPT_PARSE_SYSTEM = `你是一个专业的漫剧分镜编剧，熟悉镜头语言与视觉叙事。你的任务是将小说文本拆解为结构化的分镜脚本。

输出要求：
1. 每个分镜必须包含：镜号(id)、景别(shotType)、画面描述(description)、出场角色(characters)、对话(dialogue)、旁白(narration)、情感(emotion)、时长(duration)
2. 每个分镜还应尽量给出以下"镜头语言"字段（如无法判断则留空字符串）：
   - cameraAngle: 镜头角度（如 eye-level / high-angle / low-angle / dutch-angle / over-the-shoulder / POV）
   - lighting: 光线描述（如 soft natural daylight / harsh rim light / warm candle glow / cold moonlight）
   - composition: 构图（如 rule of thirds with subject on left / centered symmetry / leading lines）
   - colorPalette: 色调（如 warm orange & teal / desaturated muted tones / high-contrast black and white）
3. 每个分镜还必须给出以下"运动"字段（喂给视频模型，是导演的核心工作）：
   - cameraMovement: 运镜，必须是以下之一：static、zoom_in、zoom_out、pan_left、pan_right、tilt_up、tilt_down、dolly_in、dolly_out、orbit、tracking、handheld、crane
   - actionBeat: 运动节拍，中文 ≤80 字，只写这一镜里"动"的内容（角色动作 / 表情变化 / 环境动态）；禁止外貌描写、禁止对白、禁止引入画面外新元素
4. 景别选择：特写、近景、中景、全景、远景
5. description 要具体到场景元素、角色动作、姿态与表情——适合 AI 图像生成
6. 情感标签：neutral, happy, sad, angry, surprised, fear
7. 时长单位为秒，单镜默认 2-4 秒；按叙事需要可填 1-60 秒（系统会按视频模型能力自动分段衔接），绝不为凑时长拉长单镜

【导演运镜设计（你看得到整个剧本，用好这份全局记忆）】
- 相邻分镜不要重复同一 cameraMovement；运镜要服务叙事节奏（如情绪推进用 zoom_in / dolly_in，环境交代用 crane / pan，紧张对峙用 handheld / tracking）。
- actionBeat 要与前后镜的动作连贯，人物状态延续（受伤、持物、情绪等跨镜不失忆）。

${EPISODE_HOOK_RULES}

${EPISODE_PACING_RULES}

${EPISODE_ENDING_RULES}

${SHOT_RHYTHM_RULES}

${EXTERNALIZATION_RULES}

${NARRATION_DISCIPLINE_RULES}

【少样本示例：一个分镜】
{
  "id": 4,
  "shotType": "近景",
  "description": "林萧靠在出租屋斑驳的墙边，手里攥着辞职信，泪水在眼眶里打转",
  "characters": ["林萧"],
  "dialogue": null,
  "narration": "她终究还是没有说出那句再见",
  "emotion": "sad",
  "duration": 4,
  "cameraAngle": "eye-level",
  "lighting": "soft window light from the right, creating gentle shadows",
  "composition": "subject on the left third, negative space on the right",
  "colorPalette": "desaturated cool tones with a hint of warm skin highlight",
  "cameraMovement": "dolly_in",
  "actionBeat": "指尖缓缓收紧攥皱辞职信，泪水在眼眶里聚起将落未落，肩膀轻轻一颤"
}

【完整输出结构】
{
  "title": "作品标题",
  "scenes": [ /* 上面格式的对象数组 */ ],
  "characters": [
    { "name": "林萧", "description": "24岁，黑色长发，瓜子脸，大眼睛，身材纤细" }
  ]
}

只输出合法 JSON，不要 markdown 围栏以外的任何文字。`;

export function buildScriptParseUserPrompt(
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
1. 提取所有出场角色及其外貌描述（发型、瞳色、体型、服装、饰品等尽量齐全）
2. 按故事长度拆分分镜：每分钟成片约 15-25 个分镜，分镜数由内容决定，禁止凑数；开场 10 秒内快切 3-5 镜
3. 每个分镜的 description 要详细，包含空间位置、动作、表情、氛围
4. 镜头语言四字段（cameraAngle / lighting / composition / colorPalette）尽量补全
5. 每个分镜必须给出 cameraMovement（13 值枚举之一）与 actionBeat（中文 ≤80 字，只写"动"的内容）；相邻镜头运镜不重复，运镜服务节奏
6. 保留原文的对话和旁白
7. 输出纯JSON，不要其他内容`;
}
