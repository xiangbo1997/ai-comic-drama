/**
 * 短剧创作工作流类型定义
 *
 * 覆盖创作链：世界观→结构化脚本（阶段1）→ 九宫格分镜表（阶段2）→ 一键九宫格图（阶段3）。
 * 与 Scene（一镜一图执行单元）解耦，作为可反复打磨的创作态草稿。
 */

import type { HookType } from "@/types/series-bible";

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
  /**
   * 镜头语言字段（全部可选）：对齐手动小说解析路径（scenes 路由已支持落库）。
   * 制片人直转分镜时透传，让一键制片走 LLM 出图/视频 prompt 增强电影感。
   * LLM 漏填时缺省 —— 下游一律容错，缺省即回落无约束（零回归）。
   */
  /** 镜头角度（如"低角度仰拍""俯视"） */
  cameraAngle?: string;
  /** 光线（如"逆光""柔和侧光"） */
  lighting?: string;
  /** 构图（如"三分法""中心对称"） */
  composition?: string;
  /** 色调（如"冷蓝调""暖橙调"） */
  colorPalette?: string;
  /** 运动节拍：这一镜里"什么在动"（角色动作/表情/环境动态） */
  actionBeat?: string;
  /** 运镜（13 值枚举之一，与解析层 CAMERA_MOVEMENTS 对齐；非法值下游回落） */
  cameraMovement?: string;
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
  /**
   * 本集结尾钩子类型（爆款方法论，五分类）。
   * 可选：老数据 / LLM 漏填时为 undefined；与 series-bible HOOK_TYPES 同源，
   * 供史官（chronicler）直接读取沉淀到故事圣经。
   */
  hookType?: HookType;
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
