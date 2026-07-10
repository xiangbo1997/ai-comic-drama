"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * 单分镜视频查看弹窗（轻量）。
 *
 * 用原生 <video controls> 播放某个分镜的视频——单分镜查看无需复刻 preview-player
 * 的转场/字幕/双层媒体等整片编排逻辑，浏览器原生控件即够用。
 * 仅在传入 videoUrl 时打开。
 */
export function SceneVideoDialog({
  open,
  videoUrl,
  title,
  aspectRatio,
  onClose,
}: {
  open: boolean;
  videoUrl: string | null;
  /** 弹窗标题，如"分镜 #3 视频" */
  title: string;
  /** 画面比例（如 "9:16"），决定弹窗内视频框比例 */
  aspectRatio: string;
  onClose: () => void;
}) {
  const aspectClass =
    aspectRatio === "9:16"
      ? "aspect-[9/16] h-[70vh]"
      : aspectRatio === "16:9"
        ? "aspect-video w-full"
        : "aspect-square w-full";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="bg-background flex max-h-[90vh] max-w-3xl flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            播放该分镜生成的视频
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-1 items-center justify-center overflow-hidden bg-black p-4">
          {videoUrl ? (
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              autoPlay
              playsInline
              className={`${aspectClass} bg-black object-contain`}
            />
          ) : (
            <p className="text-muted-foreground text-sm">该分镜暂无视频</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
