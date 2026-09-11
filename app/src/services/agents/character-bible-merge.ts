/**
 * 角色圣经"只补空字段"合并决策（纯函数，无 prisma 依赖，全量单测覆盖）。
 *
 * 从 character-bible-persist.ts 拆出，避免测试纯决策逻辑时被 prisma 的
 * DATABASE_URL 门槛卡住。持久化侧（persistCharacterBible）import 这里的决策函数。
 *
 * 核心不变量：回写角色画像时**绝不覆盖用户手改数据**——现有字段非空即保留。
 */

import { Prisma } from "@prisma/client";
import type { CharacterBibleEntry } from "./types";

/**
 * bible 的 appearance 字段值可能是 male / female / unknown / 空。
 * "unknown" 与空值视为"无有效信息"，归一为 null（不写库，避免占用/覆盖字段）。
 */
export function normalizeBibleValue(
  raw: string | undefined | null
): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v.toLowerCase() === "unknown") return null;
  return v;
}

/** Character 顶层可空文本字段（gender/age/description）的当前值形状 */
export interface CharacterNullableFields {
  gender: string | null;
  age: string | null;
  description: string | null;
}

/**
 * "只补空字段"决策（纯函数）：现有值为 null/空白时才用 bible 值填充，
 * 否则保留现有值（绝不覆盖用户手改数据）。返回仅含需写入字段的补丁；
 * 无任何字段需要补时返回空对象（调用方据此跳过 update）。
 */
export function mergeNullableFields(
  current: CharacterNullableFields,
  bible: {
    gender: string | null;
    age: string | null;
    description: string | null;
  }
): Partial<CharacterNullableFields> {
  const patch: Partial<CharacterNullableFields> = {};
  // 现有值为空白（null / "" / 纯空格）时才补
  if (!current.gender?.trim() && bible.gender) patch.gender = bible.gender;
  if (!current.age?.trim() && bible.age) patch.age = bible.age;
  if (!current.description?.trim() && bible.description) {
    patch.description = bible.description;
  }
  return patch;
}

/** CharacterAppearance 结构化字段（本模块写入的子集） */
export interface AppearanceFields {
  hairStyle: string | null;
  hairColor: string | null;
  faceShape: string | null;
  eyeColor: string | null;
  bodyType: string | null;
  skinTone: string | null;
  height: string | null;
  accessories: string | null;
  /** 常服：圣经产出的 clothing 落此字段（专列，不再降级挤进 freeText） */
  defaultOutfit: string | null;
  freeText: string | null;
}

/**
 * bible.appearance → CharacterAppearance 字段映射（纯函数）。
 *
 * clothing 落 defaultOutfit（常服专列）。此前它被降级塞进 freeText，导致用户只要
 * 填过 freeText（如「有一道疤，气质冷淡」），圣经推断出的服装信息就被永久丢弃——
 * 而常服恰恰是每张原画的默认约束，丢失后模型每镜自行编服装。
 * bible 值为 "unknown" / 空时归一为 null（不写无意义占位）。
 */
export function bibleAppearanceToFields(
  appearance: CharacterBibleEntry["appearance"]
): Omit<AppearanceFields, "freeText" | "defaultOutfit"> & {
  clothing: string | null;
} {
  return {
    hairStyle: normalizeBibleValue(appearance.hairStyle),
    hairColor: normalizeBibleValue(appearance.hairColor),
    faceShape: normalizeBibleValue(appearance.faceShape),
    eyeColor: normalizeBibleValue(appearance.eyeColor),
    bodyType: normalizeBibleValue(appearance.bodyType),
    skinTone: normalizeBibleValue(appearance.skinTone),
    height: normalizeBibleValue(appearance.height),
    accessories: normalizeBibleValue(appearance.accessories),
    clothing: normalizeBibleValue(appearance.clothing),
  };
}

/**
 * "只补空外貌字段"决策（纯函数）：现有 appearance 各字段为 null 时才用 bible 值补。
 * 返回仅含需写入字段的补丁；无补返回空对象。clothing 走 defaultOutfit（常服专列，
 * 现有 defaultOutfit 为空时才写，不再与用户手填的 freeText 争同一个槽位）。
 */
export function mergeAppearanceFields(
  current: Partial<AppearanceFields> & { freeText?: string | null },
  bible: ReturnType<typeof bibleAppearanceToFields>
): Prisma.CharacterAppearanceUpdateInput {
  const patch: Prisma.CharacterAppearanceUpdateInput = {};
  const fill = (
    key: keyof AppearanceFields,
    currentVal: string | null | undefined,
    bibleVal: string | null
  ) => {
    if (!currentVal?.trim() && bibleVal) {
      (patch as Record<string, unknown>)[key] = bibleVal;
    }
  };
  fill("hairStyle", current.hairStyle, bible.hairStyle);
  fill("hairColor", current.hairColor, bible.hairColor);
  fill("faceShape", current.faceShape, bible.faceShape);
  fill("eyeColor", current.eyeColor, bible.eyeColor);
  fill("bodyType", current.bodyType, bible.bodyType);
  fill("skinTone", current.skinTone, bible.skinTone);
  fill("height", current.height, bible.height);
  fill("accessories", current.accessories, bible.accessories);
  // clothing 落 defaultOutfit（常服专列，现有值为空才补），与其余字段同一套 fill 语义
  fill("defaultOutfit", current.defaultOutfit, bible.clothing);
  return patch;
}

/** 新建 CharacterAppearance 的完整字段（未命中角色时用） */
export function buildNewAppearanceData(
  bible: ReturnType<typeof bibleAppearanceToFields>
): Omit<Prisma.CharacterAppearanceCreateWithoutCharacterInput, "id"> {
  return {
    hairStyle: bible.hairStyle,
    hairColor: bible.hairColor,
    faceShape: bible.faceShape,
    eyeColor: bible.eyeColor,
    bodyType: bible.bodyType,
    skinTone: bible.skinTone,
    height: bible.height,
    accessories: bible.accessories,
    // clothing 落 defaultOutfit（常服专列），不进 freeText、也不进 clothingPresets 结构化表
    defaultOutfit: bible.clothing,
  };
}
