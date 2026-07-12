"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Coins, Loader2, Wand2, Upload, X, Grid2x2 } from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import type { CharacterListItem } from "@/types";
import type { GenerateOptions } from "./constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/** 上传参考图大小上限：过大 base64 会撑爆请求体导致模糊失败 */
const MAX_UPLOAD_MB = 10;
const THREE_VIEWS_COST = 9;

async function fetchCredits(): Promise<{ credits: number }> {
  const res = await fetch("/api/user/credits");
  if (!res.ok) throw new Error("获取积分失败");
  return res.json();
}

interface GenerateReferenceModalProps {
  characterId: string;
  characters: CharacterListItem[];
  generateOptions: GenerateOptions;
  onOptionsChange: (options: GenerateOptions) => void;
  currentImageIndex: number;
  onClose: () => void;
  onGenerate: () => void;
  generatePending: boolean;
  /** 一键三视图（正/侧/背，防崩坏），由父组件注入 mutation */
  onGenerateThreeViews?: () => void;
  threeViewsPending?: boolean;
}

export function GenerateReferenceModal({
  characterId,
  characters,
  generateOptions,
  onOptionsChange,
  currentImageIndex,
  onClose,
  onGenerate,
  generatePending,
  onGenerateThreeViews,
  threeViewsPending,
}: GenerateReferenceModalProps) {
  const character = characters.find((c) => c.id === characterId);
  const hasImages = (character?.referenceImages?.length ?? 0) > 0;
  const [readingImage, setReadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 余额前置：此前只标单次消耗不显余额，用户连续生成到没钱才撞
  // "积分不足"报错（ux-config P1-5）。与积分页共享 ["credits"] 缓存。
  const { data: creditsData } = useQuery({
    queryKey: ["credits"],
    queryFn: fetchCredits,
    staleTime: 30000,
  });
  const balance = creditsData?.credits;
  const cost = generateOptions.source === "none" ? 3 : 5;
  const insufficient = typeof balance === "number" && balance < cost;
  const threeViewsInsufficient =
    typeof balance === "number" && balance < THREE_VIEWS_COST;

  const handleImageUpload = (file: File) => {
    setUploadError(null);
    // 前置大小校验 + 读取 loading：大图读 base64 期间界面此前无任何反馈
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`图片超过 ${MAX_UPLOAD_MB}MB，请压缩后再上传`);
      return;
    }
    setReadingImage(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      onOptionsChange({ ...generateOptions, uploadedImage: base64 });
      setReadingImage(false);
    };
    reader.onerror = () => {
      setReadingImage(false);
      setUploadError("图片读取失败，请重试");
    };
    reader.readAsDataURL(file);
  };

  // 组件仅在父级为真时挂载，故恒为打开；关闭统一走 onClose。
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-md flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b p-4 text-left">
          <DialogTitle>生成参考图</DialogTitle>
          <DialogDescription className="sr-only">
            选择图片供应商与参考来源，为角色生成参考图
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* 余额前置显示：把"积分不足"拦在点击前 */}
          <div className="bg-secondary/50 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Coins size={14} className="text-yellow-400" />
              当前积分
            </span>
            <span
              className={
                insufficient
                  ? "text-destructive font-medium"
                  : "text-foreground font-medium"
              }
            >
              {balance ?? "—"}
              <span className="text-muted-foreground font-normal">
                {" "}
                / 本次消耗 {cost}
              </span>
            </span>
          </div>
          {insufficient && (
            <p className="text-destructive -mt-2 text-xs">
              积分不足以本次生成，
              <Link href="/credits" className="text-primary hover:underline">
                去充值 →
              </Link>
            </p>
          )}
          <div className="space-y-2">
            <label className="text-muted-foreground text-sm">图片供应商</label>
            <div className="flex items-center gap-2">
              <ModelSelector
                category="IMAGE"
                value={generateOptions.imageConfigId}
                onChange={(configId) =>
                  onOptionsChange({
                    ...generateOptions,
                    imageConfigId: configId,
                  })
                }
                size="sm"
                disabled={generatePending}
              />
              <span className="text-muted-foreground text-xs">
                选择已测试成功的图像配置
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-muted-foreground text-sm">图片来源</label>
            <div className="space-y-2">
              <label className="bg-secondary/50 hover:bg-secondary flex cursor-pointer items-center gap-3 rounded-lg p-3">
                <input
                  type="radio"
                  name="source"
                  checked={generateOptions.source === "none"}
                  onChange={() =>
                    onOptionsChange({
                      ...generateOptions,
                      source: "none",
                      uploadedImage: null,
                    })
                  }
                  className="text-primary h-4 w-4"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    无参考图（纯 AI 生成）
                  </div>
                  <div className="text-muted-foreground text-xs">
                    消耗 3 积分
                  </div>
                </div>
              </label>

              <label className="bg-secondary/50 hover:bg-secondary flex cursor-pointer items-center gap-3 rounded-lg p-3">
                <input
                  type="radio"
                  name="source"
                  checked={generateOptions.source === "upload"}
                  onChange={() =>
                    onOptionsChange({ ...generateOptions, source: "upload" })
                  }
                  className="text-primary h-4 w-4"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">上传新图片作为参考</div>
                  <div className="text-muted-foreground text-xs">
                    消耗 5 积分
                  </div>
                </div>
              </label>

              {hasImages && (
                <label className="bg-secondary/50 hover:bg-secondary flex cursor-pointer items-center gap-3 rounded-lg p-3">
                  <input
                    type="radio"
                    name="source"
                    checked={generateOptions.source === "existing"}
                    onChange={() =>
                      onOptionsChange({
                        ...generateOptions,
                        source: "existing",
                        uploadedImage: null,
                      })
                    }
                    className="text-primary h-4 w-4"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      使用当前图片作为参考
                    </div>
                    <div className="text-muted-foreground text-xs">
                      消耗 5 积分 · 基于当前显示的图片优化
                    </div>
                  </div>
                </label>
              )}
            </div>
          </div>

          {generateOptions.source === "upload" && (
            <div className="space-y-2">
              <label className="text-muted-foreground text-sm">
                上传参考图
              </label>
              {generateOptions.uploadedImage ? (
                <div className="relative">
                  <img
                    src={generateOptions.uploadedImage}
                    alt="参考图预览"
                    className="h-40 w-full rounded-lg object-cover"
                  />
                  <button
                    onClick={() =>
                      onOptionsChange({
                        ...generateOptions,
                        uploadedImage: null,
                      })
                    }
                    className="absolute top-2 right-2 rounded bg-black/50 p-1 hover:bg-red-600"
                    aria-label="移除已上传的参考图"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="border-border hover:border-border flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed">
                  {readingImage ? (
                    <>
                      <Loader2
                        size={24}
                        className="text-muted-foreground mb-2 animate-spin"
                      />
                      <span className="text-muted-foreground text-sm">
                        读取图片中...
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload
                        size={24}
                        className="text-muted-foreground mb-2"
                      />
                      <span className="text-muted-foreground text-sm">
                        点击上传图片（不超过 {MAX_UPLOAD_MB}MB）
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={readingImage}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              {uploadError && (
                <p className="text-destructive text-xs">{uploadError}</p>
              )}
            </div>
          )}

          {generateOptions.source === "existing" && character && (
            <div className="space-y-2">
              <label className="text-muted-foreground text-sm">
                当前选中的图片
              </label>
              <div className="relative">
                <img
                  src={character.referenceImages[currentImageIndex]}
                  alt="当前图片"
                  className="h-40 w-full rounded-lg object-cover"
                />
                <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs">
                  第 {currentImageIndex + 1} 张
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-muted-foreground text-sm">
              自定义提示词（可选）
            </label>
            <textarea
              value={generateOptions.customPrompt}
              onChange={(e) =>
                onOptionsChange({
                  ...generateOptions,
                  customPrompt: e.target.value,
                })
              }
              placeholder="输入额外的描述，如：修改发型为短发、换个表情..."
              className="border-border bg-secondary w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              提示：将与角色基础信息合并生成
            </p>

            {/* 智能引导：已有定妆照 + 填了提示词 + 却选纯 AI 生成时，
                提示改用「当前图片作为参考」，让提示词基于原图改而非重画 */}
            {hasImages &&
              generateOptions.source === "none" &&
              generateOptions.customPrompt.trim() && (
                <div className="border-agent/40 bg-agent/10 space-y-1.5 rounded-lg border p-2.5">
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    你已有定妆照并填写了提示词。当前是「纯 AI 生成」，模型会
                    <b>忽略现有图片重新画</b>
                    ，效果可能偏差较大。建议改用「使用当前图片作为参考」，让提示词在原图基础上微调。
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      onOptionsChange({
                        ...generateOptions,
                        source: "existing",
                        uploadedImage: null,
                      })
                    }
                    className="text-agent text-xs font-medium hover:underline"
                  >
                    → 改用当前图片作为参考（5 积分）
                  </button>
                </div>
              )}
          </div>

          {/* 一键三视图：正/侧/背，防生成崩坏 */}
          {onGenerateThreeViews && (
            <button
              onClick={onGenerateThreeViews}
              disabled={
                threeViewsPending || generatePending || threeViewsInsufficient
              }
              title={
                threeViewsInsufficient
                  ? `积分不足（需 ${THREE_VIEWS_COST}，当前 ${balance}），请先充值`
                  : undefined
              }
              className="border-agent/40 bg-agent/10 text-agent hover:bg-agent/20 flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {threeViewsPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  生成三视图中（约1分钟）...
                </>
              ) : (
                <>
                  <Grid2x2 size={16} />
                  一键生成三视图（正/侧/背，9 积分）
                </>
              )}
            </button>
          )}
        </div>

        <DialogFooter className="border-border shrink-0 flex-row gap-3 border-t p-4">
          <button
            onClick={onClose}
            className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg py-2 transition"
          >
            取消
          </button>
          <button
            onClick={onGenerate}
            disabled={
              generatePending ||
              insufficient ||
              (generateOptions.source === "upload" &&
                !generateOptions.uploadedImage)
            }
            title={
              insufficient
                ? `积分不足（需 ${cost}，当前 ${balance}），请先充值`
                : undefined
            }
            className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex flex-1 items-center justify-center gap-2 rounded-lg py-2 transition disabled:cursor-not-allowed"
          >
            {generatePending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Wand2 size={16} />
                生成（{generateOptions.source === "none" ? 3 : 5} 积分）
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
