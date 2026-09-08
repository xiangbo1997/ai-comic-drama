/**
 * 导出弹窗共享类型（结构拆分，字段与拆分前完全一致）。
 *
 * ExportDialog.tsx 仍原样再导出 CoverSourceCandidate / ExportDialogOptions，
 * 既有 import 路径不变。
 */

import type { SubtitleStyle, Watermark } from "@/types/export-style";
import type { ColorGrade } from "@/lib/color-grade";
import type { TitleCardsConfig } from "@/lib/title-cards";

export interface ExportStatus {
  isExporting: boolean;
  taskId: string | null;
  progress: number;
  error: string | null;
  videoUrl?: string | null;
}

/** 封面底图候选项（导出弹窗封面区块的底图下拉，白名单来源单一真源） */
export interface CoverSourceCandidate {
  /** 底图 URL（本项目分镜图 / 关联角色定妆图） */
  url: string;
  /** 展示标签（如「镜 3」「角色·林墨」） */
  label: string;
}

/** 导出选项（含批6 成片包装：字幕字体已并入 subtitleStyle.fontFamily） */
export interface ExportDialogOptions {
  format: string;
  quality: string;
  includeSubtitles: boolean;
  includeAudio: boolean;
  subtitleStyle: SubtitleStyle;
  watermark: Watermark;
  /** 全片 LUT 调色（body 覆盖，与 subtitleStyle 同优先级） */
  colorGrade: ColorGrade;
  /** 片头标题卡开关（body 覆盖 generationParams.titleCards.title） */
  titleCard: boolean;
  /** 片尾钩子卡开关（body 覆盖 generationParams.titleCards.end） */
  endCard: boolean;
}

/**
 * 成片包装配置变更时持久化到 generationParams（片头尾卡 / 调色 / 字幕字体），
 * 让主编辑器预览同步反映（预览=成片）。上层用 editor.updateProject 落库。
 */
export type ExportPersistHandler = (patch: {
  titleCards?: TitleCardsConfig;
  colorGrade?: ColorGrade;
  subtitleStyle?: SubtitleStyle;
}) => void;

export interface ExportDialogProps {
  isOpen: boolean;
  exportStatus: ExportStatus;
  /** 项目 ID，用于拉取审片报告 */
  projectId: string;
  onExport: (options: ExportDialogOptions) => void;
  onClose: () => void;
  onRetry: () => void;
  /** 审片报告建议条目「定位」→ 选中该分镜并关闭弹窗 */
  onJumpToScene: (sceneId: string) => void;
  /** 时间轴入口已配置的字幕样式，作为导出表单初值（保持三处一致） */
  initialSubtitleStyle?: SubtitleStyle;
  /** 时间轴入口已配置的品牌水印，作为导出表单初值（保持三处一致） */
  initialWatermark?: Watermark;
  /** 已存的全片调色配置（generationParams.colorGrade），作为初值 */
  initialColorGrade?: ColorGrade;
  /** 已存的片头/片尾卡开关（generationParams.titleCards），作为初值 */
  initialTitleCards?: TitleCardsConfig;
  /** 是否系列项目（决定片头/片尾卡缺省开关；与导出端契约一致） */
  isSeries: boolean;
  /**
   * 成片包装配置变更时持久化到 generationParams（片头尾卡 / 调色 / 字幕字体），
   * 让主编辑器预览同步反映（预览=成片）。上层用 editor.updateProject 落库。
   */
  onPersist: ExportPersistHandler;
  /** 封面底图候选（分镜图 + 角色定妆图，白名单来源） */
  coverSourceCandidates: CoverSourceCandidate[];
  /** 封面标题缺省值（项目名） */
  coverDefaultTitle: string;
  /** 封面副题缺省值（系列集数「第 N 集」，非系列为空串） */
  coverDefaultSubtitle: string;
  /** 已合成的封面 URL（null=未生成），作为封面预览初值 */
  coverImageUrl?: string | null;
}

/** ExportForm 的 props（拆分前为内联字面量类型，字段逐一保持一致） */
export interface ExportFormProps {
  onExport: (options: ExportDialogOptions) => void;
  onCancel: () => void;
  initialSubtitleStyle?: SubtitleStyle;
  initialWatermark?: Watermark;
  initialColorGrade?: ColorGrade;
  initialTitleCards?: TitleCardsConfig;
  isSeries: boolean;
  onPersist: ExportPersistHandler;
  projectId: string;
  coverSourceCandidates: CoverSourceCandidate[];
  coverDefaultTitle: string;
  coverDefaultSubtitle: string;
  coverImageUrl?: string | null;
}
