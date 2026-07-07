/**
 * 短剧创作工作流类型定义
 *
 * 覆盖创作链：世界观→结构化脚本（阶段1）→ 九宫格分镜表（阶段2）→ 一键九宫格图（阶段3）。
 * 与 Scene（一镜一图执行单元）解耦，作为可反复打磨的创作态草稿。
 */

/** 生成结构化短剧脚本的输入（创作者提供世界观 + 参数） */
export interface DramaScriptInput {
  /** 世界观设定（必填，创作的源头） */
  worldview: string;
  /** 主角身份描述 */
  protagonist?: string;
  /** 已有角色名列表（让脚本与角色库对齐） */
  characterNames?: string[];
  /** 片名（可选，留空则由 AI 拟定） */
  filmTitle?: string;
  /** 类型，如「热血冒险」 */
  genre?: string;
  /** 时长（秒），默认 90 */
  durationSec?: number;
  /** 画幅，默认 9:16 */
  aspectRatio?: string;
  /** 风格，默认 anime */
  style?: string;
  /**
   * 前情提要（系列第 N>1 集时由服务端自动生成，见 lib/series.ts）。
   * 注入 prompt 让本集剧情承接上一集结尾；客户端不传此字段。
   */
  previousEpisodeRecap?: string;
}

/** 结构化脚本中的单个场景 */
export interface DramaSceneScript {
  /** 场景序号（从 1 起） */
  index: number;
  /** 场景标题 */
  title: string;
  /** 画面描述 */
  description: string;
  /** 对白（可为空） */
  dialogue: string | null;
  /** 旁白（可为空） */
  narration: string | null;
  /** 情绪基调 */
  emotion: string;
  /** 本场景预估时长（秒） */
  durationSec: number;
}

/**
 * 结构化短剧脚本产物（阶段1 LLM 输出）
 *
 * 对应创作者手动流程第 3 步：根据世界观生成含片名/类型/时长/画幅/风格/主角身份/世界观/分场景的完整脚本。
 */
export interface DramaScriptArtifact {
  filmTitle: string;
  genre: string;
  durationSec: number;
  aspectRatio: string;
  style: string;
  protagonist: string;
  worldview: string;
  /** 一句话故事梗概 */
  logline: string;
  scenes: DramaSceneScript[];
}

/** 九宫格分镜表的单格（阶段2） */
export interface StoryboardCell {
  /** 格序号 1-9 */
  index: number;
  /** 场景标题 */
  sceneTitle: string;
  /** 镜头语言（景别 + 运镜） */
  shot: string;
  /** 对白（可为空） */
  dialogue: string | null;
  /** 特写要点 */
  closeup: string;
  /** 转场效果 */
  transition: string;
  /** 可选关联缩略图 URL */
  thumbnailUrl?: string;
}

/** 九宫格分镜表产物（阶段2，存 ShortDramaScript.storyboard） */
export interface StoryboardTableArtifact {
  cells: StoryboardCell[];
}
