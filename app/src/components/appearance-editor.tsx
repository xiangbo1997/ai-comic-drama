"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { CharacterAppearance, ClothingPreset } from "@/types";

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
}

export function AppearanceEditor({
  value,
  onChange,
  compact = false,
}: AppearanceEditorProps) {
  const [showAddClothing, setShowAddClothing] = useState(false);
  const [newClothingName, setNewClothingName] = useState("");
  const [newClothingDesc, setNewClothingDesc] = useState("");

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
      <label className="mb-1 block text-xs text-gray-400">{label}</label>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => update(field, value[field] === opt ? "" : opt)}
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              value[field] === opt
                ? "border-blue-500 bg-blue-600 text-white"
                : "border-gray-600 bg-gray-800 text-gray-300 hover:border-gray-400"
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
        <label className="mb-1 block text-xs text-gray-400">身高</label>
        <input
          type="text"
          value={value.height}
          onChange={(e) => update("height", e.target.value)}
          placeholder="如：170cm"
          className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="mb-1 block text-xs text-gray-400">饰品/配件</label>
        <input
          type="text"
          value={value.accessories}
          onChange={(e) => update("accessories", e.target.value)}
          placeholder="如：圆框眼镜、红色围巾"
          className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className={compact ? "mb-2" : "mb-3"}>
        <label className="mb-1 block text-xs text-gray-400">补充描述</label>
        <textarea
          value={value.freeText}
          onChange={(e) => update("freeText", e.target.value)}
          placeholder="其他外貌特征补充"
          rows={2}
          className="w-full resize-none rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Clothing Presets */}
      <div className={compact ? "mb-2" : "mb-3"}>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-gray-400">服装预设</label>
          <button
            type="button"
            onClick={() => setShowAddClothing(true)}
            className="flex items-center gap-0.5 text-[10px] text-blue-400 hover:text-blue-300"
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
                className="flex items-center gap-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs"
              >
                <span className="font-medium text-gray-200">{preset.name}</span>
                {preset.description && (
                  <span className="flex-1 truncate text-gray-500">
                    — {preset.description}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeClothingPreset(idx)}
                  className="ml-auto flex-shrink-0 text-gray-500 hover:text-red-400"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {showAddClothing && (
          <div className="space-y-1.5 rounded border border-gray-700 bg-gray-800/80 p-2">
            <input
              type="text"
              value={newClothingName}
              onChange={(e) => setNewClothingName(e.target.value)}
              placeholder="名称（如：校服、战甲）"
              className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={newClothingDesc}
              onChange={(e) => setNewClothingDesc(e.target.value)}
              placeholder="描述（如：深蓝色西装外套配白衬衫）"
              className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setShowAddClothing(false)}
                className="px-2 py-0.5 text-[10px] text-gray-400 hover:text-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={addClothingPreset}
                className="rounded bg-blue-600 px-2 py-0.5 text-[10px] text-white hover:bg-blue-700"
              >
                添加
              </button>
            </div>
          </div>
        )}
        {value.clothingPresets.length === 0 && !showAddClothing && (
          <p className="text-[10px] text-gray-600">暂无服装预设</p>
        )}
      </div>
    </div>
  );
}
