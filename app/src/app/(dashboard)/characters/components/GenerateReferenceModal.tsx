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
      <div className="w-full max-w-md rounded-xl bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-700 p-4">
          <h2 className="text-lg font-semibold">生成参考图</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-700">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">图片供应商</label>
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
              <span className="text-xs text-gray-500">
                选择已测试成功的图像配置
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">图片来源</label>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-700/50 p-3 hover:bg-gray-700">
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
                  className="h-4 w-4 text-blue-600"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    无参考图（纯 AI 生成）
                  </div>
                  <div className="text-xs text-gray-500">消耗 3 积分</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-700/50 p-3 hover:bg-gray-700">
                <input
                  type="radio"
                  name="source"
                  checked={generateOptions.source === "upload"}
                  onChange={() =>
                    onOptionsChange({ ...generateOptions, source: "upload" })
                  }
                  className="h-4 w-4 text-blue-600"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">上传新图片作为参考</div>
                  <div className="text-xs text-gray-500">消耗 5 积分</div>
                </div>
              </label>

              {hasImages && (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg bg-gray-700/50 p-3 hover:bg-gray-700">
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
                    className="h-4 w-4 text-blue-600"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">
                      使用当前图片作为参考
                    </div>
                    <div className="text-xs text-gray-500">
                      消耗 5 积分 · 基于当前显示的图片优化
                    </div>
                  </div>
                </label>
              )}
            </div>
          </div>

          {generateOptions.source === "upload" && (
            <div className="space-y-2">
              <label className="text-sm text-gray-400">上传参考图</label>
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
                <label className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-600 hover:border-gray-500">
                  <Upload size={24} className="mb-2 text-gray-500" />
                  <span className="text-sm text-gray-500">点击上传图片</span>
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
              <label className="text-sm text-gray-400">当前选中的图片</label>
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
            <label className="text-sm text-gray-400">
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
              className="w-full resize-none rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              rows={3}
            />
            <p className="text-xs text-gray-500">
              提示：将与角色基础信息合并生成
            </p>
          </div>
        </div>

        <div className="flex gap-3 border-t border-gray-700 p-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-gray-700 py-2 transition hover:bg-gray-600"
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
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-600"
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
