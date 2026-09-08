"use client";

import type { ScenePreview } from "@/types";
import type { SceneEffectId } from "@/types/export-style";
import { sceneFilterCss } from "../scene-filters";

export interface MediaLayerItem {
  scene: ScenePreview;
  role: "current" | "next";
  effect: SceneEffectId | null;
}

interface MediaLayersProps {
  layers: MediaLayerItem[];
  /** 全片 LUT 的近似 CSS filter（与分镜滤镜串接共存），未启用为 null */
  lutCssFilter: string | null;
  /** 当前镜的运镜 + 震屏 animation 简写（仅作用于当前镜媒体元素本体） */
  curMediaAnimation: string | undefined;
  isPlaying: boolean;
  /** 是否预热下一镜（临近转场时把 preload 升到 auto） */
  shouldPreheatNext: boolean;
  transitionT: number;
  /** 当前镜（上层）的转场叠化样式 */
  transitionLayerStyle: () => React.CSSProperties;
  getVideoRefCb: (sceneId: string) => (el: HTMLVideoElement | null) => void;
  handleLoadedMetadata: (sceneId: string, el: HTMLVideoElement | null) => void;
}

/**
 * 双层媒体从「单一 keyed 数组」渲染（key=scene.id）——
 * currentIndex 前进时，原「下一镜」层的 DOM 节点被 React 依 key 复用
 * 为「当前镜」，同一 <video> 播放不中断（消除切镜 remount 的黑屏/卡顿）。
 * 栈序用显式 zIndex（当前镜在上，下一镜在下）而非 DOM 顺序——因为
 * keyed 复用会打乱 DOM 顺序，只有 zIndex 能稳定控制叠放。
 * - 下一镜层：仅转场中（transitionT>0）可见，否则透明且不吃指针（保留预取）；
 * - 当前镜层：套 transitionLayerStyle() 做叠化（fade/slide/wipe）。
 *
 * 本组件不含任何 hook：纯展示 + 事件透传，故不影响 PreviewPlayer 的 effect 顺序。
 */
export function MediaLayers({
  layers,
  lutCssFilter,
  curMediaAnimation,
  isPlaying,
  shouldPreheatNext,
  transitionT,
  transitionLayerStyle,
  getVideoRefCb,
  handleLoadedMetadata,
}: MediaLayersProps) {
  /**
   * 渲染一镜的媒体（video / image / 占位），应用其滤镜。
   * video 用「按 sceneId 记忆的稳定 ref 回调」把 DOM 节点登记进 videoElsRef，
   * 供 muted 命令式管理与播放控制；不再用 muted JSX 属性
   * （已挂载 <video> 的 muted 属性更新不可靠，角色互换后会失灵）。
   *
   * preload 策略（带宽敏感，2026-07-08）：
   * 服务器出口带宽有限（~650KB/s）而分镜视频常达 9MB+，若两层都 preload=auto，
   * 当前镜与下一镜会同时全量下载互抢带宽 → 当前镜卡顿。改为：
   *   - 当前镜：preload=auto（积极加载，优先保证正在看的这镜流畅）；
   *   - 下一镜：仅在「临近转场」（shouldPreheatNext）时升级 auto 预热，
   *     其余时间用 metadata（只拉几十 KB 头信息，不占带宽）。
   * 这样切镜预热窗口很短、不与当前镜长期争抢，黑屏空档仍被覆盖。
   */
  const renderMedia = (
    scene: ScenePreview,
    effect: SceneEffectId | null,
    role: "current" | "next"
  ) => {
    // 分镜滤镜（SVG filter 引用）与全片 LUT（CSS filter 近似）串接共存：
    // CSS 的 filter 属性支持多值空格拼接，两者会依次作用于同一元素。
    const sceneFilter = sceneFilterCss(effect);
    const filterCss = [sceneFilter, lutCssFilter].filter(Boolean).join(" ");
    // 冲击/运镜动画只作用于「当前镜」的媒体元素本体（批4）：
    // 挂在内层而非层容器上，避免与转场 slide/wipe 的容器 transform 相互覆盖。
    const mediaAnimation =
      role === "current" && isPlaying ? curMediaAnimation : undefined;
    if (scene.videoUrl) {
      // 下一镜默认 metadata（省带宽），仅在临近转场预热窗口内才 auto；
      // 当前镜恒 auto。
      const preload =
        role === "current" || shouldPreheatNext ? "auto" : "metadata";
      return (
        <video
          ref={getVideoRefCb(scene.id)}
          src={scene.videoUrl}
          // object-contain 精确复刻导出端 scale(decrease)+pad(black)：图片比例≠成片比例时
          // 完整缩入并补黑边，预览构图=成片构图（黑边由画面框黑底承接）。
          className="h-full w-full object-contain"
          style={{ filter: filterCss, animation: mediaAnimation }}
          loop
          playsInline
          preload={preload}
          onLoadedMetadata={(e) =>
            handleLoadedMetadata(scene.id, e.currentTarget)
          }
        />
      );
    }
    if (scene.imageUrl) {
      return (
        <img
          src={scene.imageUrl}
          alt=""
          className="h-full w-full object-contain"
          style={{ filter: filterCss, animation: mediaAnimation }}
        />
      );
    }
    return <div className="text-muted-foreground">无内容</div>;
  };

  return (
    <>
      {layers.map(({ scene, role, effect }) => {
        const isCurrent = role === "current";
        const layerStyle: React.CSSProperties = isCurrent
          ? {
              zIndex: 2,
              // 短 opacity 过渡平滑 JS 30ms 步进的叠化（仅 opacity，不含
              // transform/clipPath，避免 slide/wipe 与 JS 进度相互拖拽）。
              transition: "opacity 50ms linear",
              ...transitionLayerStyle(),
            }
          : {
              zIndex: 1,
              opacity: transitionT > 0 ? 1 : 0,
              pointerEvents: "none",
            };
        return (
          <div
            key={scene.id}
            className="absolute inset-0 flex items-center justify-center"
            style={layerStyle}
          >
            {renderMedia(scene, effect, role)}
          </div>
        );
      })}
    </>
  );
}
