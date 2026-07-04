import type { ProjectDetail } from "@/types";
import { SubtitleStyleDialog } from "./SubtitleStyleDialog";
import { WatermarkDialog } from "./WatermarkDialog";
import { StickerDialog } from "./StickerDialog";
import { TransitionDialog } from "./TransitionDialog";
import { SceneEffectDialog } from "./SceneEffectDialog";
import { BgmDialog } from "./BgmDialog";

interface TimelineDialogsProps {
  project: ProjectDetail;
  projectId: string;
  updateProject: (data: Partial<ProjectDetail>) => void;
  onTranscribe: () => Promise<string>;
  showSubtitleStyleDialog: boolean;
  showWatermarkDialog: boolean;
  showBgmDialog: boolean;
  showStickerDialog: boolean;
  showTransitionDialog: boolean;
  showEffectDialog: boolean;
  onCloseSubtitleStyle: () => void;
  onCloseWatermark: () => void;
  onCloseBgm: () => void;
  onCloseSticker: () => void;
  onCloseTransition: () => void;
  onCloseEffect: () => void;
}

/**
 * 时间轴触发的六个「全片/分镜级」配置弹窗（字幕样式 / 水印 / 配乐 / 贴图 /
 * 转场 / 滤镜变速）。均按 generationParams 的标准落库写法 upsert，逻辑与原
 * 页面内联时完全一致——仅把 JSX 从 page.tsx 平移出来。
 */
export function TimelineDialogs({
  project,
  projectId,
  updateProject,
  onTranscribe,
  showSubtitleStyleDialog,
  showWatermarkDialog,
  showBgmDialog,
  showStickerDialog,
  showTransitionDialog,
  showEffectDialog,
  onCloseSubtitleStyle,
  onCloseWatermark,
  onCloseBgm,
  onCloseSticker,
  onCloseTransition,
  onCloseEffect,
}: TimelineDialogsProps) {
  return (
    <>
      {/* 字幕样式弹窗（点击时间轴字幕轨触发，全片统一样式） */}
      {showSubtitleStyleDialog && (
        <SubtitleStyleDialog
          initialValue={project.generationParams?.subtitleStyle}
          onSave={(style) =>
            updateProject({
              generationParams: {
                ...project.generationParams,
                subtitleStyle: style,
              },
            })
          }
          onTranscribe={onTranscribe}
          onClose={onCloseSubtitleStyle}
        />
      )}

      {/* 品牌水印弹窗（点击时间轴品牌水印入口触发，全片统一） */}
      {showWatermarkDialog && (
        <WatermarkDialog
          initialValue={project.generationParams?.watermark}
          onSave={(watermark) =>
            updateProject({
              generationParams: {
                ...project.generationParams,
                watermark,
              },
            })
          }
          onClose={onCloseWatermark}
        />
      )}

      {showBgmDialog && (
        <BgmDialog
          projectId={projectId}
          initialValue={project.generationParams?.backgroundMusic}
          onSave={(backgroundMusic) =>
            updateProject({
              generationParams: {
                ...project.generationParams,
                backgroundMusic,
              },
            })
          }
          onClose={onCloseBgm}
        />
      )}

      {/* 贴图管理弹窗（点击时间轴 + 贴图 入口触发） */}
      {showStickerDialog && (
        <StickerDialog
          initialStickers={project.generationParams?.stickers}
          scenes={project.scenes.map((s) => ({
            id: s.id,
            order: s.order,
            description: s.description,
          }))}
          onSave={(stickers) =>
            updateProject({
              generationParams: {
                ...project.generationParams,
                stickers,
              },
            })
          }
          onClose={onCloseSticker}
        />
      )}

      {/* 转场设置弹窗（点击时间轴转场入口触发，分镜之间逐个配置） */}
      {showTransitionDialog && (
        <TransitionDialog
          initialTransitions={project.generationParams?.transitions}
          scenes={project.scenes.map((s) => ({
            id: s.id,
            order: s.order,
            description: s.description,
          }))}
          onSave={(transitions) =>
            updateProject({
              generationParams: {
                ...project.generationParams,
                transitions,
              },
            })
          }
          onClose={onCloseTransition}
        />
      )}

      {/* 滤镜 / 变速弹窗（点击时间轴滤镜入口触发，按分镜配置） */}
      {showEffectDialog && (
        <SceneEffectDialog
          initialEffects={project.generationParams?.sceneEffects}
          scenes={project.scenes.map((s) => ({
            id: s.id,
            order: s.order,
            description: s.description,
          }))}
          onSave={(sceneEffects) =>
            updateProject({
              generationParams: {
                ...project.generationParams,
                sceneEffects,
              },
            })
          }
          onClose={onCloseEffect}
        />
      )}
    </>
  );
}
