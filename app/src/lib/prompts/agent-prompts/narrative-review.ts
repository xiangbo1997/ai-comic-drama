/**
 * 叙事连贯评审 Prompt 模板 (P3.5 闭环3)
 *
 * 让 Observer 从"导演视角"评审整个分镜序列的叙事质量，而非单帧画面。
 * 关注：情感弧线连贯、角色出场连续、镜头语言多样性。
 */

export const STORYBOARD_REVIEW_SYSTEM = `你是一位资深漫剧导演与剧本顾问。你的职责是审查整个分镜序列的叙事质量，
而不是单张画面。你要从观众的观看体验出发，判断分镜是否讲好了故事。

评审维度：
1. narrative_flow (叙事连贯, 权重 40%): 场景顺序是否合理，情感弧线是否自然过渡，
   是否有突兀的情绪跳变（如"悲伤"直接跳到"欢快"而无铺垫）。
2. character_continuity (角色连续, 权重 30%): 主要角色的出场是否连贯，
   是否有角色凭空消失/出现，主角戏份分布是否合理。
3. visual_diversity (镜头多样, 权重 30%): 景别(特写/近景/中景/远景)是否有变化，
   是否全程同一种景别导致单调；运镜与转场是否服务于叙事。

评分规则：
- 每项 0-100，overall = 加权平均
- pass = overall >= 70
- 任一项 < 40 则不通过`;

/** 把分镜序列摘要成可评审的文本 */
export interface SceneSummary {
  id: number;
  shotType: string;
  emotion: string;
  characters: string[];
  description: string;
}

export function buildStoryboardReviewPrompt(scenes: SceneSummary[]): string {
  const lines = scenes
    .map(
      (s, i) =>
        `${i + 1}. [${s.shotType}|${s.emotion}|角色:${
          s.characters.join("/") || "无"
        }] ${s.description}`
    )
    .join("\n");

  return `请审查以下分镜序列的整体叙事质量（共 ${scenes.length} 个分镜）：

${lines}

请输出 JSON 评审结果：
{
  "pass": true | false,
  "score": {
    "overall": 75,
    "dimensions": {
      "narrative_flow": 80,
      "character_continuity": 75,
      "visual_diversity": 70
    },
    "pass": true,
    "feedback": "整体连贯，但第3-4镜情绪过渡略突兀"
  },
  "retryable": true,
  "suggestions": [
    "第4镜前可加一个过渡镜头缓冲情绪",
    "全片中景偏多，高潮处建议用特写增强张力"
  ]
}

只输出纯 JSON。`;
}

/**
 * 视频连贯评审 Prompt 模板 (P3.5 闭环4)
 *
 * 评审整个视频序列的镜头衔接质量。聚焦"动起来之后"的连贯：
 * 转场是否自然、运镜是否服务叙事、相邻镜头是否有突兀跳切。
 */
export const VIDEO_REVIEW_SYSTEM = `你是一位资深漫剧剪辑师。你审查的是分镜「动画化为视频后」的镜头衔接质量，
而非单帧画面。从观众连续观看的流畅度出发评判。

评审维度：
1. transition_flow (转场流畅, 权重 40%): 相邻镜头的转场（cut/fade/dissolve）是否自然，
   有无突兀的硬切破坏情绪。
2. motion_continuity (运动连续, 权重 35%): 运镜方向、角色动作在镜头间是否连贯。
3. pacing (节奏, 权重 25%): 镜头时长分布是否合理，快慢节奏是否服务于剧情张力。

评分规则：每项 0-100，overall = 加权平均；pass = overall >= 60；任一项 < 35 不通过。`;

export interface VideoSceneSummary {
  id: number;
  shotType: string;
  duration: number;
  cameraMovement?: string;
  transition?: string;
  description: string;
}

export function buildVideoReviewPrompt(scenes: VideoSceneSummary[]): string {
  const lines = scenes
    .map(
      (s, i) =>
        `${i + 1}. [${s.shotType}|${s.duration}s|运镜:${
          s.cameraMovement || "固定"
        }|转场:${s.transition || "cut"}] ${s.description}`
    )
    .join("\n");

  return `请审查以下视频镜头序列的衔接连贯性（共 ${scenes.length} 个镜头）：

${lines}

请输出 JSON 评审结果（结构同叙事评审，dimensions 为 transition_flow/motion_continuity/pacing）。只输出纯 JSON。`;
}
