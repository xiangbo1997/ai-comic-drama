"use client";

import { z } from "zod";
import { Plus, Trash2, Clapperboard, Users } from "lucide-react";
import { ScriptZ, type SvScript } from "@/lib/short-video/contracts";
import { parseScriptInput } from "@/lib/short-video/creation";

const fieldClass =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2";
const secondaryClass =
  "border-border hover:bg-muted focus-visible:ring-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2 disabled:opacity-50";

// 编辑中的必填文本可以暂时为空；最终保存仍必须通过完整 ScriptZ 合同。
const EditableScriptZ = z.object({
  ...ScriptZ.shape,
  title: z.string(),
  hook: z.string(),
  premise: z.string(),
  targetDurationSec: z.number(),
  characters: z.array(
    ScriptZ.shape.characters.element.extend({
      name: z.string(),
      appearance: z.string(),
    })
  ),
  shots: z.array(
    ScriptZ.shape.shots.element.extend({
      durationSec: z.number(),
      description: z.string(),
      imagePrompt: z.string(),
      videoPrompt: z.string(),
    })
  ),
});

function Field({
  label,
  value,
  onChange,
  multiline = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {multiline ? (
        <textarea
          className={`${fieldClass} min-h-20 resize-y`}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={fieldClass}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

const fieldNames: Record<string, string> = {
  title: "标题",
  hook: "开场钩子",
  premise: "故事设定",
  targetDurationSec: "目标时长",
  characters: "角色",
  shots: "镜头",
  description: "画面与动作",
  imagePrompt: "首帧画面",
  videoPrompt: "视频动作",
  name: "名称",
  appearance: "外观",
  durationSec: "秒数",
  hashtags: "话题",
};
export function scriptValidationMessage(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const result = ScriptZ.safeParse(parseScriptInput(value));
    if (result.success) return null;
    return result.error.issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path
          .map((key) =>
            typeof key === "number"
              ? String(key + 1)
              : fieldNames[String(key)] || String(key)
          )
          .join(" · ");
        const message =
          issue.code === "too_small"
            ? "请补全内容并检查最小值"
            : issue.code === "too_big"
              ? "内容或数值超出限制"
              : issue.message;
        return path ? `${path}：${message}` : message;
      })
      .join("；");
  } catch {
    return "JSON 格式不正确，请在高级编辑中检查引号与逗号";
  }
}

function emptyShot(key: string, durationSec = 10): SvScript["shots"][number] {
  return {
    key,
    durationSec,
    description: "",
    imagePrompt: "",
    videoPrompt: "",
    dialogue: "",
    narration: "",
    subtitle: "",
    characterKeys: [],
  };
}

export function ScriptEditor({
  value,
  onChange,
  title,
  brief,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  title: string;
  brief: string;
  disabled: boolean;
}) {
  let draft: SvScript | null = null;
  try {
    const parsed = EditableScriptZ.safeParse(parseScriptInput(value));
    if (parsed.success) draft = parsed.data;
  } catch {
    // JSON 高级模式允许保留临时不完整内容，不覆盖用户输入。
  }
  const update = (next: SvScript) => onChange(JSON.stringify(next, null, 2));
  const validation = scriptValidationMessage(value);
  const script = draft;
  return (
    <div className="min-w-0 space-y-4">
      {!value && (
        <div className="bg-muted/40 rounded-xl border border-dashed p-5">
          <Clapperboard className="text-primary mb-3 size-6" aria-hidden />
          <p className="font-medium">把一个笑点，拆成两个镜头</p>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            先写开场与反转，再补画面、动作和台词。默认 20 秒竖屏，可随时调整。
            {brief &&
              "参考简报已完整保留在上方与导出提示词中，故事设定请只写本片剧情。"}
          </p>
          <button
            type="button"
            className={secondaryClass}
            disabled={disabled}
            onClick={() =>
              update({
                schemaVersion: 1,
                title: title.slice(0, 80),
                hook: "",
                premise: "",
                targetDurationSec: 20,
                aspectRatio: "9:16",
                characters: [],
                shots: [emptyShot("s1"), emptyShot("s2")],
                ending: "",
                suggestedCaption: "",
                hashtags: [],
              })
            }
          >
            <Plus className="size-4" aria-hidden /> 创建两镜脚本
          </button>
        </div>
      )}
      {script && (
        <fieldset disabled={disabled} className="min-w-0 space-y-5">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field
              label="脚本标题"
              value={script.title}
              maxLength={80}
              onChange={(title) => update({ ...script, title })}
            />
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">目标时长（秒）</span>
              <input
                type="number"
                min={15}
                max={30}
                className={fieldClass}
                value={script.targetDurationSec}
                onChange={(event) =>
                  update({
                    ...script,
                    targetDurationSec: Number(event.target.value),
                  })
                }
              />
            </label>
            <Field
              label="开场钩子"
              value={script.hook}
              maxLength={500}
              onChange={(hook) => update({ ...script, hook })}
              multiline
            />
            <Field
              label="故事设定"
              value={script.premise}
              maxLength={1000}
              onChange={(premise) => update({ ...script, premise })}
              multiline
            />
          </div>
          <details
            className="border-border rounded-xl border p-4"
            open={script.characters.length > 0}
          >
            <summary className="cursor-pointer text-sm font-medium">
              <Users className="mr-2 inline size-4" aria-hidden />
              角色设定 · {script.characters.length} 个
            </summary>
            <p className="text-muted-foreground mt-3 text-xs">
              需要保持一致的角色在这里定义，再勾选出场镜头。纯物件场景可留空。
            </p>
            <div className="mt-3 space-y-3">
              {script.characters.map((character, index) => (
                <div
                  key={character.key}
                  className="bg-muted/30 space-y-3 rounded-lg p-3"
                >
                  <Field
                    label={`角色${index + 1} · 名称`}
                    value={character.name}
                    maxLength={80}
                    onChange={(name) =>
                      update({
                        ...script,
                        characters: script.characters.map((item, n) =>
                          n === index ? { ...item, name } : item
                        ),
                      })
                    }
                  />
                  <Field
                    label={`角色${index + 1} · 外观`}
                    value={character.appearance}
                    maxLength={1000}
                    multiline
                    onChange={(appearance) =>
                      update({
                        ...script,
                        characters: script.characters.map((item, n) =>
                          n === index ? { ...item, appearance } : item
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className={secondaryClass}
                    onClick={() =>
                      update({
                        ...script,
                        characters: script.characters.filter(
                          (_, n) => n !== index
                        ),
                        shots: script.shots.map((shot) => ({
                          ...shot,
                          characterKeys: shot.characterKeys.filter(
                            (key) => key !== character.key
                          ),
                        })),
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                    移除角色{index + 1}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={secondaryClass}
                disabled={script.characters.length >= 10}
                onClick={() =>
                  update({
                    ...script,
                    characters: [
                      ...script.characters,
                      { key: crypto.randomUUID(), name: "", appearance: "" },
                    ],
                  })
                }
              >
                <Plus className="size-4" aria-hidden />
                添加角色
              </button>
            </div>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              分镜 · {script.shots.length} / 5
            </p>
            <p
              className={
                script.shots.reduce(
                  (sum, shot) => sum + shot.durationSec,
                  0
                ) === script.targetDurationSec
                  ? "text-muted-foreground text-sm"
                  : "text-destructive text-sm"
              }
            >
              镜头合计{" "}
              {script.shots.reduce((sum, shot) => sum + shot.durationSec, 0)} 秒
              / 目标 {script.targetDurationSec} 秒
            </p>
          </div>
          <div className="space-y-4">
            {script.shots.map((shot, index) => {
              const setShot = (patch: Partial<SvScript["shots"][number]>) =>
                update({
                  ...script,
                  shots: script.shots.map((item, n) =>
                    n === index ? { ...item, ...patch } : item
                  ),
                });
              return (
                <section
                  key={shot.key}
                  className="border-border overflow-hidden rounded-xl border"
                >
                  <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                    <h3 className="font-medium">镜头 {index + 1}</h3>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive min-h-9 rounded px-2 text-sm disabled:opacity-40"
                      disabled={script.shots.length <= 1}
                      aria-label={`移除镜头${index + 1}`}
                      onClick={() =>
                        update({
                          ...script,
                          shots: script.shots.filter((_, n) => n !== index),
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="grid min-w-0 gap-4 p-4 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">
                        镜头{index + 1} · 秒数
                      </span>
                      <input
                        type="number"
                        className={fieldClass}
                        min={1}
                        max={15}
                        value={shot.durationSec}
                        onChange={(event) =>
                          setShot({ durationSec: Number(event.target.value) })
                        }
                      />
                    </label>
                    <Field
                      label={`镜头${index + 1} · 画面与动作`}
                      value={shot.description}
                      multiline
                      maxLength={3000}
                      onChange={(description) => setShot({ description })}
                    />
                    <Field
                      label={`镜头${index + 1} · 首帧画面`}
                      value={shot.imagePrompt}
                      multiline
                      maxLength={3000}
                      onChange={(imagePrompt) => setShot({ imagePrompt })}
                    />
                    <Field
                      label={`镜头${index + 1} · 视频动作`}
                      value={shot.videoPrompt}
                      multiline
                      maxLength={3000}
                      onChange={(videoPrompt) => setShot({ videoPrompt })}
                    />
                    <Field
                      label={`镜头${index + 1} · 台词`}
                      value={shot.dialogue}
                      maxLength={500}
                      onChange={(dialogue) => setShot({ dialogue })}
                    />
                    <Field
                      label={`镜头${index + 1} · 旁白`}
                      value={shot.narration}
                      maxLength={500}
                      onChange={(narration) => setShot({ narration })}
                    />
                    <Field
                      label={`镜头${index + 1} · 字幕`}
                      value={shot.subtitle}
                      maxLength={1000}
                      onChange={(subtitle) => setShot({ subtitle })}
                    />
                    {script.characters.length > 0 && (
                      <fieldset className="space-y-2">
                        <legend className="mb-1 text-sm font-medium">
                          镜头{index + 1} · 出场角色
                        </legend>
                        {script.characters.map((character) => (
                          <label
                            key={character.key}
                            className="flex min-h-9 items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={shot.characterKeys.includes(
                                character.key
                              )}
                              onChange={(event) =>
                                setShot({
                                  characterKeys: event.target.checked
                                    ? [...shot.characterKeys, character.key]
                                    : shot.characterKeys.filter(
                                        (key) => key !== character.key
                                      ),
                                })
                              }
                            />
                            {character.name || "未命名角色"}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <button
            type="button"
            className={secondaryClass}
            disabled={script.shots.length >= 5}
            onClick={() =>
              update({
                ...script,
                shots: [...script.shots, emptyShot(crypto.randomUUID(), 5)],
              })
            }
          >
            <Plus className="size-4" aria-hidden />
            添加镜头
          </button>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <Field
              label="结尾反转"
              value={script.ending}
              maxLength={1000}
              onChange={(ending) => update({ ...script, ending })}
              multiline
            />
            <Field
              label="建议发布文案"
              value={script.suggestedCaption}
              maxLength={2000}
              onChange={(suggestedCaption) =>
                update({ ...script, suggestedCaption })
              }
              multiline
            />
            <Field
              label="脚本话题（逗号分隔）"
              value={script.hashtags.join("，")}
              onChange={(hashtags) =>
                update({
                  ...script,
                  hashtags: hashtags
                    .split(/[,，]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </fieldset>
      )}
      {validation && (
        <p role="status" className="text-destructive text-sm">
          待补全：{validation}
        </p>
      )}
      <details
        className="border-border rounded-lg border p-3"
        open={!!value && !script}
      >
        <summary className="text-muted-foreground cursor-pointer text-sm">
          高级编辑 · JSON 导入与修改
        </summary>
        <label className="mt-3 block space-y-2">
          <span className="text-sm">结构化脚本 JSON</span>
          <textarea
            className={`${fieldClass} min-h-64 font-mono text-xs`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
          />
        </label>
      </details>
    </div>
  );
}
