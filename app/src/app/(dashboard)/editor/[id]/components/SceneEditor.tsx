"use client";

import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Users,
  Star,
  Layers,
  AlertCircle,
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

  // 文本字段本地草稿 + 防抖落库：避免每次 keystroke 都 PATCH 数据库（高频写+竞态）。
  // 本地 state 保证输入即时响应，停止输入 400ms 后才提交。
  const [draft, setDraft] = useState({
    description: scene?.description ?? "",
    dialogue: scene?.dialogue ?? "",
    narration: scene?.narration ?? "",
  });
  const [draftSceneId, setDraftSceneId] = useState<string | undefined>(
    scene?.id
  );
  // 渲染期间按 scene.id 同步草稿（切换分镜时重置为新分镜内容）
  if (scene && scene.id !== draftSceneId) {
    setDraftSceneId(scene.id);
    setDraft({
      description: scene.description ?? "",
      dialogue: scene.dialogue ?? "",
      narration: scene.narration ?? "",
    });
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );
  const commitField = (
    sceneId: string,
    field: "description" | "dialogue" | "narration",
    value: string
  ) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const payload =
        field === "description"
          ? { description: value }
          : { [field]: value || null };
      onUpdateScene(sceneId, payload as Partial<Scene>);
    }, 400);
  };

  if (!scene) {
    return (
      <div className="border-border hidden w-full flex-col border-l lg:flex lg:w-[30%] lg:min-w-[320px]">
        <div className="border-border border-b p-4">
          <h2 className="font-semibold">预览 / 编辑</h2>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-muted-foreground text-center">
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
    <div className="border-border flex w-[30%] min-w-[320px] flex-col border-l">
      <div className="border-border flex items-center justify-between border-b p-4">
        <h2 className="font-semibold">预览 / 编辑</h2>
        {typeof scene.order === "number" && (
          <span className="bg-secondary text-muted-foreground rounded px-2 py-0.5 text-xs">
            分镜 #{scene.order + 1}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* Preview */}
        <div
          className={`bg-card mb-4 flex items-center justify-center overflow-hidden rounded-xl ${
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
                className="text-muted-foreground mx-auto mb-2 animate-spin"
              />
              <p className="text-muted-foreground text-sm">生成中...</p>
            </div>
          ) : scene.imageStatus === "FAILED" && !scene.imageUrl ? (
            <div className="text-center">
              <AlertCircle
                size={32}
                className="text-destructive mx-auto mb-2"
              />
              <p className="text-destructive text-sm">生成失败，点击下方重试</p>
            </div>
          ) : scene.imageUrl ? (
            <img
              src={scene.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-center">
              <ImageIcon
                size={32}
                className="text-muted-foreground mx-auto mb-2"
              />
              <p className="text-muted-foreground text-sm">点击生成图片</p>
            </div>
          )}
        </div>

        {/* Scene Characters Strip with Role Toggle */}
        {sceneCharacters.length > 0 && (
          <div className="border-border bg-card/50 mb-4 rounded-lg border p-2">
            <div className="mb-1.5 flex items-center gap-1">
              <Users size={12} className="text-muted-foreground" />
              <span className="text-muted-foreground text-xs">场景角色</span>
              {sceneCharacters.length > 1 && (
                <span className="text-muted-foreground ml-auto text-[10px]">
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
                        className={`h-10 w-10 rounded-full border-2 object-cover ${idx === 0 ? "border-primary" : "border-border group-hover:border-muted-foreground"}`}
                      />
                    ) : (
                      <div
                        className={`bg-secondary flex h-10 w-10 items-center justify-center rounded-full border-2 ${idx === 0 ? "border-primary" : "border-border"}`}
                      >
                        <span className="text-xs">{c.name[0]}</span>
                      </div>
                    )}
                    {idx === 0 && (
                      <Star
                        size={10}
                        className="fill-primary text-primary absolute -top-1 -right-1"
                      />
                    )}
                  </div>
                  <span className="text-muted-foreground mt-0.5 block max-w-[48px] truncate text-[10px]">
                    {c.name}
                  </span>
                  <span className="text-muted-foreground text-[9px]">
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
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition"
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
                      className="border-border w-full rounded-lg border"
                    />
                    <span className="text-muted-foreground mt-1 block text-[10px]">
                      定妆照
                    </span>
                  </div>
                  <div className="text-center">
                    <img
                      src={scene.imageUrl}
                      alt="生成"
                      className="border-border w-full rounded-lg border"
                    />
                    <span className="text-muted-foreground mt-1 block text-[10px]">
                      生成图
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* Generation Info */}
        {lastGenerationInfo?.strategy && scene?.imageUrl && (
          <div className="text-muted-foreground mb-4 flex items-center gap-2 text-xs">
            <span
              className={`rounded px-1.5 py-0.5 ${
                lastGenerationInfo.strategy === "reference_edit"
                  ? "bg-green-900/30 text-green-400"
                  : "bg-card text-muted-foreground"
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
            <label className="text-muted-foreground mb-1 block text-sm">
              景别
            </label>
            <select
              value={scene.shotType || "中景"}
              onChange={(e) =>
                onUpdateScene(scene.id, { shotType: e.target.value })
              }
              className="bg-card w-full rounded-lg px-3 py-2 text-sm"
            >
              {SHOT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              画面描述
            </label>
            <textarea
              value={draft.description}
              onChange={(e) =>
                commitField(scene.id, "description", e.target.value)
              }
              rows={3}
              className="bg-card focus:ring-primary w-full resize-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              对话
            </label>
            <textarea
              value={draft.dialogue}
              onChange={(e) =>
                commitField(scene.id, "dialogue", e.target.value)
              }
              rows={2}
              placeholder="角色对话内容..."
              className="bg-card focus:ring-primary w-full resize-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              旁白
            </label>
            <textarea
              value={draft.narration}
              onChange={(e) =>
                commitField(scene.id, "narration", e.target.value)
              }
              rows={2}
              placeholder="旁白内容..."
              className="bg-card focus:ring-primary w-full resize-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-muted-foreground mb-1 block text-sm">
                情感
              </label>
              <select
                value={scene.emotion || "neutral"}
                onChange={(e) =>
                  onUpdateScene(scene.id, { emotion: e.target.value })
                }
                className="bg-card w-full rounded-lg px-3 py-2 text-sm"
              >
                {EMOTIONS.map((emotion) => (
                  <option key={emotion} value={emotion}>
                    {emotion}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label className="text-muted-foreground mb-1 block text-sm">
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
                className="bg-card w-full rounded-lg px-3 py-2 text-sm"
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
                className="bg-primary hover:bg-primary/90 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {scene.imageStatus === "PROCESSING" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : scene.imageStatus === "FAILED" && !scene.imageUrl ? (
                  <RefreshCw size={16} />
                ) : scene.imageUrl ? (
                  <RefreshCw size={16} />
                ) : (
                  <ImageIcon size={16} />
                )}
                {scene.imageStatus === "FAILED" && !scene.imageUrl
                  ? "重试生成"
                  : scene.imageUrl
                    ? "重新生成"
                    : "生成图片"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
