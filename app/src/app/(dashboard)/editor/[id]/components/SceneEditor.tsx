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
  Video,
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
// 展示用中文标签；value 保持英文枚举（落库/管线消费不变）。
// 此前下拉直接渲染英文枚举，中文界面蹦 neutral/surprised（ux-editor P2-10）
const EMOTION_LABELS: Record<Emotion, string> = {
  neutral: "平静",
  happy: "开心",
  sad: "悲伤",
  angry: "愤怒",
  surprised: "惊讶",
  fear: "恐惧",
};

interface SceneEditorProps {
  scene: Scene | undefined;
  /** 下一分镜（按 order 排序的后继）；null/undefined = 当前已是最后一镜 */
  nextScene?: Pick<Scene, "imageUrl"> | null;
  aspectRatio: string;
  /** 当前分镜播放速度（0.25–4，缺省 1），来自 generationParams.sceneEffects */
  sceneSpeed?: number;
  /** 变更播放速度回调（落库到 sceneEffects，导出端消费做变速） */
  onSceneSpeedChange?: (sceneId: string, speed: number) => void;
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
  nextScene,
  aspectRatio,
  sceneSpeed = 1,
  onSceneSpeedChange,
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
  // 预览媒体 tab：图片 / 视频。该分镜有 videoUrl 时才显示"视频"tab。
  const [mediaTab, setMediaTab] = useState<"image" | "video">("image");

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
    // 切换分镜时预览 tab 重置为图片（新分镜可能没视频）
    setMediaTab("image");
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 尚未落库的提交函数快照：卸载（如点返回项目列表）恰逢防抖窗口内时
  // flush 立即提交，避免最后一次编辑静默丢失（ux-editor P0-2）
  const pendingCommitRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      pendingCommitRef.current?.();
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
    const fire = () => {
      pendingCommitRef.current = null;
      const payload =
        field === "description"
          ? { description: value }
          : { [field]: value || null };
      onUpdateScene(sceneId, payload as Partial<Scene>);
    };
    pendingCommitRef.current = fire;
    debounceRef.current = setTimeout(fire, 400);
  };

  if (!scene) {
    return (
      <div className="border-border hidden w-full flex-col border-l md:flex md:w-[30%] md:min-w-[260px] lg:w-[30%] lg:min-w-[320px]">
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
        {/* 图片 / 视频 切换 tab —— 仅该分镜已生成视频时显示"视频"tab */}
        {scene.videoUrl && (
          <div className="bg-secondary mb-2 flex w-fit rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setMediaTab("image")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors ${
                mediaTab === "image"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <ImageIcon size={13} /> 图片
            </button>
            <button
              type="button"
              onClick={() => setMediaTab("video")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors ${
                mediaTab === "video"
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Video size={13} /> 视频
            </button>
          </div>
        )}

        {/* Preview */}
        <div
          className={`bg-card mb-4 flex items-center justify-center overflow-hidden rounded-xl ${
            // 9:16 用固定高度 + 按比例收窄居中；此前 max-h-80 截断高度但宽度仍占满，
            // 盒子实际变成 ~9:10，object-cover 会把竖图上下裁掉
            aspectRatio === "9:16"
              ? "mx-auto aspect-[9/16] h-80"
              : aspectRatio === "16:9"
                ? "aspect-video"
                : "aspect-square"
          }`}
        >
          {/* 视频 tab：内联播放该分镜视频（原生 controls，最省事） */}
          {scene.videoUrl && mediaTab === "video" ? (
            <video
              key={scene.videoUrl}
              src={scene.videoUrl}
              controls
              playsInline
              // object-contain 与导出端 scale+pad 语义一致：比例≠画幅时不裁切
              className="h-full w-full bg-black object-contain"
            />
          ) : scene.imageStatus === "PROCESSING" ? (
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
              // object-contain 与导出端 scale+pad 语义一致：图片比例≠画幅时不裁切
              className="h-full w-full object-contain"
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

        {/* 播放速度（变速）—— 落库到 sceneEffects，导出端做变速。快捷倍速 + 滑块微调 */}
        {onSceneSpeedChange && (
          <div className="border-border bg-card/50 mb-4 rounded-lg border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                播放速度（导出生效）
              </span>
              <span className="text-sm font-medium">
                {sceneSpeed.toFixed(2)}×
              </span>
            </div>
            <div className="mb-2 flex gap-1">
              {[0.5, 1, 1.5, 2].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => scene && onSceneSpeedChange(scene.id, v)}
                  className={`flex-1 rounded-md py-1 text-xs transition-colors ${
                    Math.abs(sceneSpeed - v) < 0.01
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}×
                </button>
              ))}
            </div>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={sceneSpeed}
              onChange={(e) =>
                scene && onSceneSpeedChange(scene.id, Number(e.target.value))
              }
              className="accent-primary w-full"
            />
            <p className="text-muted-foreground mt-1 text-[10px]">
              * 0.25–4× 逐分镜变速；&lt;1 放慢、&gt;1
              加快，导出时对该分镜画面与配音同步变速
            </p>
          </div>
        )}

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
                    {EMOTION_LABELS[emotion]}
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
                max={60}
                value={scene.duration}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 3;
                  onUpdateScene(scene.id, {
                    duration: Math.min(60, Math.max(1, v)),
                  });
                }}
                title="超过模型单段时长将自动分段并无缝衔接（最长 60 秒）"
                className="bg-card w-full rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="w-24">
              <label className="text-muted-foreground mb-1 block text-sm">
                语速
              </label>
              <select
                value={String(scene.ttsSpeed ?? 1)}
                onChange={(e) =>
                  onUpdateScene(scene.id, {
                    ttsSpeed: Number(e.target.value),
                  })
                }
                title="配音语速，下次生成配音时生效"
                className="bg-card w-full rounded-lg px-3 py-2 text-sm"
              >
                <option value="0.75">0.75x</option>
                <option value="1">1.0x</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2">2.0x</option>
              </select>
            </div>
          </div>

          {/* 尾帧衔接下一镜：视频生成用下一镜图片做尾帧（Veo FL 首尾帧插值）。
              仅适合空间连续的相邻镜头（如进门/伸手等连续动作），跳切镜头
              强上会出现变形 morph 感 */}
          <label
            className="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm"
            title="生成本分镜视频时，把下一分镜的图片作为结尾画面（首尾帧插值），实现相邻镜头无缝衔接。适合空间连续的动作衔接，场景跳切不建议开启"
          >
            <input
              type="checkbox"
              checked={!!scene.videoLinkNext}
              disabled={!nextScene}
              onChange={(e) =>
                onUpdateScene(scene.id, { videoLinkNext: e.target.checked })
              }
              className="accent-primary h-4 w-4"
            />
            尾帧衔接下一镜
            {!nextScene && (
              <span className="text-xs opacity-60">（已是最后一镜）</span>
            )}
            {nextScene && scene.videoLinkNext && !nextScene.imageUrl && (
              <span className="text-xs text-amber-500">
                下一镜未出图，生成时将回落普通图生视频
              </span>
            )}
          </label>

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
