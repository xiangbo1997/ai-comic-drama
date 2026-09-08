"use client";

import { Loader2, Download, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ReviewReportSection } from "./export-dialog/ReviewReportSection";
import { ExportForm } from "./export-dialog/ExportForm";
import type { ExportDialogProps } from "./export-dialog/types";

// 子组件与类型已拆分到 export-dialog/ 目录（纯结构拆分，行为不变）；
// 此处原样再导出，既有 import 路径（"./ExportDialog"）不变。
export type {
  CoverSourceCandidate,
  ExportDialogOptions,
} from "./export-dialog/types";

export function ExportDialog({
  isOpen,
  exportStatus,
  projectId,
  onExport,
  onClose,
  onRetry,
  onJumpToScene,
  initialSubtitleStyle,
  initialWatermark,
  initialColorGrade,
  initialTitleCards,
  isSeries,
  onPersist,
  coverSourceCandidates,
  coverDefaultTitle,
  coverDefaultSubtitle,
  coverImageUrl,
}: ExportDialogProps) {
  // 下载视频：视频在 R2 跨域，前端直接 fetch 被 CORS 拦（Failed to fetch），
  // <a download> 对跨域资源也无效（变新标签打开）。改走同源下载代理
  // /api/download——服务端拉取（无浏览器跨域限制）+ Content-Disposition: attachment
  // 头，浏览器直接触发下载。<a> 导航不受 CORS 约束，失败由浏览器自身提示。
  const handleDownload = (url: string) => {
    const a = document.createElement("a");
    a.href = `/api/download?url=${encodeURIComponent(url)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* 弹窗主体 — 限高可滚动 */}
      <DialogContent className="flex max-h-[90vh] flex-col p-0">
        {/* 标题栏 */}
        <DialogHeader className="border-border shrink-0 border-b p-6 pb-4 text-left">
          <DialogTitle className="text-xl">导出视频</DialogTitle>
          <DialogDescription className="sr-only">
            配置导出格式、分辨率与字幕水印，生成最终视频
          </DialogDescription>
        </DialogHeader>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6 pt-4">
          {exportStatus.isExporting ? (
            <div className="py-8 text-center">
              <Loader2
                size={40}
                className="text-primary mx-auto mb-4 animate-spin"
              />
              <p className="mb-2 text-lg">正在导出...</p>
              <div className="bg-secondary mb-2 h-2 w-full rounded-full">
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${exportStatus.progress}%` }}
                />
              </div>
              <p className="text-muted-foreground text-sm">
                {exportStatus.progress}%
              </p>
            </div>
          ) : exportStatus.error ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-red-400">{exportStatus.error}</p>
              <button
                onClick={onRetry}
                className="bg-secondary hover:bg-secondary/80 rounded-lg px-4 py-2"
              >
                重试
              </button>
            </div>
          ) : exportStatus.videoUrl ? (
            <div className="py-8 text-center">
              <CheckCircle2 size={40} className="text-primary mx-auto mb-4" />
              <p className="mb-4 text-lg">导出完成</p>
              <button
                onClick={() => handleDownload(exportStatus.videoUrl!)}
                className="bg-primary hover:bg-primary/90 mx-auto flex w-fit items-center gap-2 rounded-lg px-4 py-2 text-sm"
              >
                <Download size={16} />
                下载视频
              </button>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground mt-3 text-sm"
              >
                关闭
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 审片报告（导出动作之上）：先体检再导出 */}
              <ReviewReportSection
                projectId={projectId}
                onJumpToScene={onJumpToScene}
                onClose={onClose}
              />
              <ExportForm
                onExport={onExport}
                onCancel={onClose}
                initialSubtitleStyle={initialSubtitleStyle}
                initialWatermark={initialWatermark}
                initialColorGrade={initialColorGrade}
                initialTitleCards={initialTitleCards}
                isSeries={isSeries}
                onPersist={onPersist}
                projectId={projectId}
                coverSourceCandidates={coverSourceCandidates}
                coverDefaultTitle={coverDefaultTitle}
                coverDefaultSubtitle={coverDefaultSubtitle}
                coverImageUrl={coverImageUrl}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
