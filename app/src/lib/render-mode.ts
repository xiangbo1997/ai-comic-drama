/**
 * 混合出片成本路由（render-mode）—— 判定每一镜「值得花钱生成视频」还是「图片运镜即可」。
 *
 * 业内 AI 漫剧主力成本模型是「~80% 镜头走动态漫（静态图 + zoompan 运镜）+ ~20% 高动态
 * 镜头走图生视频」，成本约为纯图生视频路线的 1/2~1/3。本模块把「哪些镜该花钱」做成
 * 一个纯函数单一真源：编辑器批量入口、workflow 一键管线、导出/预览默认运镜三处共用，
 * 避免判据在多处漂移。
 *
 * 依赖纪律：本文件位于 lib，只依赖 types（SceneMotion / CameraMovement 枚举），
 * 严禁反向依赖 services / components / app。所有函数为纯函数，无副作用、不 mutate 入参。
 */

import { CAMERA_MOVEMENTS } from "@/lib/prompts/video-prompt";
import type { SceneMotion } from "@/types/export-style";

/**
 * 单镜渲染模式：
 *   - "video"  值得花钱走图生视频（高动态/冲击/高潮镜）
 *   - "motion" 图片 + Ken Burns zoompan 运镜即可承载（零视频成本）
 */
export type RenderMode = "video" | "motion";

/**
 * recommendRenderMode 读取的最小场景字段（DB Scene 与客户端 Scene 的公共子集）。
 * 全部可选：老数据 / 解析层漏填时字段缺省，判据一律容错回落 "motion"（省钱侧）。
 */
export interface RenderModeSceneInput {
  /** 节拍类型：impact(打击)/reveal(揭秘)/emotional(情绪)/calm(平静)——解析层克制标注 */
  beatType?: string | null;
  /** 高潮镜标记（每集 1-2 镜） */
  isClimax?: boolean | null;
  /** 运镜（13 值枚举之一，与 CAMERA_MOVEMENTS 对齐） */
  cameraMovement?: string | null;
}

/**
 * zoompan（Ken Burns 静态图运镜）能表达的运镜白名单。
 *
 * 划分依据：zoompan 只能对单张静态图做「缩放 + 平移」采样，无法制造视差 / 主体独立运动。
 *   - static：不动（或仅头发/衣料等图内微动）——图片本身即成立
 *   - zoom_in / zoom_out：缩放，zoompan 的 z 表达式直接对应
 *   - pan_left / pan_right：横向平移，zoompan 的 x 表达式直接对应
 *   - tilt_up / tilt_down：纵向平移，zoompan 的 y 亦可近似（虽无 SceneMotion 精确映射，
 *     但属「无视差的镜头位移」，动态漫可接受，不值得为其单独花钱生成视频）
 *
 * 其余运镜（dolly_in/dolly_out/orbit/tracking/handheld/crane）都依赖视差或主体独立
 * 运动，zoompan 无法表达 → 归 "video"。
 */
const ZOOMPAN_EXPRESSIBLE_MOVEMENTS = new Set<string>([
  "static",
  "zoom_in",
  "zoom_out",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
]);

/** 触发「值得花钱生成视频」的节拍类型（解析层全片各 ≤3 镜，克制标注） */
const VIDEO_WORTHY_BEATS = new Set<string>(["impact", "reveal"]);

/**
 * 判定单镜推荐渲染模式。
 *
 * 命中以下任一 → "video"：
 *   ① beatType ∈ {impact, reveal}（打击 / 揭秘，视觉冲击强）；
 *   ② isClimax（高潮镜，每集 1-2 镜，值得堆料）；
 *   ③ cameraMovement 属于 zoompan 无法表达的复杂运镜（dolly/orbit/tracking/handheld/crane）。
 * 其余 → "motion"（图片运镜承载，零视频成本）。
 *
 * 取舍说明：actionBeat（镜内动作描述）**不作为**独立触发条件。解析层几乎每镜都会填
 * actionBeat（「什么在动」），若作触发条件会让几乎所有镜都判 video，hybrid 就失去省钱
 * 意义。真正的「高动态」信号收敛到上面三项克制标注上。
 *
 * 未知 cameraMovement（非 13 值枚举）按「无法确定是复杂运镜」处理——不因它单独判 video，
 * 交给 ①② 兜底，保守偏 motion（省钱侧）。
 */
export function recommendRenderMode(scene: RenderModeSceneInput): RenderMode {
  const beat = scene.beatType ?? "";
  if (VIDEO_WORTHY_BEATS.has(beat)) return "video";

  if (scene.isClimax === true) return "video";

  const movement = scene.cameraMovement ?? "";
  // 仅当运镜是「合法枚举值」且「不在 zoompan 白名单内」时才判 video；
  // 非法/空值不因运镜触发（避免脏数据误判），落到 motion。
  if (
    movement &&
    (CAMERA_MOVEMENTS as readonly string[]).includes(movement) &&
    !ZOOMPAN_EXPRESSIBLE_MOVEMENTS.has(movement)
  ) {
    return "video";
  }

  return "motion";
}

/** 运镜枚举值 → Ken Burns SceneMotion 的精确映射（仅 4 个有一一对应关系） */
const MOVEMENT_TO_MOTION: Record<string, SceneMotion> = {
  zoom_in: "zoomIn",
  zoom_out: "zoomOut",
  pan_left: "panLeft",
  pan_right: "panRight",
};

/**
 * 把导演运镜（cameraMovement）解析成图片分镜的默认 Ken Burns 运镜。
 *
 * 仅 zoom_in / zoom_out / pan_left / pan_right 有精确的 SceneMotion 对应；其余运镜
 * （static / tilt_* / dolly_* / orbit / tracking / handheld / crane，含空值 / 非法值）
 * 无对应 → 返回 null，由调用方回落到既有的 zoomIn 兜底（保持零回归）。
 */
export function resolveDefaultMotion(
  cameraMovement?: string | null
): SceneMotion | null {
  if (!cameraMovement) return null;
  return MOVEMENT_TO_MOTION[cameraMovement] ?? null;
}

/** summarizeRenderPlan 的产出：混合策略下的视频/运镜镜数与视频镜 id 列表 */
export interface RenderPlanSummary {
  /** 推荐走图生视频的镜数 */
  videoCount: number;
  /** 推荐走图片运镜（零成本）的镜数 */
  motionCount: number;
  /** 推荐走视频的镜 id 列表（供批量入口精确筛选目标） */
  videoSceneIds: string[];
}

/**
 * 汇总一组分镜的混合出片计划。
 *
 * 供批量入口的确认摘要（「将为 X/Y 镜生成视频，其余 N 镜走图片运镜」）与筛选目标共用。
 * 纯统计，不 mutate 入参。
 */
export function summarizeRenderPlan(
  scenes: Array<RenderModeSceneInput & { id: string }>
): RenderPlanSummary {
  const videoSceneIds: string[] = [];
  let motionCount = 0;
  for (const scene of scenes) {
    if (recommendRenderMode(scene) === "video") {
      videoSceneIds.push(scene.id);
    } else {
      motionCount += 1;
    }
  }
  return {
    videoCount: videoSceneIds.length,
    motionCount,
    videoSceneIds,
  };
}
