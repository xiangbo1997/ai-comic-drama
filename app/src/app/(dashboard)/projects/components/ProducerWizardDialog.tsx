"use client";

/**
 * ProducerWizardDialog — 一键 AI 制片人向导（计划 §6 · 3.1）
 *
 * 一句话点子 → 完整草稿（世界观/脚本/分镜/角色+外貌），全程只花文本 LLM，
 * 出图（花积分）永远在「进入审阅并逐项确认」之后由用户主动触发。
 *
 * 编排为客户端串行五步，每步调「已有」端点（见 lib/producer-client）：
 *   ① AI 起草世界观 → ② 创建项目 → ③ 生成短剧脚本 → ④ 角色建档+外貌预填 → ⑤ 直转分镜
 * 角色步骤必须先于分镜步骤：分镜直转要把角色名写入各分镜 characters，分镜 POST
 * 路由据此匹配 selectedCharacterId（出图角色一致性）——角色需先在库中建档。
 * 幂等：② 创建项目仅一次，projectId 存 state；任一步失败可「重试该步」，
 * 从失败步续跑而非从头（已完成步不重放，避免重复建项目/角色）。
 * 完成后 CTA「进入审阅」→ /editor/[projectId]?review=1。
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Wand2,
  Check,
  X,
  CircleDashed,
  ArrowRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  FULL_STYLE_PACK_OPTIONS,
  LEGACY_STYLE_PACK_OPTIONS,
  STYLE_GROUP_LABELS,
} from "@/lib/prompts/style-packs";
import { resolveSerializationHint } from "@/lib/genre-matrix";
import { GenreSelectField } from "./GenreSelectField";
import {
  draftWorldview,
  draftCharacterRoster,
  type RosterProfile,
} from "@/lib/assist-client";
import {
  createProducerProject,
  runDramaScript,
  createAndLinkCharacter,
} from "@/lib/producer-client";
import { extractProducerCharacterNames } from "@/lib/producer-character-extract";
import { dramaScriptToScenes, scriptToInputText } from "@/lib/drama-to-scenes";
import type { DramaScriptArtifact, ProducerReview } from "@/types";

const ASPECT_RATIOS: Array<{ value: string; label: string }> = [
  { value: "9:16", label: "9:16 (竖屏)" },
  { value: "16:9", label: "16:9 (横屏)" },
  { value: "1:1", label: "1:1 (方形)" },
];

/** 向导五步的稳定标识（顺序即执行顺序） */
type StepKey = "worldview" | "project" | "script" | "characters" | "scenes";
type StepStatus = "pending" | "running" | "done" | "failed";

// 「角色建档 + 外貌预填」原文案让用户以为角色已经办好了，实际这一步只产出
// 文字设定，一张定妆照都没有（包 B · B4）。措辞改成如实说明「只有文字设定」，
// 避免用户带着「角色已就绪」的预期直接去出图、拿到一批不一致的人物。
const STEP_LABELS: Record<StepKey, string> = {
  worldview: "AI 起草世界观",
  project: "创建项目",
  script: "生成短剧脚本（约 1 分钟）",
  characters: "角色建档（文字设定，暂无定妆照）",
  scenes: "直转分镜列表",
};

// 角色先于分镜：分镜直转要把角色名写入各分镜 characters，分镜 POST 路由据此
// 匹配 selectedCharacterId——角色需先建档入库，否则匹配落空、出图缺参考图。
const STEP_ORDER: StepKey[] = [
  "worldview",
  "project",
  "script",
  "characters",
  "scenes",
];

interface ProducerWizardDialogProps {
  onClose: () => void;
}

export function ProducerWizardDialog({ onClose }: ProducerWizardDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // 输入
  const [idea, setIdea] = useState("");
  const [style, setStyle] = useState("anime");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [durationSec, setDurationSec] = useState(90);
  // 题材（批 3）：空串 = 不指定，由 AI 判断（与改前行为一致）。
  // 选中后会一路透传：世界观起草 → 落库 generationParams.genre → 脚本生成 prompt。
  const [genre, setGenre] = useState("");

  // 执行态
  const [running, setRunning] = useState(false);
  const [stepStatus, setStepStatus] = useState<Record<StepKey, StepStatus>>({
    worldview: "pending",
    project: "pending",
    script: "pending",
    characters: "pending",
    scenes: "pending",
  });
  const [failedStep, setFailedStep] = useState<StepKey | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // 跨步骤中间产物（幂等续跑的关键：已产出的不重算）
  const [projectId, setProjectId] = useState<string | null>(null);
  const [scriptArtifact, setScriptArtifact] =
    useState<DramaScriptArtifact | null>(null);
  // 已成功建档的角色名：角色步骤中途失败重试时跳过，避免重复建档（幂等护栏）
  const [createdCharNames, setCreatedCharNames] = useState<string[]>([]);
  const [charCount, setCharCount] = useState(0);

  const setStatus = useCallback((key: StepKey, status: StepStatus) => {
    setStepStatus((prev) => ({ ...prev, [key]: status }));
  }, []);

  /**
   * 从指定步骤开始串行执行到最后一步。
   * 用局部变量承接中间产物（React setState 异步，同一次运行内不能靠读 state），
   * 同时写回 state 供 UI 展示与失败续跑。
   */
  const runFrom = useCallback(
    async (from: StepKey) => {
      setRunning(true);
      setFailedStep(null);
      setErrorMsg(null);

      // 题材（批 3）：空串归一成 undefined 语义，避免把空字符串当题材下传
      const selectedGenre = genre.trim() || null;

      // 承接上次已产出的中间产物（续跑时复用，不重算）
      let localProjectId = projectId;
      let localArtifact = scriptArtifact;
      const localCreatedNames = new Set(createdCharNames);
      const startIndex = STEP_ORDER.indexOf(from);
      // 记录当前正在执行的步骤，供 catch 精准标记失败步（setState 异步，不能靠读 state）
      let currentKey: StepKey = from;

      try {
        for (let i = startIndex; i < STEP_ORDER.length; i++) {
          const key = STEP_ORDER[i];
          currentKey = key;
          setStatus(key, "running");

          if (key === "worldview") {
            // 世界观：一句话点子扩写为完整世界观（承接进后续脚本生成）。
            // 题材（批 3）选了就下传：让起草的设定与冲突服务于该题材的核心看点，
            // 而不是先起草完再贴标签。未选则不传，由 LLM 自行判断（行为同改前）。
            const draft = await draftWorldview({
              idea: idea.trim(),
              ...(selectedGenre ? { genre: selectedGenre } : {}),
            });
            localArtifact = {
              ...(localArtifact ?? ({} as DramaScriptArtifact)),
              worldview: draft.worldview,
              protagonist: draft.protagonist,
              genre: draft.genre,
              filmTitle: draft.filmTitle,
            } as DramaScriptArtifact;
            setScriptArtifact(localArtifact);
          } else if (key === "project") {
            // 幂等：项目只创建一次；续跑已有 projectId 直接跳过创建
            if (!localProjectId) {
              const project = await createProducerProject({
                title: localArtifact?.filmTitle?.trim() || "AI 制片人项目",
                style,
                aspectRatio,
              });
              localProjectId = project.id;
              setProjectId(project.id);
              // 题材落库（批 3）：写进 generationParams.genre，让题材成为项目的
              // 持久创作参数——编辑器里重新生成脚本、系列续集都能读到（服务端
              // drama-script 路由会在客户端未显式传题材时回落读取它）。
              // 失败不阻断：本轮脚本生成仍会显式传题材，仅影响后续重生成。
              if (selectedGenre) {
                await fetch(`/api/projects/${localProjectId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    generationParams: { genre: selectedGenre },
                  }),
                }).catch(() => {
                  // 静默：题材仅影响 prompt 上下文，存不进去不该让整个向导失败
                });
              }
            }
          } else if (key === "script") {
            if (!localProjectId) throw new Error("项目缺失，请从头重试");
            const result = await runDramaScript(localProjectId, {
              worldview: localArtifact?.worldview?.trim() ?? "",
              protagonist: localArtifact?.protagonist?.trim() || undefined,
              durationSec,
              aspectRatio,
              style,
              // 题材显式下传（批 3）：不依赖服务端回落，避免上一步 PATCH 失败
              // 时本轮脚本丢掉题材上下文
              ...(selectedGenre ? { genre: selectedGenre } : {}),
            });
            localArtifact = result.artifact;
            setScriptArtifact(result.artifact);
          } else if (key === "characters") {
            if (!localProjectId || !localArtifact) {
              throw new Error("脚本缺失，无法建档角色");
            }
            const names = extractProducerCharacterNames(localArtifact);
            // 场景摘要：每场「标题：description」+ 对白（有则带），作为 roster 推断证据。
            const scenesDigest = localArtifact.scenes
              .map((s) => {
                const head = `${s.title}：${s.description}`;
                return s.dialogue ? `${head}\n${s.dialogue}` : head;
              })
              .join("\n");
            // 建档前一次性推断每个角色的 gender/age/身份（1 次 LLM）。降级不阻断：
            // roster 失败则用空 Map，角色仍照常建档（性别/年龄留空，交互原则 5）。
            let rosterMap = new Map<string, RosterProfile>();
            try {
              const roster = await draftCharacterRoster({
                names,
                worldview: localArtifact.worldview ?? "",
                protagonist: localArtifact.protagonist || undefined,
                scenesDigest,
              });
              rosterMap = new Map(roster.characters.map((c) => [c.name, c]));
            } catch {
              rosterMap = new Map();
            }
            // 串行建档（避免并发 N 次 LLM 触发限流）；单角色失败整步失败可重试。
            // 幂等：已成功建档的角色名跳过，重试不重复建档。重试整步会重打一次
            // roster LLM（可接受，1 次调用），无需持久化。
            for (const name of names) {
              if (localCreatedNames.has(name)) continue;
              await createAndLinkCharacter(
                localProjectId,
                name,
                rosterMap.get(name)
              );
              localCreatedNames.add(name);
              setCreatedCharNames([...localCreatedNames]);
              setCharCount(localCreatedNames.size);
            }
          } else if (key === "scenes") {
            if (!localProjectId || !localArtifact) {
              throw new Error("脚本缺失，请重试生成脚本");
            }
            // 角色名与角色步骤同源（extractProducerCharacterNames），不读 React
            // state（setState 异步）。写入各分镜 characters，分镜 POST 路由据此
            // 匹配 selectedCharacterId——角色已在上一步建档入库，匹配得中。
            const names = extractProducerCharacterNames(localArtifact);
            // 零 LLM 结构化直转（含九宫格镜头语言若有）；新空项目无需重建确认
            const scenes = dramaScriptToScenes(localArtifact, null, names);
            const scenesRes = await fetch(
              `/api/projects/${localProjectId}/scenes`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scenes }),
              }
            );
            if (!scenesRes.ok) {
              const err = await scenesRes.json().catch(() => null);
              throw new Error(err?.error || "生成分镜列表失败");
            }
            // 回填分镜原文到 inputText（与手动路径同源，便于后续手改重解析）
            await fetch(`/api/projects/${localProjectId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                inputText: scriptToInputText(localArtifact),
              }),
            }).catch(() => {
              // 回填失败不阻断（inputText 仅便于手动重解析，非必需）
            });
            // 写入审阅态标记（末步收尾）：本项目由向导创建，编辑器据此显示审阅 UI。
            // 置于最后一步末尾，确保角色与分镜两步都成功后才落标记；PATCH 失败则
            // 末步标记失败，重试重跑分镜步骤（分镜 POST 幂等替换，不会重复建分镜）。
            const producerReview: ProducerReview = {
              createdByProducer: true,
              confirmed: {
                worldview: false,
                script: false,
                characters: [],
                scenes: [],
              },
            };
            // ⚠️ generationParams 的 PATCH 是【整体替换】（服务端
            // normalizeGenerationParams 按白名单逐字段重建，不做 merge），
            // 所以这里必须把题材一起带上 —— 否则末步 PATCH 会把第 2 步存进去的
            // generationParams.genre 抹掉，脚本重生成时题材上下文静默丢失。
            await fetch(`/api/projects/${localProjectId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                generationParams: {
                  producerReview,
                  ...(selectedGenre ? { genre: selectedGenre } : {}),
                },
              }),
            });
          }

          setStatus(key, "done");
        }

        // 全部完成
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        setDone(true);
      } catch (err) {
        setStatus(currentKey, "failed");
        setFailedStep(currentKey);
        setErrorMsg(err instanceof Error ? err.message : "执行失败");
      } finally {
        setRunning(false);
      }
    },
    [
      idea,
      style,
      aspectRatio,
      durationSec,
      genre,
      projectId,
      scriptArtifact,
      createdCharNames,
      queryClient,
      setStatus,
    ]
  );

  const handleStart = () => {
    if (!idea.trim() || running) return;
    void runFrom("worldview");
  };

  const handleRetryStep = () => {
    if (!failedStep || running) return;
    void runFrom(failedStep);
  };

  const handleEnterReview = () => {
    if (!projectId) return;
    router.push(`/editor/${projectId}?review=1`);
  };

  const started = running || done || failedStep !== null;
  // 连载提示（批 3 · F4）：目标时长偏长时提醒「拆连载比做长单集更划算」。
  // 纯提示，返回 null 即不展示，不改变任何生成参数。
  const serializationHint = resolveSerializationHint(durationSec);

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={18} className="text-agent" />
            一键 AI 制片人
          </DialogTitle>
          <DialogDescription>
            一句话点子，AI 帮你起草世界观、脚本、分镜和角色；全程只用文本 AI
            不花积分，图片/视频永远等你审阅确认后再生成
          </DialogDescription>
        </DialogHeader>

        {/* 输入区（未开始时可编辑；执行后锁定） */}
        <div className="space-y-3">
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">
              一句话点子 <span className="text-destructive">*</span>
            </label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              disabled={started}
              placeholder="如：重生复仇爽剧，女主是被陷害的豪门千金，回到三年前手撕渣男白莲花"
              className="bg-card focus:ring-primary h-20 w-full resize-none rounded-lg p-2 text-sm focus:ring-2 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-muted-foreground mb-1 block text-sm">
                风格
              </label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                disabled={started}
                className="bg-card w-full rounded-lg p-2 text-sm disabled:opacity-60"
              >
                <optgroup label={STYLE_GROUP_LABELS.full}>
                  {FULL_STYLE_PACK_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value} title={s.description}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={STYLE_GROUP_LABELS.legacy}>
                  {LEGACY_STYLE_PACK_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value} title={s.description}>
                      {s.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                画幅
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                disabled={started}
                className="bg-card rounded-lg p-2 text-sm disabled:opacity-60"
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-muted-foreground mb-1 block text-sm">
                目标时长
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value) || 90)}
                  disabled={started}
                  className="bg-card w-16 rounded-lg p-2 text-sm disabled:opacity-60"
                />
                <span className="text-muted-foreground text-xs">秒</span>
              </div>
            </div>
          </div>

          {/* 题材选择（批 3）：按平台数据分档 + 选中后同屏给依据与风险，不硬阻断 */}
          <GenreSelectField
            value={genre}
            onChange={setGenre}
            disabled={started}
          />

          {/* 连载提示（批 3 · F4）：平台按「有效观看时长」分账而非播放量，
              长单集不如拆连载。纯提示，不强制，也不改变任何参数。 */}
          {serializationHint && (
            <p className="border-border bg-card/60 text-muted-foreground rounded-lg border p-2 text-xs leading-relaxed">
              {serializationHint}
            </p>
          )}
        </div>

        {/* 步骤进度（开始后展示） */}
        {started && (
          <div className="border-border bg-card/50 space-y-2 rounded-lg border p-3">
            {STEP_ORDER.map((key) => (
              <StepRow
                key={key}
                label={STEP_LABELS[key]}
                status={stepStatus[key]}
                extra={
                  key === "characters" && charCount > 0
                    ? `已建 ${charCount} 个角色`
                    : undefined
                }
              />
            ))}
            {errorMsg && (
              <p className="text-xs text-red-400">
                {STEP_LABELS[failedStep ?? "worldview"]}失败：{errorMsg}
              </p>
            )}
            {/* 完成态如实说明「还差什么」（包 B · B4）：向导只产出文字草稿，
                角色还没有定妆照——而定妆照是人物跨镜头一致的地基。
                下一步入口就在同一个按钮上（进入审阅 → 审阅完成时一键补拍），
                不让用户自己去猜要去哪个页面做什么。 */}
            {done && (
              <p className="border-primary/30 bg-primary/10 text-muted-foreground rounded-lg border p-2 text-xs">
                草稿齐了，但{charCount > 0 ? ` ${charCount} 个` : ""}
                角色目前只有文字设定、还没有定妆照——定妆照是角色在所有画面里的
                长相基准，缺了它同一个人在不同镜头会长得不一样。
                点下方「进入审阅」，确认完草稿即可一键补拍，再开始出图。
              </p>
            )}
          </div>
        )}

        {/* 底部动作区 */}
        <div className="flex items-center justify-end gap-2 pt-1">
          {!started && (
            <>
              <button
                onClick={onClose}
                className="bg-secondary hover:bg-secondary/80 rounded-lg px-4 py-2 text-sm transition"
              >
                取消
              </button>
              <button
                onClick={handleStart}
                disabled={!idea.trim()}
                className="bg-agent text-agent-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wand2 size={16} />
                开始生成
              </button>
            </>
          )}

          {failedStep && !running && !done && (
            <button
              onClick={handleRetryStep}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
            >
              重试该步
            </button>
          )}

          {done && (
            <button
              onClick={handleEnterReview}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
            >
              进入审阅
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 单步进度行：图标 + 标签 + 可选补充文案 */
function StepRow({
  label,
  status,
  extra,
}: {
  label: string;
  status: StepStatus;
  extra?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {status === "running" ? (
        <Loader2 size={15} className="text-agent animate-spin" />
      ) : status === "done" ? (
        <Check size={15} className="text-green-500" />
      ) : status === "failed" ? (
        <X size={15} className="text-red-400" />
      ) : (
        <CircleDashed size={15} className="text-muted-foreground" />
      )}
      <span
        className={
          status === "pending"
            ? "text-muted-foreground"
            : status === "failed"
              ? "text-red-400"
              : "text-foreground"
        }
      >
        {label}
      </span>
      {extra && (
        <span className="text-muted-foreground ml-auto text-xs">{extra}</span>
      )}
    </div>
  );
}
