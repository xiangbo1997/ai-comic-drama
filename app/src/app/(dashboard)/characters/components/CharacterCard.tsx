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
  BadgeCheck,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Star,
} from "lucide-react";
import type { CharacterListItem, Tag } from "@/types";
import { isCharacterFinalized } from "@/lib/character-finalized";
import { extractThreeViews, type ThreeViewPose } from "@/lib/three-views";
import {
  extractExpressionSheet,
  EXPRESSION_SPECS,
} from "@/lib/expression-sheet";
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
  /** 仅本角色的参考图生成中（并发生成互不阻塞，不再是全局 pending） */
  isGenerating: boolean;
  /**
   * 把某张已在库的参考图设为定妆照（批 5 · H1）。
   * 此前用户完全无法选锚，只能靠生成顺序碰运气。
   */
  onSetCanonical: (characterId: string, imageUrl: string) => void;
  /** 正在提交的定妆照 URL（本角色范围内）；null 表示无提交进行中 */
  settingCanonicalUrl: string | null;
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
  isGenerating,
  onSetCanonical,
  settingCanonicalUrl,
  updateMutationPending,
  generateDescriptionMutation,
}: CharacterCardProps) {
  const currentImageUrl = character.referenceImages[currentImageIndex];
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

        {/* 定妆照选择（批 5 · H1）：当前轮播这张是不是定妆锚，一眼可见且可一键改。
            放左上角，避开右下角既有的生成按钮组与底部轮播控件。 */}
        {currentImageUrl && (
          <CanonicalToggle
            imageUrl={currentImageUrl}
            isCanonical={character.canonicalImageUrl === currentImageUrl}
            pending={settingCanonicalUrl === currentImageUrl}
            disabled={settingCanonicalUrl !== null}
            onSetCanonical={() => onSetCanonical(character.id, currentImageUrl)}
            className="absolute top-2 left-2"
          />
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
            disabled={isGenerating}
            className="hover:bg-accent rounded-lg bg-black/50 p-2 transition"
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
            disabled={isGenerating}
            className="hover:bg-primary rounded-lg bg-black/50 p-2 transition"
            title="AI 生成参考图"
            aria-label="AI 生成参考图"
          >
            {isGenerating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Wand2 size={18} />
            )}
          </button>
        </div>
      </div>

      {/* 三视图三联展示（防生成崩坏的转面图，与普通参考图区分） */}
      <ThreeViewStrip
        character={character}
        onSetCanonical={onSetCanonical}
        settingCanonicalUrl={settingCanonicalUrl}
      />

      {/* 表情集展示（锁跨镜头的五官画法） */}
      <ExpressionStrip character={character} />

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
            onGenerateAnchor={() => onOpenGenerateModal(character.id, "none")}
            isGenerating={isGenerating}
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
 * 「缺定妆照」提示与其「拍定妆照」按钮同样只在非编辑态渲染，它们依赖的
 * onOpenGenerateModal / isGenerating 已在下方「始终参与比较」的清单里，无需新增比较项。
 *
 * 始终参与比较（两种状态下都影响渲染）：character（按引用——React Query 缓存
 * 只为变化的角色创建新对象，其余引用保持稳定）、currentImageIndex、isEditing、
 * 以及图片浮层上一直渲染的按钮所依赖的 uploadingBaseImageId /
 * isGenerating（仅本卡生成态，页面按角色 ID 派生，并发时只有对应卡片变化）/
 * onNextImage / onPrevImage / onDeleteImage /
 * onOpenGenerateModal / onDelete（onDelete 在编辑态不渲染，但为简洁一律比较其
 * 稳定引用，页面已 useCallback 固定，不会误触发）。
 * 批 5 追加 onSetCanonical / settingCanonicalUrl：定妆照选择按钮在主图区与
 * 三视图区都是「无论编辑态都渲染」的（它们在 isEditing 分支之外），必须始终比较。
 * settingCanonicalUrl 由页面按角色 ID 派生，并发改锚时只有对应卡片变化。
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
    prev.isGenerating !== next.isGenerating ||
    prev.onNextImage !== next.onNextImage ||
    prev.onPrevImage !== next.onPrevImage ||
    prev.onDeleteImage !== next.onDeleteImage ||
    prev.onOpenGenerateModal !== next.onOpenGenerateModal ||
    prev.onDelete !== next.onDelete ||
    prev.onStartEdit !== next.onStartEdit ||
    prev.onSetCanonical !== next.onSetCanonical ||
    prev.settingCanonicalUrl !== next.settingCanonicalUrl
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
            className="disabled:bg-secondary bg-agent text-agent-foreground hover:bg-agent/90 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition disabled:cursor-not-allowed"
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
              characterContext={{
                name: formData.name,
                gender: formData.gender,
                age: formData.age,
                description: formData.description,
              }}
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
  onGenerateAnchor,
  isGenerating,
}: {
  character: CharacterListItem;
  onStartEdit: () => void;
  onDelete: () => void;
  /** 一键补拍定妆照（打开 AI 生成弹窗，纯 AI 生成分支） */
  onGenerateAnchor: () => void;
  isGenerating: boolean;
}) {
  const finalized = isCharacterFinalized(character);
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg font-semibold">{character.name}</h3>
          {/* 已定稿徽标（批次 2 · 1.5）：canonicalImageUrl 非空即已确认定妆照 */}
          {finalized && (
            <span
              className="text-agent flex items-center gap-0.5 text-[10px] font-medium"
              title="已定稿：已确认定妆照，可放心用于跨镜头出图"
            >
              <BadgeCheck size={13} />
              已定稿
            </span>
          )}
          {/* 未定稿警示（包 B · B4）：此前只在成功后显示绿标，没做的角色
              没有任何提示——用户根本不知道自己漏了一步。用「定妆照」而不是
              「三视图」（后者只在已生成的三联区出现，新手没见过这个词）。 */}
          {!finalized && (
            <span
              className="text-primary flex items-center gap-0.5 text-[10px] font-medium"
              title="没有定妆照时，这个角色在不同镜头里会长得不一样"
            >
              <AlertTriangle size={12} />
              缺定妆照
            </span>
          )}
        </div>
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
      {/* 缺定妆照的后果 + 一键补拍入口（包 B · B4）：讲清「为什么重要」，
          并直接给操作出口，不让用户自己去找右上角那个魔杖图标。
          走与图片区魔杖同一个入口（AI 生成弹窗，纯 AI 生成分支），
          弹窗内已明码标价积分，不在此处静默消费。 */}
      {!finalized && (
        <div className="border-primary/30 bg-primary/10 mt-3 rounded-lg border p-2">
          <p className="text-muted-foreground text-xs">
            还没有定妆照。定妆照是这个角色在所有画面里的长相基准，
            缺了它，同一个人在不同镜头会长得不一样。
          </p>
          <button
            type="button"
            onClick={onGenerateAnchor}
            disabled={isGenerating}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 flex items-center gap-1 rounded px-2 py-1 text-xs transition disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Wand2 size={12} />
            )}
            拍定妆照
          </button>
        </div>
      )}
    </>
  );
}

/**
 * 定妆照选择控件（批 5 · H1）：已是定妆照时显示选中态徽标（不可点），
 * 否则显示「设为定妆照」按钮。
 *
 * 同一控件复用在主图轮播与三视图三联两处，保证两处对「谁是定妆照」的
 * 呈现与操作完全一致（全局一致性：展示定妆状态的位置必须都能改）。
 */
function CanonicalToggle({
  imageUrl,
  isCanonical,
  pending,
  disabled,
  onSetCanonical,
  className = "",
  compact = false,
}: {
  imageUrl: string;
  isCanonical: boolean;
  /** 本张正在提交 */
  pending: boolean;
  /** 同卡内有别的张在提交（避免并发改锚互相覆盖） */
  disabled: boolean;
  onSetCanonical: () => void;
  className?: string;
  /** 三视图小格用紧凑尺寸 */
  compact?: boolean;
}) {
  const sizeCls = compact
    ? "px-1.5 py-0.5 text-[9px] gap-0.5"
    : "px-2 py-1 text-[10px] gap-1";
  const iconSize = compact ? 9 : 11;

  if (isCanonical) {
    return (
      <span
        className={`bg-agent text-agent-foreground pointer-events-none flex items-center rounded font-medium backdrop-blur-sm ${sizeCls} ${className}`}
        title="当前定妆照：所有镜头以这张为长相基准"
      >
        <Star size={iconSize} className="fill-current" />
        定妆照
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onSetCanonical}
      disabled={disabled}
      title={`把这张设为定妆照（${imageUrl.split("/").pop() ?? "当前图片"}）`}
      className={`text-foreground flex items-center rounded bg-black/60 font-medium backdrop-blur-sm transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-50 ${sizeCls} ${className}`}
    >
      {pending ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        <Star size={iconSize} />
      )}
      设为定妆照
    </button>
  );
}

/**
 * 三视图三联展示：把 front/side/back 三张转面图独立横排展示，
 * 与普通参考图轮播区分，一眼看出是角色定妆/锁形象图。
 * 无三视图（任一角度缺失）时不渲染。
 *
 * 每格带「设为定妆照」（批 5 · H1）：线上真实问题正是干净的正面三视图当不上
 * 定妆锚（锚位被更早生成的多格设定拼贴图占住），这里给出直接的改锚出口。
 */
function ThreeViewStrip({
  character,
  onSetCanonical,
  settingCanonicalUrl,
}: {
  character: CharacterListItem;
  onSetCanonical: (characterId: string, imageUrl: string) => void;
  settingCanonicalUrl: string | null;
}) {
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
                <>
                  <img
                    src={it.url}
                    alt={it.label}
                    className="h-full w-full object-cover"
                  />
                  <CanonicalToggle
                    imageUrl={it.url}
                    isCanonical={character.canonicalImageUrl === it.url}
                    pending={settingCanonicalUrl === it.url}
                    disabled={settingCanonicalUrl !== null}
                    onSetCanonical={() =>
                      onSetCanonical(character.id, it.url as string)
                    }
                    className="absolute top-1 left-1"
                    compact
                  />
                </>
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
      {/* H3 参考图质量提示：拼贴/多格图当定妆锚是容易重犯的错（模型不知复现哪个
          视角），这里讲清什么样的图适合。不做校验——无法可靠自动判断拼贴图。 */}
      <p className="text-muted-foreground/70 mt-2 text-[10px] leading-relaxed">
        定妆照建议选：单人、正面全身、纯色背景、无多格拼贴、无文字标注。
      </p>
    </div>
  );
}

/**
 * 表情集展示：把已生成的表情图按固定顺序横排，一眼看出缺哪几种。
 *
 * 与三视图分开展示（而非混进参考图轮播）：表情图是胸上特写，语义上属于
 * 「同一角色的不同演绎」而非「不同参考角度」，混在一起用户分不清该拿哪张当定妆照。
 *
 * 刻意**不提供**「设为定妆照」入口：定妆锚是全身立绘语义，拿一张表情特写当锚
 * 会让所有全身镜失去身体参考（服务端落库时也把表情图恒置 isCanonical=false）。
 *
 * 一张表情图都没有时不渲染（避免给未用此功能的角色平添 6 个空格子）。
 */
function ExpressionStrip({ character }: { character: CharacterListItem }) {
  const sheet = extractExpressionSheet(character.referenceAssets);
  const generated = EXPRESSION_SPECS.filter((s) => sheet[s.key]);
  if (generated.length === 0) return null;

  return (
    <div className="border-border border-t px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          角色表情集
        </span>
        <span className="text-muted-foreground/60 text-[10px]">
          锁表情画法 · 出图按分镜情绪自动选用
        </span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {EXPRESSION_SPECS.map((spec) => {
          const url = sheet[spec.key];
          return (
            <div key={spec.key} className="space-y-1">
              <div className="bg-secondary relative aspect-square overflow-hidden rounded-md">
                {url ? (
                  <img
                    src={url}
                    alt={spec.label}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground/50 flex h-full w-full items-center justify-center text-[9px]">
                    缺
                  </div>
                )}
              </div>
              <p className="text-muted-foreground text-center text-[9px]">
                {spec.label}
              </p>
            </div>
          );
        })}
      </div>
      {generated.length < EXPRESSION_SPECS.length && (
        <p className="text-muted-foreground/70 mt-2 text-[10px] leading-relaxed">
          已生成 {generated.length}/{EXPRESSION_SPECS.length} 种；
          缺失的表情在出图时回落定妆照，画法可能逐镜漂移。
        </p>
      )}
    </div>
  );
}
