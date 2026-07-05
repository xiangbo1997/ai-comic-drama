"use client";

import { memo } from "react";
import {
  Trash2,
  Edit2,
  Loader2,
  User,
  Wand2,
  Upload,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { CharacterListItem, Tag } from "@/types";
import { extractThreeViews, type ThreeViewPose } from "@/lib/three-views";
import { AppearanceEditor } from "@/components/appearance-editor";
import type { AppearanceFormData } from "@/components/appearance-editor";
import { VOICE_PRESETS, type CharacterFormData } from "./constants";
import type { UseMutationResult } from "@tanstack/react-query";

interface CharacterCardProps {
  character: CharacterListItem;
  isEditing: boolean;
  formData: CharacterFormData;
  onFormDataChange: (data: CharacterFormData) => void;
  showAppearanceEditor: boolean;
  onToggleAppearanceEditor: () => void;
  tags: Tag[];
  currentImageIndex: number;
  onNextImage: (characterId: string, total: number) => void;
  onPrevImage: (characterId: string, total: number) => void;
  onDeleteImage: (characterId: string, index: number) => void;
  onStartEdit: (character: CharacterListItem) => void;
  onCancelEdit: () => void;
  onUpdate: () => void;
  onDelete: (id: string) => void;
  onOpenGenerateModal: (
    characterId: string,
    source: "none" | "upload" | "existing"
  ) => void;
  uploadingBaseImageId: string | null;
  generateMutationPending: boolean;
  updateMutationPending: boolean;
  generateDescriptionMutation: UseMutationResult<
    { description: string },
    Error,
    { name: string; gender: string; age: string }
  >;
}

function CharacterCardImpl({
  character,
  isEditing,
  formData,
  onFormDataChange,
  showAppearanceEditor,
  onToggleAppearanceEditor,
  tags,
  currentImageIndex,
  onNextImage,
  onPrevImage,
  onDeleteImage,
  onStartEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
  onOpenGenerateModal,
  uploadingBaseImageId,
  generateMutationPending,
  updateMutationPending,
  generateDescriptionMutation,
}: CharacterCardProps) {
  return (
    <div className="bg-card overflow-hidden rounded-xl">
      {/* Reference Image */}
      <div className="bg-secondary relative aspect-square">
        {character.referenceImages.length > 0 ? (
          <img
            src={character.referenceImages[currentImageIndex]}
            alt={character.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center">
            <User size={48} />
            <span className="mt-2 text-sm">无参考图</span>
          </div>
        )}

        {character.referenceImages.length > 1 && (
          <div className="absolute right-0 bottom-2 left-0 flex items-center justify-center gap-3 px-2">
            <button
              onClick={() =>
                onPrevImage(character.id, character.referenceImages.length)
              }
              className="rounded-lg bg-black/60 p-1.5 backdrop-blur-sm transition hover:bg-black/80"
              title="上一张"
              aria-label="上一张图片"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-foreground rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium backdrop-blur-sm">
              {currentImageIndex + 1} / {character.referenceImages.length}
            </span>
            <button
              onClick={() =>
                onNextImage(character.id, character.referenceImages.length)
              }
              className="rounded-lg bg-black/60 p-1.5 backdrop-blur-sm transition hover:bg-black/80"
              title="下一张"
              aria-label="下一张图片"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => onDeleteImage(character.id, currentImageIndex)}
              className="rounded-lg bg-red-600/80 p-1.5 backdrop-blur-sm transition hover:bg-red-700"
              title="删除当前图片"
              aria-label="删除当前图片"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}

        <div className="absolute right-2 bottom-2 flex gap-2">
          <button
            onClick={() => onOpenGenerateModal(character.id, "upload")}
            disabled={generateMutationPending}
            className="rounded-lg bg-black/50 p-2 transition hover:bg-purple-600"
            title="上传垫图生成（基于参考图生成）"
            aria-label="上传垫图生成参考图"
          >
            {uploadingBaseImageId === character.id ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Upload size={18} />
            )}
          </button>
          <button
            onClick={() => onOpenGenerateModal(character.id, "none")}
            disabled={generateMutationPending}
            className="hover:bg-primary rounded-lg bg-black/50 p-2 transition"
            title="AI 生成参考图"
            aria-label="AI 生成参考图"
          >
            {generateMutationPending &&
            uploadingBaseImageId !== character.id ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Wand2 size={18} />
            )}
          </button>
        </div>
      </div>

      {/* 三视图三联展示（防生成崩坏的转面图，与普通参考图区分） */}
      <ThreeViewStrip character={character} />

      {/* Info */}
      <div className="p-4">
        {isEditing ? (
          <CharacterEditForm
            formData={formData}
            onFormDataChange={onFormDataChange}
            showAppearanceEditor={showAppearanceEditor}
            onToggleAppearanceEditor={onToggleAppearanceEditor}
            tags={tags}
            onUpdate={onUpdate}
            onCancel={onCancelEdit}
            updatePending={updateMutationPending}
            generateDescriptionMutation={generateDescriptionMutation}
          />
        ) : (
          <CharacterViewInfo
            character={character}
            onStartEdit={() => onStartEdit(character)}
            onDelete={() => onDelete(character.id)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * memo 契约（为什么这样能止血整列表在编辑单卡时的重渲染）：
 *
 * 根因：页面把「共享的」formData 传给网格里的每一张卡，而 formData 在编辑任一
 * 卡片时每次按键都变。若不 memo，敲一张卡的输入框会重渲染全部 20-40 张卡
 *（每张都含 <img> + AppearanceEditor）。
 *
 * 关键洞察：只有 isEditing 的那张卡才会渲染 CharacterEditForm，才真正消费
 * formData / onFormDataChange / showAppearanceEditor / onToggleAppearanceEditor /
 * tags / onUpdate / onCancelEdit / updateMutationPending / generateDescriptionMutation。
 * 因此对「非编辑态」的卡（prev 与 next 都 isEditing === false），这些编辑专用
 * 的 props 变化不影响其渲染输出，可以安全忽略。
 *
 * 对称地，onStartEdit 只在非编辑态的 CharacterViewInfo 里用到；编辑态可忽略。
 *
 * 始终参与比较（两种状态下都影响渲染）：character（按引用——React Query 缓存
 * 只为变化的角色创建新对象，其余引用保持稳定）、currentImageIndex、isEditing、
 * 以及图片浮层上一直渲染的按钮所依赖的 uploadingBaseImageId /
 * generateMutationPending / onNextImage / onPrevImage / onDeleteImage /
 * onOpenGenerateModal / onDelete（onDelete 在编辑态不渲染，但为简洁一律比较其
 * 稳定引用，页面已 useCallback 固定，不会误触发）。
 */
function arePropsEqual(
  prev: CharacterCardProps,
  next: CharacterCardProps
): boolean {
  // 身份 + 始终影响渲染的 props：任一不等即需重渲染
  if (
    prev.character !== next.character ||
    prev.currentImageIndex !== next.currentImageIndex ||
    prev.isEditing !== next.isEditing ||
    prev.uploadingBaseImageId !== next.uploadingBaseImageId ||
    prev.generateMutationPending !== next.generateMutationPending ||
    prev.onNextImage !== next.onNextImage ||
    prev.onPrevImage !== next.onPrevImage ||
    prev.onDeleteImage !== next.onDeleteImage ||
    prev.onOpenGenerateModal !== next.onOpenGenerateModal ||
    prev.onDelete !== next.onDelete ||
    prev.onStartEdit !== next.onStartEdit
  ) {
    return false;
  }

  // 非编辑态的卡不消费任何编辑专用 props，可全部忽略 → 判等跳过重渲染
  if (!prev.isEditing && !next.isEditing) {
    return true;
  }

  // 编辑态（此处 prev.isEditing === next.isEditing === true）：编辑专用 props 需正常比较
  return (
    prev.formData === next.formData &&
    prev.onFormDataChange === next.onFormDataChange &&
    prev.showAppearanceEditor === next.showAppearanceEditor &&
    prev.onToggleAppearanceEditor === next.onToggleAppearanceEditor &&
    prev.tags === next.tags &&
    prev.onUpdate === next.onUpdate &&
    prev.onCancelEdit === next.onCancelEdit &&
    prev.updateMutationPending === next.updateMutationPending &&
    prev.generateDescriptionMutation === next.generateDescriptionMutation
  );
}

export const CharacterCard = memo(CharacterCardImpl, arePropsEqual);

function CharacterEditForm({
  formData,
  onFormDataChange,
  showAppearanceEditor,
  onToggleAppearanceEditor,
  tags,
  onUpdate,
  onCancel,
  updatePending,
  generateDescriptionMutation,
}: {
  formData: CharacterFormData;
  onFormDataChange: (data: CharacterFormData) => void;
  showAppearanceEditor: boolean;
  onToggleAppearanceEditor: () => void;
  tags: Tag[];
  onUpdate: () => void;
  onCancel: () => void;
  updatePending: boolean;
  generateDescriptionMutation: UseMutationResult<
    { description: string },
    Error,
    { name: string; gender: string; age: string }
  >;
}) {
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={formData.name}
        onChange={(e) =>
          onFormDataChange({ ...formData, name: e.target.value })
        }
        className="bg-secondary w-full rounded-lg px-3 py-2 text-sm"
        placeholder="角色名称"
      />
      <div className="flex gap-2">
        <select
          value={formData.gender}
          onChange={(e) =>
            onFormDataChange({ ...formData, gender: e.target.value })
          }
          className="bg-secondary flex-1 rounded-lg px-3 py-2 text-sm"
        >
          <option value="female">女</option>
          <option value="male">男</option>
        </select>
        <input
          type="text"
          value={formData.age}
          onChange={(e) =>
            onFormDataChange({ ...formData, age: e.target.value })
          }
          className="bg-secondary flex-1 rounded-lg px-3 py-2 text-sm"
          placeholder="年龄"
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-muted-foreground text-xs">外貌描述</span>
          <button
            type="button"
            onClick={() =>
              generateDescriptionMutation.mutate({
                name: formData.name,
                gender: formData.gender,
                age: formData.age,
              })
            }
            disabled={
              !formData.name.trim() || generateDescriptionMutation.isPending
            }
            className="disabled:bg-secondary flex items-center gap-1 rounded bg-purple-600 px-1.5 py-0.5 text-xs transition hover:bg-purple-700 disabled:cursor-not-allowed"
            title="AI 生成外貌描述"
          >
            {generateDescriptionMutation.isPending ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Wand2 size={10} />
            )}
            生成
          </button>
        </div>
        <textarea
          value={formData.description}
          onChange={(e) =>
            onFormDataChange({ ...formData, description: e.target.value })
          }
          className="bg-secondary w-full resize-none rounded-lg px-3 py-2 text-sm"
          rows={2}
          placeholder="外貌描述"
        />
      </div>
      <div>
        <button
          type="button"
          onClick={onToggleAppearanceEditor}
          className="text-primary hover:text-primary/80 mb-1 flex items-center gap-1 text-xs transition"
        >
          {showAppearanceEditor ? "▾" : "▸"} 结构化外貌
        </button>
        {showAppearanceEditor && (
          <div className="border-border bg-card rounded border p-2">
            <AppearanceEditor
              value={formData.appearance}
              onChange={(appearance: AppearanceFormData) =>
                onFormDataChange({ ...formData, appearance })
              }
              compact
            />
          </div>
        )}
      </div>
      <select
        value={formData.voiceId}
        onChange={(e) =>
          onFormDataChange({ ...formData, voiceId: e.target.value })
        }
        className="bg-secondary w-full rounded-lg px-3 py-2 text-sm"
      >
        <option value="">选择声线</option>
        {VOICE_PRESETS.filter((v) => v.gender === formData.gender).map(
          (voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          )
        )}
      </select>
      {tags.length > 0 && (
        <div className="space-y-2">
          <div className="text-muted-foreground text-xs">标签</div>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => {
              const isSelected = formData.tagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    onFormDataChange({
                      ...formData,
                      tagIds: isSelected
                        ? formData.tagIds.filter((id) => id !== tag.id)
                        : [...formData.tagIds, tag.id],
                    });
                  }}
                  className={`rounded-full px-2 py-1 text-xs transition ${isSelected ? "ring-1 ring-white" : "opacity-50 hover:opacity-100"} `}
                  style={{ backgroundColor: tag.color || "#6B7280" }}
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onUpdate}
          disabled={updatePending}
          className="bg-primary hover:bg-primary/90 flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm"
        >
          {updatePending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}
          保存
        </button>
        <button
          onClick={onCancel}
          className="bg-secondary hover:bg-secondary/80 flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm"
        >
          <X size={16} />
          取消
        </button>
      </div>
    </div>
  );
}

function CharacterViewInfo({
  character,
  onStartEdit,
  onDelete,
}: {
  character: CharacterListItem;
  onStartEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{character.name}</h3>
        <div className="flex gap-1">
          <button
            onClick={onStartEdit}
            className="hover:bg-secondary rounded p-1.5"
            aria-label="编辑角色"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1.5 hover:bg-red-600"
            aria-label="删除角色"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {character.tags && character.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {character.tags.map(({ tag }) => (
            <span
              key={tag.id}
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ backgroundColor: tag.color || "#6B7280" }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <div className="text-muted-foreground space-y-1 text-sm">
        {character.gender && (
          <p>
            {character.gender === "female" ? "女" : "男"}
            {character.age && ` · ${character.age}岁`}
          </p>
        )}
        {character.description && (
          <p className="line-clamp-2">{character.description}</p>
        )}
        {character.voiceId && (
          <p className="text-primary">
            🎤{" "}
            {VOICE_PRESETS.find((v) => v.id === character.voiceId)?.name ||
              "自定义声线"}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * 三视图三联展示：把 front/side/back 三张转面图独立横排展示，
 * 与普通参考图轮播区分，一眼看出是角色定妆/锁形象图。
 * 无三视图（任一角度缺失）时不渲染。
 */
function ThreeViewStrip({ character }: { character: CharacterListItem }) {
  const views = extractThreeViews(character.referenceAssets);
  const items: { pose: ThreeViewPose; label: string; url?: string }[] = [
    { pose: "front", label: "正面", url: views.front },
    { pose: "side", label: "侧面", url: views.side },
    { pose: "back", label: "背面", url: views.back },
  ];

  // 三个角度都没有就不显示
  if (!items.some((it) => it.url)) return null;

  return (
    <div className="border-border border-t px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          角色三视图
        </span>
        <span className="text-muted-foreground/60 text-[10px]">
          锁形象 · 生视频自动多参考
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => (
          <div key={it.pose} className="space-y-1">
            <div className="bg-secondary relative aspect-square overflow-hidden rounded-lg">
              {it.url ? (
                <img
                  src={it.url}
                  alt={it.label}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="text-muted-foreground/50 flex h-full w-full items-center justify-center text-[10px]">
                  缺{it.label}
                </div>
              )}
            </div>
            <p className="text-muted-foreground text-center text-[10px]">
              {it.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
