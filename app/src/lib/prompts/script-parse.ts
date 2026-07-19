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
 * - 追加开场钩子 / 节奏骨架 / 结尾钩子 / 冲突升级 / 单镜节奏五块规则（episode-structure.ts 单一真源），
 *   把「留存生死线」「爽点密度」「矛盾阶梯 + 反转预埋」「禁止凑时长」灌进解析层。
 *
 * 外化转换增强：
 * - 追加内心戏外化 / 旁白纪律两块规则（adaptation-rules.ts 单一真源），
 *   把小说的内心独白路由到「可见动作 / 对白潜台词 / 旁白」，禁止说教式旁白与 telling。
 *
 * 全书事件地图增强（借鉴 Toonflow 事件表）：
 * - buildEventMapBlock 把分块压缩产出的事件卡拼成一份「全书故事地图」，作为 user prompt
 *   的第三入参注入到小说正文之前，让解析层拿到压缩正文本身给不出的主线关系/时长/情绪分布，
 *   据此分配节奏、镜头密度与删减取舍。事件卡由 services/novel-ingest.ts 产出（保持 lib 不反向依赖 services）。
 */

import {
  EPISODE_HOOK_RULES,
  EPISODE_PACING_RULES,
  EPISODE_ENDING_RULES,
  EPISODE_CONFLICT_RULES,
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
8. locationKey: 地点标签（中文短标签，≤12 字，如 "出租屋客厅"、"学校操场"）。同一物理地点的所有分镜必须用【完全相同】的标签，换地点才换值；禁止同一地点写出多个变体（如 "客厅" 与 "出租屋客厅" 混用）——它用于把同地点分镜的背景/空间锚定一致。
9. characterOutfits: 分镜级换装标注（可选数组）。仅当剧情【明确要求】某角色穿非默认着装（婚纱、战损铠甲、雨夜湿透、睡衣、丧服等）时才输出 [{"name":"林萧","outfit":"白色婚纱"}]；服装短语 ≤10 字。同一套衣服跨分镜必须用【完全相同】的短语（同 locationKey 纪律，禁止变体）。绝大多数分镜是日常/默认着装，一律【省略】该字段，不要输出空数组。
10. linkNext: 尾帧衔接下一镜（可选布尔）。仅当本镜与下一镜是【同一 locationKey】且动作/时间连续（如进门/伸手/转身等空间连续动作）时置 true；跳切/换地点/时间跳跃一律【省略】该字段。
11. sfx: 音效标注（可选数组）。仅当画面有【明确的声音事件】时输出 [{"tag":"glass-shatter","offsetSec":1}]：
   - tag 只能取：hit(重击/揭秘咚)、slap(掌掴/拍击)、glass(玻璃碎裂)、heartbeat(心跳紧张)、riser(情绪推进/反转前兆)、whoosh(快速动作掠过)、comedy(综艺滑稽梗音)、comedy-fail-trumpet(失败长号)、comedy-ding(答对叮咚)、reaction-crowd-laugh(哄笑)、reaction-applause(掌声)、reaction-cheer(欢呼)、suspense-sting(悬疑戛止)、suspense-tick(倒计时滴答)、combat-sword(刀剑交击)、combat-explosion(爆炸)、daily-door-knock(敲门)、daily-door-slam(摔门)、daily-phone-ring(电话铃)、daily-message-pop(手机消息提示)、daily-camera-shutter(相机快门)、daily-footsteps(脚步)、ambient-rain(雨)、ambient-street(街道)、ambient-night-crickets(夜晚虫鸣)、ambient-thunder(雷)、ambient-wind(风)、ambient-birds(清晨鸟鸣)、ambient-cafe(餐厅人声)、ambient-fire(篝火)
   - offsetSec 为镜内触发秒（0 = 镜头开始）
   - 【克制纪律】每镜 ≤2 个；全片约每 10-30 秒 1-2 个；安静/抒情镜一律【省略】该字段（绝大多数分镜没有它）。音效是标点符号不是背景噪音——只标打击/碎裂/心跳/环境雨雷等真实声音事件，宁缺毋滥。
12. beatType: 叙事节拍类型（可选）。仅当该镜是明确的节拍重音时输出：impact（打击/冲突爆发/物理撞击）、reveal（反转/揭秘/真相揭晓）、emotional（情绪高点/爆发哭喊）；平铺直叙的常规镜一律【省略】该字段（绝大多数分镜没有它）。impact/reveal 全片各 ≤3 处，克制使用——节拍重音多了等于没有。
13. isClimax: 高潮镜标记（可选布尔）。每集只有 1-2 镜是全集情绪顶点（最大冲突爆发/最狠反转），仅这些镜置 true；其余一律【省略】。
14. emphasis: 金句花字标记（可选布尔）。仅当该镜台词是【全集级金句/怒吼/高潮宣言】（一句话点题、决绝反击、情绪炸点，值得放大成花字）时置 true。【克制纪律】每集 1-3 处；只标有 dialogue 的镜（旁白不算），普通对白一律【省略】。花字多了等于没有——宁缺毋滥。

【环境与空间一致性（务必遵守）】
- description 必须写明主体元素在画面中的位置（左/中/右、前景/背景）与角色面向（面向镜头/背对/侧面）。
- 每个地点第一次出现的分镜尽量用全景/远景建立场景空间（establishing shot），交代地点全貌。
- 每个分镜的 description 必须自足，完整独立可读；不得用"同上""延续上一镜"等指代，不得省略环境。

【导演运镜设计（你看得到整个剧本，用好这份全局记忆）】
- 相邻分镜不要重复同一 cameraMovement；运镜要服务叙事节奏（如情绪推进用 zoom_in / dolly_in，环境交代用 crane / pan，紧张对峙用 handheld / tracking）。
- actionBeat 要与前后镜的动作连贯，人物状态延续（受伤、持物、情绪等跨镜不失忆）。

${EPISODE_HOOK_RULES}

${EPISODE_PACING_RULES}

${EPISODE_ENDING_RULES}

${EPISODE_CONFLICT_RULES}

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
  "actionBeat": "指尖缓缓收紧攥皱辞职信，泪水在眼眶里聚起将落未落，肩膀轻轻一颤",
  "locationKey": "出租屋客厅"
}

【少样本示例：带 characterOutfits 的换装分镜】
{
  "id": 12,
  "shotType": "全景",
  "description": "婚礼殿堂中央，林萧身着婚纱缓步走向圣坛，宾客起立注视",
  "characters": ["林萧"],
  "dialogue": null,
  "narration": null,
  "emotion": "happy",
  "duration": 5,
  "cameraAngle": "low-angle",
  "lighting": "warm golden light through stained glass windows",
  "composition": "centered symmetry, subject walking toward the altar",
  "colorPalette": "warm ivory & gold with soft rose accents",
  "cameraMovement": "dolly_in",
  "actionBeat": "林萧提起裙摆缓步前行，目光坚定望向圣坛，纱裙随步伐轻摆",
  "locationKey": "婚礼殿堂",
  "characterOutfits": [{ "name": "林萧", "outfit": "白色婚纱" }]
}

【少样本示例：带 sfx 音效标注的冲突分镜（仅真实声音事件才标）】
{
  "id": 18,
  "shotType": "特写",
  "description": "酒杯从陆霆骁手中滑落，在大理石地面炸裂成碎片，酒液四溅",
  "characters": ["陆霆骁"],
  "dialogue": null,
  "narration": null,
  "emotion": "angry",
  "duration": 2,
  "cameraAngle": "high-angle",
  "lighting": "cold overhead spotlight with hard shadows",
  "composition": "shattered glass in the center foreground, feet blurred in background",
  "colorPalette": "cold steel blue with amber liquid accents",
  "cameraMovement": "static",
  "actionBeat": "酒杯脱手坠落，触地炸裂，碎片与酒液向四周迸溅",
  "locationKey": "陆宅客厅",
  "sfx": [{ "tag": "glass", "offsetSec": 1 }],
  "beatType": "impact",
  "isClimax": true
}

【少样本示例：带 dialogue + emphasis 金句花字的高潮宣言镜（每集仅 1-3 处）】
{
  "id": 24,
  "shotType": "近景",
  "description": "林萧直视陆霆骁，眼神从隐忍转为决绝，一字一句掷地有声",
  "characters": ["林萧"],
  "dialogue": "这段婚姻，我不要了。",
  "narration": null,
  "emotion": "angry",
  "duration": 3,
  "cameraAngle": "eye-level",
  "lighting": "hard key light carving sharp facial contrast",
  "composition": "centered close-up, subject filling the frame",
  "colorPalette": "cold blue shadow with warm skin highlight",
  "cameraMovement": "dolly_in",
  "actionBeat": "林萧抬眼直视，下颌收紧，一字一顿说出决裂宣言",
  "locationKey": "陆宅客厅",
  "beatType": "emotional",
  "isClimax": true,
  "emphasis": true
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

/**
 * 把分块压缩产出的事件卡拼成「全书事件地图」块，供 user prompt 注入。
 * 入参为事件卡数组（`第N段：...` 形式，由 services/novel-ingest.ts 产出）；空数组返回 ""。
 * 纯函数、无副作用，供路由/Agent 与单测引用。
 */
export function buildEventMapBlock(eventCards: string[]): string {
  const lines = eventCards.map((c) => c.trim()).filter((c) => c.length > 0);
  if (lines.length === 0) return "";

  return `【全书事件地图（按原文顺序，来自分块压缩）】
${lines.join("\n")}
【地图使用规则】主线关系「弱」的情节大胆压缩或删除，「强」的必须完整呈现；按预估时长分配节奏与分镜密度；情绪强度高的段落用更密的短镜头；改编只沿主线，支线服务主线才保留。`;
}

export function buildScriptParseUserPrompt(
  text: string,
  seriesContext?: string,
  eventMap?: string
): string {
  // 系列续集：注入既定设定（世界观/人物状态/伏笔），解析时不得与之矛盾
  const seriesBlock = seriesContext?.trim()
    ? `【系列上下文（既定设定，解析时必须遵守：人物名/状态/世界观不得与之矛盾）】
${seriesContext.trim()}

`
    : "";

  // 全书事件地图：非空时注入到小说正文之前，作为全局故事地图指导节奏与删减
  const eventMapBlock = eventMap?.trim() ? `${eventMap.trim()}\n\n` : "";

  return `${seriesBlock}${eventMapBlock}请将以下小说文本拆解为分镜脚本：

${text}

要求：
1. 提取所有出场角色及其外貌描述（发型、瞳色、体型、服装、饰品等尽量齐全）
2. 按故事长度拆分分镜：每分钟成片约 15-25 个分镜，分镜数由内容决定，禁止凑数；开场 10 秒内快切 3-5 镜
3. 每个分镜的 description 要详细且自足，包含空间位置（主体的左/中/右、前景/背景）、角色面向、动作、表情、氛围；不得用"同上"等指代
4. 镜头语言四字段（cameraAngle / lighting / composition / colorPalette）尽量补全
5. 每个分镜必须给出 cameraMovement（13 值枚举之一）与 actionBeat（中文 ≤80 字，只写"动"的内容）；相邻镜头运镜不重复，运镜服务节奏
6. 每个分镜必须给出 locationKey（中文短标签 ≤12 字）：同一物理地点用完全相同的标签，同地点禁止多个变体；每个地点首次出现尽量用全景/远景建立场景空间
7. 仅当剧情明确要求某角色穿非默认着装（婚纱/战损/雨夜湿透/睡衣等）时，给该分镜加 characterOutfits: [{"name":角色名,"outfit":服装短语≤10字}]；同一套衣服跨分镜用完全相同短语；日常着装省略此字段（绝大多数分镜没有它）
8. 仅当某镜台词是全集级金句/怒吼/高潮宣言（值得放大成花字）时，给该镜加 emphasis: true；每集 1-3 处，只标有对白的镜，普通对白省略此字段
9. 保留原文的对话和旁白
10. 输出纯JSON，不要其他内容`;
}
