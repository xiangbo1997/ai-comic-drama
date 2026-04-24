"use client";

import { useState } from "react";
import {
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Users,
  Star,
  Layers,
} from "lucide-react";
import { ModelSelector } from "@/components/ai-models";
import type { Scene, ShotType, Emotion, Character } from "@/types";

const SHOT_TYPES: ShotType[] = ["特写", "近景", "中景", "全景", "远景"];
const EMOTIONS: Emotion[] = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "fear",
];

interface SceneEditorProps {
  scene: Scene | undefined;
  aspectRatio: string;
  selectedImageConfig?: string;
  onImageConfigChange: (id: string | undefined) => void;
  onOpenMultiImageDialog: () => void;
  onUpdateScene: (sceneId: string, data: Partial<Scene>) => void;
  onGenerateImage: (sceneId: string, scene: Scene) => void;
  isGeneratingImage: boolean;
  projectCharacters?: Array<{ character: Character }>;
  lastGenerationInfo?: { strategy?: string; attemptCount?: number };
  /** 当角色顺序变化时回调（第一个 = primary） */
  onCharacterRoleChange?: (sceneId: string, orderedIds: string[]) => void;
}

export function SceneEditor({
  scene,
  aspectRatio,
  selectedImageConfig,
  onImageConfigChange,
  onOpenMultiImageDialog,
  onUpdateScene,
  onGenerateImage,
  isGeneratingImage,
  projectCharacters = [],
  lastGenerationInfo,
  onCharacterRoleChange,
}: SceneEditorProps) {
  const [flickerCompare, setFlickerCompare] = useState(false);
  if (!scene) {
    return (
      <div className="flex w-1/3 flex-col">
        <div className="border-b border-gray-800 p-4">
          <h2 className="font-semibold">预览 / 编辑</h2>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-gray-500">
            <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
            <p>选择分镜进行编辑</p>
          </div>
        </div>
      </div>
    );
  }

  // 场景关联的角色（通过 selectedCharacterIds 或 selectedCharacter 匹配）
  const sceneCharacterIds = new Set([
    ...(scene.selectedCharacterIds || []),
    ...(scene.selectedCharacterId ? [scene.selectedCharacterId] : []),
  ]);
  const sceneCharacters =
    sceneCharacterIds.size > 0
      ? projectCharacters
          .map((pc) => pc.character)
          .filter((c) => sceneCharacterIds.has(c.id))
      : [];

  return (
    <div className="flex w-1/3 flex-col">
      <div className="border-b border-gray-800 p-4">
        <h2 className="font-semibold">预览 / 编辑</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Preview */}
        <div
          className={`mb-4 flex items-center justify-center overflow-hidden rounded-xl bg-gray-800 ${
            aspectRatio === "9:16"
              ? "aspect-[9/16] max-h-80"
              : aspectRatio === "16:9"
                ? "aspect-video"
                : "aspect-square"
          }`}
        >
          {scene.imageStatus === "PROCESSING" ? (
            <div className="text-center">
              <Loader2
                size={32}
                className="mx-auto mb-2 animate-spin text-gray-400"
              />
              <p className="text-sm text-gray-500">生成中...</p>
            </div>
          ) : scene.imageUrl ? (
            <img
              src={scene.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-center">
              <ImageIcon size={32} className="mx-auto mb-2 text-gray-500" />
              <p className="text-sm text-gray-500">点击生成图片</p>
            </div>
          )}
        </div>

        {/* Scene Characters Strip with Role Toggle */}
        {sceneCharacters.length > 0 && (
          <div className="mb-4 rounded-lg border border-gray-700 bg-gray-800/50 p-2">
            <div className="mb-1.5 flex items-center gap-1">
              <Users size={12} className="text-gray-400" />
              <span className="text-xs text-gray-400">场景角色</span>
              {sceneCharacters.length > 1 && (
                <span className="ml-auto text-[10px] text-gray-500">
                  点击⭐设为主角
                </span>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {sceneCharacters.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    if (idx === 0 || sceneCharacters.length <= 1) return;
                    const reordered = [
                      c.id,
                      ...sceneCharacters
                        .filter((sc) => sc.id !== c.id)
                        .map((sc) => sc.id),
                    ];
                    onCharacterRoleChange?.(scene.id, reordered);
                  }}
                  className="group relative flex-shrink-0 text-center"
                >
                  <div className="relative">
                    {c.referenceImages?.[0] ? (
                      <img
                        src={c.referenceImages[0]}
                        alt={c.name}
                        className={`h-10 w-10 rounded-full border-2 object-cover ${idx === 0 ? "border-yellow-500" : "border-gray-600 group-hover:border-gray-400"}`}
                      />
                    ) : (
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full border-2 bg-gray-700 ${idx === 0 ? "border-yellow-500" : "border-gray-600"}`}
                      >
                        <span className="text-xs">{c.name[0]}</span>
                      </div>
                    )}
                    {idx === 0 && (
                      <Star
                        size={10}
                        className="absolute -top-1 -right-1 fill-yellow-500 text-yellow-500"
                      />
                    )}
                  </div>
                  <span className="mt-0.5 block max-w-[48px] truncate text-[10px] text-gray-400">
                    {c.name}
                  </span>
                  <span className="text-[9px] text-gray-600">
                    {idx === 0 ? "主角" : "配角"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Flicker Compare: reference vs generated */}
        {scene.imageUrl &&
          sceneCharacters.length > 0 &&
          sceneCharacters[0]?.referenceImages?.[0] && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setFlickerCompare((v) => !v)}
                className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-gray-300"
              >
                <Layers size={12} />
                {flickerCompare ? "隐藏对比" : "定妆照对比"}
              </button>
              {flickerCompare && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="text-center">
                    <img
                      src={sceneCharacters[0].referenceImages[0]}
                      alt="参考"
                      className="w-full rounded-lg border border-gray-700"
                    />
                    <span className="mt-1 block text-[10px] text-gray-500">
                      定妆照
                    </span>
                  </div>
                  <div className="text-center">
                    <img
                      src={scene.imageUrl}
                      alt="生成"
                      className="w-full rounded-lg border border-gray-700"
                    />
                    <span className="mt-1 block text-[10px] text-gray-500">
                      生成图
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* Generation Info */}
        {lastGenerationInfo?.strategy && scene?.imageUrl && (
          <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
            <span
              className={`rounded px-1.5 py-0.5 ${
                lastGenerationInfo.strategy === "reference_edit"
                  ? "bg-green-900/30 text-green-400"
                  : "bg-gray-800 text-gray-400"
              }`}
            >
              {lastGenerationInfo.strategy === "reference_edit"
                ? "参考图编辑"
                : "仅提示词"}
            </span>
            {(lastGenerationInfo.attemptCount ?? 0) > 1 && (
              <span>重试 {(lastGenerationInfo.attemptCount ?? 1) - 1} 次</span>
            )}
          </div>
        )}

        {/* Edit Form */}
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-gray-400">景别</label>
            <select
              value={scene.shotType || "中景"}
              onChange={(e) =>
                onUpdateScene(scene.id, { shotType: e.target.value })
              }
              className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm"
            >
              {SHOT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">画面描述</label>
            <textarea
              value={scene.description}
              onChange={(e) =>
                onUpdateScene(scene.id, { description: e.target.value })
              }
              rows={3}
              className="w-full resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">对话</label>
            <textarea
              value={scene.dialogue || ""}
              onChange={(e) =>
                onUpdateScene(scene.id, { dialogue: e.target.value || null })
              }
              rows={2}
              placeholder="角色对话内容..."
              className="w-full resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-gray-400">旁白</label>
            <textarea
              value={scene.narration || ""}
              onChange={(e) =>
                onUpdateScene(scene.id, { narration: e.target.value || null })
              }
              rows={2}
              placeholder="旁白内容..."
              className="w-full resize-none rounded-lg bg-gray-800 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm text-gray-400">情感</label>
              <select
                value={scene.emotion || "neutral"}
                onChange={(e) =>
                  onUpdateScene(scene.id, { emotion: e.target.value })
                }
                className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm"
              >
                {EMOTIONS.map((emotion) => (
                  <option key={emotion} value={emotion}>
                    {emotion}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="mb-1 block text-sm text-gray-400">
                时长(秒)
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={scene.duration}
                onChange={(e) =>
                  onUpdateScene(scene.id, {
                    duration: parseInt(e.target.value) || 3,
                  })
                }
                className="w-full rounded-lg bg-gray-800 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Generate Button */}
          <div className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <ModelSelector
                category="IMAGE"
                value={selectedImageConfig}
                onChange={onImageConfigChange}
                onOpenMultiSelect={onOpenMultiImageDialog}
                showMultiSelectButton
                size="sm"
                disabled={scene.imageStatus === "PROCESSING"}
              />
              <button
                onClick={() => onGenerateImage(scene.id, scene)}
                disabled={
                  scene.imageStatus === "PROCESSING" || isGeneratingImage
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {scene.imageStatus === "PROCESSING" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : scene.imageUrl ? (
                  <RefreshCw size={16} />
                ) : (
                  <ImageIcon size={16} />
                )}
                {scene.imageUrl ? "重新生成" : "生成图片"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
