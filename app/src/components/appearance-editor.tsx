"use client";

import { useState } from "react";
import { Plus, X, Sparkles, Loader2 } from "lucide-react";
import type { CharacterAppearance, ClothingPreset } from "@/types";
import { draftAppearance } from "@/lib/assist-client";
import { useToast } from "@/components/ui/toast";
import { APPEARANCE_PRESETS } from "@/lib/prompts/appearance-draft";

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
  // 美术工业一致性 6 项：人眼判断「是不是同一个角色」的实际依据
  defaultOutfit: string;
  outfitDetails: string;
  headToBodyRatio: string;
  hairParting: string;
  eyeHighlight: string;
  asymmetry: string;
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
  defaultOutfit: "",
  outfitDetails: "",
  headToBodyRatio: "",
  hairParting: "",
  eyeHighlight: "",
  asymmetry: "",
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
    defaultOutfit: appearance.defaultOutfit || "",
    outfitDetails: appearance.outfitDetails || "",
    headToBodyRatio: appearance.headToBodyRatio || "",
    hairParting: appearance.hairParting || "",
    eyeHighlight: appearance.eyeHighlight || "",
    asymmetry: appearance.asymmetry || "",
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

  // 文本字段从 EMPTY_APPEARANCE 的键集派生，而非手写枚举——新增外貌字段时
  // 漏改这里会让 AI 起草的值被静默丢弃（表单看起来没填、用户无从察觉）。
  const mergedText = Object.fromEntries(
    (Object.keys(EMPTY_APPEARANCE) as (keyof AppearanceFormData)[])
      .filter((key) => key !== "clothingPresets")
      .map((key) => [key, pick(key)])
  ) as Omit<AppearanceFormData, "clothingPresets">;

  return {
    merged: { ...mergedText, clothingPresets },
    filledCount,
  };
}

/** 折叠区内的字段集（单一真源：展开判定与 AI 起草后的自动展开共用） */
const ADVANCED_FIELDS = [
  "headToBodyRatio",
  "hairParting",
  "eyeHighlight",
  "asymmetry",
] as const satisfies readonly (keyof AppearanceFormData)[];

/** 折叠区是否已有值——有值就必须展开，否则填过的内容被藏起来等同于没填 */
export function hasAdvancedValue(data: AppearanceFormData): boolean {
  return ADVANCED_FIELDS.some((field) => data[field].trim() !== "");
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
// 分缝/高光选项与 AI 起草 prompt 同源（APPEARANCE_PRESETS），改一处即可
const HAIR_PARTINGS = [...APPEARANCE_PRESETS.hairParting];
const EYE_HIGHLIGHTS = [...APPEARANCE_PRESETS.eyeHighlight];

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
  // 已填过任一高级项时默认展开——否则用户/AI 填过的值被折叠藏起来，等同于没填
  const [showAdvanced, setShowAdvanced] = useState(() =>
    hasAdvancedValue(value)
  );

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
      // AI 可能填进折叠区的字段，此时必须展开——否则用户看不到这些值也改不了
      if (hasAdvancedValue(merged)) setShowAdvanced(true);
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
      {/* 常服 + 服装标志物：服装是每张原画的默认约束，填写价值最高，故放主区 */}
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="text-muted-foreground mb-1 block text-xs">
          常服（每张原画的默认服装）
        </label>
        <textarea
          value={value.defaultOutfit}
          onChange={(e) => update("defaultOutfit", e.target.value)}
          placeholder="含层次+材质+主色，如：白色棉质衬衫内搭，藏青色羊毛开衫外套"
          rows={2}
          className="border-border bg-card focus:border-primary w-full resize-none rounded border px-2 py-1 text-sm focus:outline-none"
        />
      </div>
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="text-muted-foreground mb-1 block text-xs">
          服装标志物
        </label>
        <input
          type="text"
          value={value.outfitDetails}
          onChange={(e) => update("outfitDetails", e.target.value)}
          placeholder="如：左胸口银色校徽、袖口三道白线、棕色皮质窄腰带"
          className="border-border bg-card focus:border-primary w-full rounded border px-2 py-1 text-sm focus:outline-none"
        />
      </div>

      {/* 高级选项：头身比/分缝/高光/不对称特征。
          这四项是美术判断「是不是同一个角色」的高频线索，但对新手概念门槛较高，
          折叠起来避免主表单过长；已填过任一项时默认展开，防止填过的值被藏起来。 */}
      <div className={compact ? "mb-2" : "mb-3"}>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
        >
          {showAdvanced ? "▾" : "▸"} 高级一致性选项（头身比/分缝/高光/不对称）
        </button>
        {showAdvanced && (
          <div className="border-border mt-2 space-y-2 rounded border p-2">
            <div className={compact ? "mb-2" : "mb-3"}>
              <label className="text-muted-foreground mb-1 block text-xs">
                头身比
              </label>
              <input
                type="text"
                value={value.headToBodyRatio}
                onChange={(e) => update("headToBodyRatio", e.target.value)}
                placeholder="如：7.5 或 7-7.5（留空则按画风默认区间）"
                className="border-border bg-card focus:border-primary w-full rounded border px-2 py-1 text-sm focus:outline-none"
              />
            </div>
            {renderChips("hairParting", HAIR_PARTINGS, "分缝位置")}
            {renderChips("eyeHighlight", EYE_HIGHLIGHTS, "瞳孔高光")}
            <div className={compact ? "mb-2" : "mb-3"}>
              <label className="text-muted-foreground mb-1 block text-xs">
                不对称特征
              </label>
              <input
                type="text"
                value={value.asymmetry}
                onChange={(e) => update("asymmetry", e.target.value)}
                placeholder="只在单侧出现的记号，如：左耳银色耳环、右眼下泪痣"
                className="border-border bg-card focus:border-primary w-full rounded border px-2 py-1 text-sm focus:outline-none"
              />
            </div>
          </div>
        )}
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
