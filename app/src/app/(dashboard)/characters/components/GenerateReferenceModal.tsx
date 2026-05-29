"use client";

import { Loader2, Wand2, Upload, X } from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import type { CharacterListItem } from "@/types";
import type { GenerateOptions } from "./constants";

interface GenerateReferenceModalProps {
  characterId: string;
  characters: CharacterListItem[];
  generateOptions: GenerateOptions;
  onOptionsChange: (options: GenerateOptions) => void;
  currentImageIndex: number;
  onClose: () => void;
  onGenerate: () => void;
  generatePending: boolean;
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
}: GenerateReferenceModalProps) {
  const character = characters.find((c) => c.id === characterId);
  const hasImages = (character?.referenceImages?.length ?? 0) > 0;

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      onOptionsChange({ ...generateOptions, uploadedImage: base64 });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-md rounded-xl">
        <div className="border-border flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">生成参考图</h2>
          <button onClick={onClose} className="hover:bg-secondary rounded p-1">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-4">
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
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <label className="border-border hover:border-border flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed">
                  <Upload size={24} className="text-muted-foreground mb-2" />
                  <span className="text-muted-foreground text-sm">
                    点击上传图片
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
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
          </div>
        </div>

        <div className="border-border flex gap-3 border-t p-4">
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
              (generateOptions.source === "upload" &&
                !generateOptions.uploadedImage)
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
        </div>
      </div>
    </div>
  );
}
