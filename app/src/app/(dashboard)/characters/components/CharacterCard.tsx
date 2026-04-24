"use client";

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
import {
  AppearanceEditor,
  isAppearanceEmpty,
} from "@/components/appearance-editor";
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

export function CharacterCard({
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
    <div className="overflow-hidden rounded-xl bg-gray-800">
      {/* Reference Image */}
      <div className="relative aspect-square bg-gray-700">
        {character.referenceImages.length > 0 ? (
          <img
            src={character.referenceImages[currentImageIndex]}
            alt={character.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center text-gray-500">
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
            >
              <ChevronLeft size={16} />
            </button>
            <span className="rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              {currentImageIndex + 1} / {character.referenceImages.length}
            </span>
            <button
              onClick={() =>
                onNextImage(character.id, character.referenceImages.length)
              }
              className="rounded-lg bg-black/60 p-1.5 backdrop-blur-sm transition hover:bg-black/80"
              title="下一张"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => onDeleteImage(character.id, currentImageIndex)}
              className="rounded-lg bg-red-600/80 p-1.5 backdrop-blur-sm transition hover:bg-red-700"
              title="删除当前图片"
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
            className="rounded-lg bg-black/50 p-2 transition hover:bg-blue-600"
            title="AI 生成参考图"
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
        className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm"
        placeholder="角色名称"
      />
      <div className="flex gap-2">
        <select
          value={formData.gender}
          onChange={(e) =>
            onFormDataChange({ ...formData, gender: e.target.value })
          }
          className="flex-1 rounded-lg bg-gray-700 px-3 py-2 text-sm"
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
          className="flex-1 rounded-lg bg-gray-700 px-3 py-2 text-sm"
          placeholder="年龄"
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-gray-500">外貌描述</span>
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
            className="flex items-center gap-1 rounded bg-purple-600 px-1.5 py-0.5 text-xs transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-gray-600"
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
          className="w-full resize-none rounded-lg bg-gray-700 px-3 py-2 text-sm"
          rows={2}
          placeholder="外貌描述"
        />
      </div>
      <div>
        <button
          type="button"
          onClick={onToggleAppearanceEditor}
          className="mb-1 flex items-center gap-1 text-xs text-blue-400 transition hover:text-blue-300"
        >
          {showAppearanceEditor ? "▾" : "▸"} 结构化外貌
        </button>
        {showAppearanceEditor && (
          <div className="rounded border border-gray-700 bg-gray-800 p-2">
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
        className="w-full rounded-lg bg-gray-700 px-3 py-2 text-sm"
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
          <div className="text-xs text-gray-500">标签</div>
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
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 py-2 text-sm hover:bg-blue-700"
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
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gray-700 py-2 text-sm hover:bg-gray-600"
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
            className="rounded p-1.5 hover:bg-gray-700"
          >
            <Edit2 size={16} />
          </button>
          <button onClick={onDelete} className="rounded p-1.5 hover:bg-red-600">
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
      <div className="space-y-1 text-sm text-gray-400">
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
          <p className="text-blue-400">
            🎤{" "}
            {VOICE_PRESETS.find((v) => v.id === character.voiceId)?.name ||
              "自定义声线"}
          </p>
        )}
      </div>
    </>
  );
}
