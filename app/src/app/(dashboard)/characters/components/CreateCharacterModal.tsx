"use client";

import { Loader2, Wand2, X } from "lucide-react";
import type { Tag } from "@/types";
import {
  AppearanceEditor,
  type AppearanceFormData,
} from "@/components/appearance-editor";
import { VOICE_PRESETS, type CharacterFormData } from "./constants";
import type { UseMutationResult } from "@tanstack/react-query";

interface CreateCharacterModalProps {
  formData: CharacterFormData;
  onFormDataChange: (data: CharacterFormData) => void;
  showAppearanceEditor: boolean;
  onToggleAppearanceEditor: () => void;
  tags: Tag[];
  onClose: () => void;
  onCreate: () => void;
  createPending: boolean;
  generateDescriptionMutation: UseMutationResult<
    { description: string },
    Error,
    { name: string; gender: string; age: string }
  >;
}

export function CreateCharacterModal({
  formData,
  onFormDataChange,
  showAppearanceEditor,
  onToggleAppearanceEditor,
  tags,
  onClose,
  onCreate,
  createPending,
  generateDescriptionMutation,
}: CreateCharacterModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card w-full max-w-md rounded-xl">
        <div className="border-border flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold">创建角色</h2>
          <button
            onClick={onClose}
            className="hover:bg-secondary rounded p-1"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              角色名称 *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                onFormDataChange({ ...formData, name: e.target.value })
              }
              className="bg-secondary w-full rounded-lg px-3 py-2"
              placeholder="如：林萧"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                性别
              </label>
              <select
                value={formData.gender}
                onChange={(e) =>
                  onFormDataChange({ ...formData, gender: e.target.value })
                }
                className="bg-secondary w-full rounded-lg px-3 py-2"
              >
                <option value="female">女</option>
                <option value="male">男</option>
              </select>
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                年龄
              </label>
              <input
                type="text"
                value={formData.age}
                onChange={(e) =>
                  onFormDataChange({ ...formData, age: e.target.value })
                }
                className="bg-secondary w-full rounded-lg px-3 py-2"
                placeholder="如：24"
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-muted-foreground text-sm">外貌描述</label>
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
                className="disabled:bg-secondary flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs transition hover:bg-purple-700 disabled:cursor-not-allowed"
                title="根据名称、性别、年龄自动生成外貌描述"
              >
                {generateDescriptionMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Wand2 size={12} />
                )}
                AI 生成
              </button>
            </div>
            <textarea
              value={formData.description}
              onChange={(e) =>
                onFormDataChange({ ...formData, description: e.target.value })
              }
              className="bg-secondary w-full resize-none rounded-lg px-3 py-2"
              rows={3}
              placeholder="如：黑色长发，瓜子脸，大眼睛，身材纤细"
            />
            {generateDescriptionMutation.error && (
              <p className="mt-1 text-xs text-red-400">
                {generateDescriptionMutation.error instanceof Error
                  ? generateDescriptionMutation.error.message
                  : "生成失败"}
              </p>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={onToggleAppearanceEditor}
              className="text-primary hover:text-primary/80 mb-2 flex items-center gap-1 text-sm transition"
            >
              {showAppearanceEditor ? "▾" : "▸"}{" "}
              结构化外貌（可选，提升角色一致性）
            </button>
            {showAppearanceEditor && (
              <div className="border-border bg-card rounded-lg border p-3">
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
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              声线
            </label>
            <select
              value={formData.voiceId}
              onChange={(e) =>
                onFormDataChange({ ...formData, voiceId: e.target.value })
              }
              className="bg-secondary w-full rounded-lg px-3 py-2"
            >
              <option value="">选择声线（可选）</option>
              {VOICE_PRESETS.filter((v) => v.gender === formData.gender).map(
                (voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                )
              )}
            </select>
          </div>
          {tags.length > 0 && (
            <div>
              <label className="text-muted-foreground mb-2 block text-sm">
                标签
              </label>
              <div className="flex flex-wrap gap-2">
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
                      className={`rounded-full px-3 py-1 text-sm transition ${
                        isSelected
                          ? "ring-offset-card ring-2 ring-offset-2"
                          : "opacity-50 hover:opacity-100"
                      } `}
                      style={{ backgroundColor: tag.color || "#6B7280" }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="border-border flex gap-3 border-t p-4">
          <button
            onClick={onClose}
            className="bg-secondary hover:bg-secondary/80 flex-1 rounded-lg py-2"
          >
            取消
          </button>
          <button
            onClick={onCreate}
            disabled={!formData.name.trim() || createPending}
            className="bg-primary hover:bg-primary/90 disabled:bg-secondary flex flex-1 items-center justify-center gap-2 rounded-lg py-2"
          >
            {createPending && <Loader2 size={18} className="animate-spin" />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
