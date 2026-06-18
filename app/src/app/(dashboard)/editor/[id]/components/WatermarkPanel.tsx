"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, ImageIcon } from "lucide-react";
import type { Watermark } from "@/types/export-style";
import { uploadFileViaApi } from "@/lib/upload-client";

interface WatermarkPanelProps {
  /** 当前水印配置 */
  value: Watermark;
  /** 配置变更回调，始终传入新对象（不可变） */
  onChange: (w: Watermark) => void;
}

/** 位置选项 — 九宫格五点式 */
const POSITION_OPTIONS: Array<{
  value: Watermark["position"];
  /** 九宫格中的网格位置（row-col，1-indexed） */
  row: number;
  col: number;
  label: string;
}> = [
  { value: "tl", row: 1, col: 1, label: "左上" },
  { value: "tr", row: 1, col: 3, label: "右上" },
  { value: "center", row: 2, col: 2, label: "居中" },
  { value: "bl", row: 3, col: 1, label: "左下" },
  { value: "br", row: 3, col: 3, label: "右下" },
];

/** 将位置枚举转换为 CSS 定位用的 class（在预览框中） */
const POSITION_CLASS: Record<Watermark["position"], string> = {
  tl: "top-1 left-1",
  tr: "top-1 right-1",
  center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  bl: "bottom-1 left-1",
  br: "bottom-1 right-1",
};

/**
 * 水印（品牌 Logo）配置面板
 * 包含：启用开关、Logo 上传、位置九宫格、透明度、缩放比例、
 * 以及在画框中预览 Logo 角标位置。
 */
export function WatermarkPanel({ value, onChange }: WatermarkPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * 处理 Logo 文件上传。
   * 通过 uploadFileViaApi 上传（自动适配 R2 预签名直传 / 本地存储直传两种后端），
   * 成功后写入 imageUrl。fileType 用 "watermark" 走后端专用校验分支
   * （图片类型 + 2MB 限制 + 路径前缀）。
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploading(true);
    try {
      const fileUrl = await uploadFileViaApi({ file, fileType: "watermark" });

      // 写入 imageUrl 并自动开启水印（不可变更新）。
      // 用户既然上传了 Logo 即表达启用意图，自动 enabled 可避免
      // “开关开着但无图”或“传了图却忘开开关”这类无效中间态。
      onChange({ ...value, imageUrl: fileUrl, enabled: true });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传出错");
    } finally {
      setUploading(false);
      // 清空 input，允许重复选同一文件
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* 启用开关 */}
      <label className="flex cursor-pointer items-center justify-between">
        <span className="text-sm font-medium">启用品牌水印</span>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`focus:ring-primary relative h-5 w-9 rounded-full transition-colors focus:ring-2 focus:outline-none ${
            value.enabled ? "bg-primary" : "bg-secondary border-border border"
          }`}
        >
          <span
            className={`absolute top-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              value.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </label>

      {/* 开关关闭时折叠剩余内容 */}
      {value.enabled && (
        <div className="space-y-4">
          {/* Logo 上传区 */}
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              品牌 Logo
            </label>
            <div className="flex items-center gap-3">
              {/* 缩略图预览 */}
              <div className="bg-secondary border-border flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
                {value.imageUrl ? (
                  <img
                    src={value.imageUrl}
                    alt="水印 Logo"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <ImageIcon size={20} className="text-muted-foreground" />
                )}
              </div>

              {/* 上传按钮 */}
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-secondary hover:bg-secondary/80 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {uploading ? "上传中..." : "选择图片"}
                </button>
                <span className="text-muted-foreground text-xs">
                  支持 PNG / JPEG，建议透明背景 PNG
                </span>
              </div>
            </div>

            {/* 隐藏 file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              className="hidden"
            />

            {/* 上传错误提示 */}
            {uploadError && (
              <p className="mt-1 text-xs text-red-400">{uploadError}</p>
            )}
          </div>

          {/* 位置选择 — 九宫格（5 个活跃点） */}
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              显示位置
            </label>
            {/* 3×3 网格，仅 5 个角+中心有按钮，其余为空格 */}
            <div className="bg-secondary inline-grid grid-cols-3 gap-1 rounded-lg p-2">
              {([1, 2, 3] as const).map((row) =>
                ([1, 2, 3] as const).map((col) => {
                  const opt = POSITION_OPTIONS.find(
                    (o) => o.row === row && o.col === col
                  );
                  if (!opt) {
                    // 空格占位（保持九宫格结构）
                    return <div key={`${row}-${col}`} className="h-8 w-8" />;
                  }
                  const active = value.position === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      title={opt.label}
                      onClick={() =>
                        onChange({ ...value, position: opt.value })
                      }
                      className={`h-8 w-8 rounded-md text-xs font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-border text-muted-foreground"
                      }`}
                    >
                      {opt.label.slice(0, 1)}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 透明度滑块 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-muted-foreground text-sm">透明度</label>
              <span className="text-sm">
                {Math.round(value.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value.opacity}
              onChange={(e) =>
                onChange({ ...value, opacity: Number(e.target.value) })
              }
              className="accent-primary w-full"
            />
          </div>

          {/* 缩放比例滑块 */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-muted-foreground text-sm">
                大小（相对视频宽度）
              </label>
              <span className="text-sm">{Math.round(value.scale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={0.3}
              step={0.01}
              value={value.scale}
              onChange={(e) =>
                onChange({ ...value, scale: Number(e.target.value) })
              }
              className="accent-primary w-full"
            />
          </div>

          {/* 位置预览画框 */}
          <div>
            <p className="text-muted-foreground mb-1 text-sm">位置预览</p>
            <div className="bg-secondary border-border relative h-24 w-full overflow-hidden rounded-lg border">
              {/* 模拟视频画面（对角线虚边框） */}
              <div className="absolute inset-0 opacity-20">
                <div className="h-full w-full rounded border-2 border-dashed border-current" />
              </div>

              {/* Logo 角标 */}
              <div
                className={`absolute ${POSITION_CLASS[value.position]}`}
                style={{ opacity: value.opacity }}
              >
                {value.imageUrl ? (
                  <img
                    src={value.imageUrl}
                    alt="水印预览"
                    className="rounded"
                    style={{
                      /* 按 scale 折算到预览框（预览框宽约 200px，故 × 2 放大） */
                      width: Math.round(value.scale * 200 * 2),
                      maxWidth: 60,
                    }}
                  />
                ) : (
                  /* 无 Logo 时显示占位方块 */
                  <div
                    className="bg-primary/60 rounded"
                    style={{
                      width: Math.round(value.scale * 200 * 2),
                      height: Math.round(value.scale * 200 * 2),
                      maxWidth: 36,
                      maxHeight: 36,
                    }}
                  />
                )}
              </div>
            </div>
            <p className="text-muted-foreground text-[10px]">
              * 导出效果以最终视频为准
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
