"use client";

import { useState } from "react";
import { Plus, X, Sparkles, Loader2 } from "lucide-react";
import type { CharacterAppearance, ClothingPreset } from "@/types";
import { draftAppearance } from "@/lib/assist-client";
import { useToast } from "@/components/ui/toast";

/** 外貌编辑器用的表单数据（不含 id/characterId） */
export interface AppearanceFormData {
  hairStyle: string;
  hairColor: string;
  faceShape: string;
  eyeColor: string;
  bodyType: string;
  height: string;
  skinTone: string;
  accessories: string;
  freeText: string;
  clothingPresets: ClothingPreset[];
}

const EMPTY_APPEARANCE: AppearanceFormData = {
  hairStyle: "",
  hairColor: "",
  faceShape: "",
  eyeColor: "",
  bodyType: "",
  height: "",
  skinTone: "",
  accessories: "",
  freeText: "",
  clothingPresets: [],
};

export function toAppearanceFormData(
  appearance?: CharacterAppearance | null
): AppearanceFormData {
  if (!appearance) return { ...EMPTY_APPEARANCE };
  return {
    hairStyle: appearance.hairStyle || "",
    hairColor: appearance.hairColor || "",
    faceShape: appearance.faceShape || "",
    eyeColor: appearance.eyeColor || "",
    bodyType: appearance.bodyType || "",
    height: appearance.height || "",
    skinTone: appearance.skinTone || "",
    accessories: appearance.accessories || "",
    freeText: appearance.freeText || "",
    clothingPresets:
      (appearance.clothingPresets as ClothingPreset[] | null) || [],
  };
}

export function isAppearanceEmpty(data: AppearanceFormData): boolean {
  return Object.entries(data).every(([key, v]) => {
    if (key === "clothingPresets") return (v as ClothingPreset[]).length === 0;
    return !(v as string).trim();
  });
}

/**
 * 用 AI 起草结果「只填空字段」地合并进当前外貌表单（批次 1 · 1.2 交互原则 3）。
 *
 * 返回 { merged, filledCount }：
 * - merged：只把 current 中为空的字段用 draft 补上，用户已填的字段一律不覆盖（不可变构造新对象）；
 * - filledCount：本次实际填入的字段数，供调用方判断「已填写完整」给对应提示。
 */
export function mergeAppearanceDraft(
  current: AppearanceFormData,
  draft: Partial<AppearanceFormData>
): { merged: AppearanceFormData; filledCount: number } {
  let filledCount = 0;

  const pick = (field: keyof AppearanceFormData): string => {
    const cur = (current[field] as string) || "";
    if (cur.trim()) return cur; // 用户已填 → 保留
    const next = ((draft[field] as string) || "").trim();
    if (next) {
      filledCount += 1;
      return next;
    }
    return cur;
  };

  const clothingPresets =
    current.clothingPresets.length > 0
      ? current.clothingPresets // 用户已有服装 → 不动
      : (() => {
          const drafted = draft.clothingPresets ?? [];
          if (drafted.length > 0) filledCount += 1;
          return drafted;
        })();

  return {
    merged: {
      hairStyle: pick("hairStyle"),
      hairColor: pick("hairColor"),
      faceShape: pick("faceShape"),
      eyeColor: pick("eyeColor"),
      bodyType: pick("bodyType"),
      height: pick("height"),
      skinTone: pick("skinTone"),
      accessories: pick("accessories"),
      freeText: pick("freeText"),
      clothingPresets,
    },
    filledCount,
  };
}

const HAIR_STYLES = [
  "短发",
  "长直发",
  "长卷发",
  "马尾",
  "双马尾",
  "丸子头",
  "波浪卷",
  "齐刘海",
  "寸头",
  "中分",
];
const HAIR_COLORS = [
  "黑色",
  "棕色",
  "金色",
  "红色",
  "白色",
  "银灰",
  "蓝色",
  "粉色",
  "渐变",
];
const FACE_SHAPES = ["瓜子脸", "圆脸", "鹅蛋脸", "方脸", "心形脸", "长脸"];
const EYE_COLORS = ["黑色", "棕色", "蓝色", "绿色", "灰色", "琥珀色", "紫色"];
const BODY_TYPES = ["纤细", "标准", "健壮", "丰满", "高挑纤细", "娇小"];
const SKIN_TONES = ["白皙", "自然肤色", "小麦色", "古铜色", "深色"];

interface AppearanceEditorProps {
  value: AppearanceFormData;
  onChange: (data: AppearanceFormData) => void;
  compact?: boolean;
  /**
   * 角色上下文（供「✨ AI 分析填写」按钮起草外貌用）。
   * 传入且 name 非空时才显示按钮；不传则按钮隐藏（向后兼容旧调用）。
   */
  characterContext?: {
    name: string;
    gender?: string;
    age?: string;
    description?: string;
  };
}

export function AppearanceEditor({
  value,
  onChange,
  compact = false,
  characterContext,
}: AppearanceEditorProps) {
  const toast = useToast();
  const [showAddClothing, setShowAddClothing] = useState(false);
  const [newClothingName, setNewClothingName] = useState("");
  const [newClothingDesc, setNewClothingDesc] = useState("");
  const [drafting, setDrafting] = useState(false);

  const canDraft = !!characterContext?.name.trim();

  // AI 分析填写：只填空字段，用户已填的不覆盖；全部已填时提示先清空
  const handleAIDraft = async () => {
    if (!characterContext?.name.trim() || drafting) return;
    setDrafting(true);
    try {
      const draft = await draftAppearance({
        name: characterContext.name.trim(),
        gender: characterContext.gender,
        age: characterContext.age,
        description: characterContext.description,
      });
      const { merged, filledCount } = mergeAppearanceDraft(value, draft);
      if (filledCount === 0) {
        toast.info("外貌已填写完整，如需重填请先清空对应字段");
        return;
      }
      onChange(merged);
      toast.success(`AI 已填入 ${filledCount} 个空字段，可继续修改`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "外貌预填失败");
    } finally {
      setDrafting(false);
    }
  };

  const update = (
    field: keyof AppearanceFormData,
    val: string | ClothingPreset[]
  ) => {
    onChange({ ...value, [field]: val });
  };

  const addClothingPreset = () => {
    if (!newClothingName.trim()) return;
    const preset: ClothingPreset = {
      name: newClothingName.trim(),
      description: newClothingDesc.trim(),
    };
    update("clothingPresets", [...value.clothingPresets, preset]);
    setNewClothingName("");
    setNewClothingDesc("");
    setShowAddClothing(false);
  };

  const removeClothingPreset = (index: number) => {
    update(
      "clothingPresets",
      value.clothingPresets.filter((_, i) => i !== index)
    );
  };

  const renderChips = (
    field: keyof AppearanceFormData,
    options: string[],
    label: string
  ) => (
    <div className={compact ? "mb-2" : "mb-3"}>
      <label className="text-muted-foreground mb-1 block text-xs">
        {label}
      </label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => update(field, value[field] === opt ? "" : opt)}
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              value[field] === opt
                ? "border-primary bg-primary text-foreground"
                : "border-border bg-card text-foreground hover:border-muted-foreground"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      {canDraft && (
        <button
          type="button"
          onClick={handleAIDraft}
          disabled={drafting}
          className="border-agent/40 bg-agent/10 text-agent hover:bg-agent/20 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-60"
          title="根据角色名/性别/年龄/描述，AI 推断填入下方空字段"
        >
          {drafting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          {drafting ? "AI 分析中..." : "✨ AI 分析填写（只填空字段）"}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>{renderChips("hairStyle", HAIR_STYLES, "发型")}</div>
        <div>{renderChips("hairColor", HAIR_COLORS, "发色")}</div>
      </div>
      {renderChips("faceShape", FACE_SHAPES, "脸型")}
      <div className="grid grid-cols-2 gap-2">
        <div>{renderChips("eyeColor", EYE_COLORS, "瞳色")}</div>
        <div>{renderChips("skinTone", SKIN_TONES, "肤色")}</div>
      </div>
      {renderChips("bodyType", BODY_TYPES, "体型")}
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="text-muted-foreground mb-1 block text-xs">身高</label>
        <input
          type="text"
          value={value.height}
          onChange={(e) => update("height", e.target.value)}
          placeholder="如：170cm"
          className="border-border bg-card focus:border-primary w-full rounded border px-2 py-1 text-sm focus:outline-none"
        />
      </div>
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="text-muted-foreground mb-1 block text-xs">
          饰品/配件
        </label>
        <input
          type="text"
          value={value.accessories}
          onChange={(e) => update("accessories", e.target.value)}
          placeholder="如：圆框眼镜、红色围巾"
          className="border-border bg-card focus:border-primary w-full rounded border px-2 py-1 text-sm focus:outline-none"
        />
      </div>
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="text-muted-foreground mb-1 block text-xs">
          补充描述
        </label>
        <textarea
          value={value.freeText}
          onChange={(e) => update("freeText", e.target.value)}
          placeholder="其他外貌特征补充"
          rows={2}
          className="border-border bg-card focus:border-primary w-full resize-none rounded border px-2 py-1 text-sm focus:outline-none"
        />
      </div>

      {/* Clothing Presets */}
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-muted-foreground text-xs">服装预设</label>
          <button
            type="button"
            onClick={() => setShowAddClothing(true)}
            className="text-primary hover:text-primary/80 flex items-center gap-0.5 text-[10px]"
          >
            <Plus size={10} />
            添加
          </button>
        </div>
        {value.clothingPresets.length > 0 && (
          <div className="mb-2 space-y-1">
            {value.clothingPresets.map((preset, idx) => (
              <div
                key={idx}
                className="border-border bg-card flex items-center gap-1 rounded border px-2 py-1 text-xs"
              >
                <span className="text-foreground font-medium">
                  {preset.name}
                </span>
                {preset.description && (
                  <span className="text-muted-foreground flex-1 truncate">
                    — {preset.description}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeClothingPreset(idx)}
                  className="text-muted-foreground ml-auto flex-shrink-0 hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {showAddClothing && (
          <div className="border-border bg-card/80 space-y-1.5 rounded border p-2">
            <input
              type="text"
              value={newClothingName}
              onChange={(e) => setNewClothingName(e.target.value)}
              placeholder="名称（如：校服、战甲）"
              className="border-border bg-background focus:border-primary w-full rounded border px-2 py-1 text-xs focus:outline-none"
            />
            <input
              type="text"
              value={newClothingDesc}
              onChange={(e) => setNewClothingDesc(e.target.value)}
              placeholder="描述（如：深蓝色西装外套配白衬衫）"
              className="border-border bg-background focus:border-primary w-full rounded border px-2 py-1 text-xs focus:outline-none"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setShowAddClothing(false)}
                className="text-muted-foreground hover:text-foreground px-2 py-0.5 text-[10px]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={addClothingPreset}
                className="bg-primary text-foreground hover:bg-primary/90 rounded px-2 py-0.5 text-[10px]"
              >
                添加
              </button>
            </div>
          </div>
        )}
        {value.clothingPresets.length === 0 && !showAddClothing && (
          <p className="text-muted-foreground text-[10px]">暂无服装预设</p>
        )}
      </div>
    </div>
  );
}
