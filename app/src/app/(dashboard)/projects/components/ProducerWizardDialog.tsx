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
 * 进度以服务端checkpoint为准；刷新后选择草稿继续，项目创建与进度同事务，
 * 租约保护跨标签页推进，分镜和角色操作由服务端幂等复用。
 * 完成后 CTA「进入审阅」→ /editor/[projectId]?review=1。
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { createProducerRun, listProducerRuns } from "@/lib/producer-client";
import { continueProducerRun } from "@/lib/producer-workflow-client";
import {
  PRODUCER_STEPS,
  type ProducerRunSnapshot,
  type ProducerStep,
} from "@/lib/producer-run";

const ASPECT_RATIOS: Array<{ value: string; label: string }> = [
  { value: "9:16", label: "9:16 (竖屏)" },
  { value: "16:9", label: "16:9 (横屏)" },
  { value: "1:1", label: "1:1 (方形)" },
];

/** 向导五步的稳定标识（顺序即执行顺序） */
type StepKey = ProducerStep;
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
const STEP_ORDER = PRODUCER_STEPS;

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
  const [charCount, setCharCount] = useState(0);
  const [checkpoint, setCheckpoint] = useState<ProducerRunSnapshot | null>(
    null
  );
  const [operationId] = useState(() => crypto.randomUUID());
  const mounted = useRef(true);
  const executing = useRef(false);
  const recovery = useQuery({
    queryKey: ["producer-runs"],
    queryFn: listProducerRuns,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const recoverable =
    recovery.data?.filter((run) => run.status !== "completed") ?? [];
  const loadingRecovery = recovery.isPending;
  const recoveryError = recovery.error?.message ?? null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applySnapshot = useCallback((snapshot: ProducerRunSnapshot) => {
    if (!mounted.current) return;
    setCheckpoint(snapshot);
    setProjectId(snapshot.projectId);
    setIdea(snapshot.settings.idea);
    setStyle(snapshot.settings.style);
    setAspectRatio(snapshot.settings.aspectRatio);
    setDurationSec(snapshot.settings.durationSec);
    setGenre(snapshot.settings.genre);
    setCharCount(snapshot.createdCharNames.length);
    setDone(snapshot.status === "completed");
    setStepStatus(
      Object.fromEntries(
        STEP_ORDER.map((step) => [
          step,
          snapshot.completedSteps.includes(step) ? "done" : "pending",
        ])
      ) as Record<StepKey, StepStatus>
    );
    if (snapshot.error) setErrorMsg(snapshot.error);
  }, []);

  const execute = useCallback(
    async (resume?: ProducerRunSnapshot) => {
      if (executing.current) return;
      executing.current = true;
      setRunning(true);
      setErrorMsg(null);
      setFailedStep(null);
      let active: StepKey = resume
        ? (STEP_ORDER.find((step) => !resume.completedSteps.includes(step)) ??
          "scenes")
        : "worldview";
      try {
        const run =
          resume ??
          (await createProducerRun(operationId, {
            idea: idea.trim(),
            style,
            aspectRatio: aspectRatio as "9:16" | "16:9" | "1:1",
            durationSec,
            genre: genre.trim(),
          }));
        applySnapshot(run);
        await continueProducerRun(
          run.id,
          applySnapshot,
          (step) => {
            active = step;
            if (mounted.current)
              setStepStatus((prev) => ({ ...prev, [step]: "running" }));
          },
          () => !mounted.current
        );
        queryClient.invalidateQueries({ queryKey: ["projects"] });
      } catch (error) {
        if (mounted.current) {
          setFailedStep(active);
          setStepStatus((prev) => ({ ...prev, [active]: "failed" }));
          setErrorMsg(error instanceof Error ? error.message : "制作失败");
        }
      } finally {
        executing.current = false;
        if (mounted.current) setRunning(false);
      }
    },
    [
      operationId,
      idea,
      style,
      aspectRatio,
      durationSec,
      genre,
      applySnapshot,
      queryClient,
    ]
  );
  const handleStart = () => {
    if (idea.trim() && !running) void execute();
  };
  const handleRetryStep = () => {
    if (!running) void execute(checkpoint ?? undefined);
  };

  const handleEnterReview = () => {
    if (!projectId) return;
    router.push(`/editor/${projectId}?review=1`);
  };

  const started = running || done || failedStep !== null || checkpoint !== null;
  // 连载提示（批 3 · F4）：目标时长偏长时提醒「拆连载比做长单集更划算」。
  // 纯提示，返回 null 即不展示，不改变任何生成参数。
  const serializationHint = resolveSerializationHint(durationSec);

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
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

        {!started && (
          <div className="space-y-2 text-sm" aria-live="polite">
            {loadingRecovery && (
              <p className="text-muted-foreground">正在检查可恢复草稿…</p>
            )}
            {recoveryError && (
              <p className="text-destructive">
                {recoveryError}{" "}
                <button
                  className="underline"
                  onClick={() => void recovery.refetch()}
                >
                  重新读取
                </button>
              </p>
            )}
            {recoverable.length > 0 && (
              <p className="text-muted-foreground text-xs">
                最近20份草稿中尚未完成的制作
              </p>
            )}
            {recoverable.map((run) => (
              <div
                key={run.id}
                className="border-border bg-secondary/40 flex items-center justify-between gap-2 rounded-lg border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate">
                    {run.worldviewDraft?.filmTitle || run.settings.idea}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    已完成 {run.completedSteps.length}/5 步，进度保存在服务器
                  </p>
                </div>
                <button
                  className="shrink-0 rounded-md px-3 py-2 underline"
                  onClick={() => {
                    applySnapshot(run);
                    void execute(run);
                  }}
                >
                  继续制作
                </button>
              </div>
            ))}
          </div>
        )}
        {started && !done && (
          <p className="text-muted-foreground text-xs">
            已保存步骤可在刷新或重开向导后继续；中断时不自动生成图片或视频。原窗口断开后，恢复可能需等待最多90秒。
          </p>
        )}
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
                disabled={!idea.trim() || loadingRecovery || !!recoveryError}
                className="bg-agent text-agent-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wand2 size={16} />
                开始生成
              </button>
            </>
          )}

          {(failedStep || checkpoint) && !running && !done && (
            <>
              {projectId && (
                <button
                  onClick={() => router.push(`/editor/${projectId}`)}
                  className="bg-secondary hover:bg-secondary/80 rounded-lg px-4 py-2 text-sm transition"
                >
                  进入已建项目
                </button>
              )}
              <button
                onClick={handleRetryStep}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition"
              >
                继续制作
              </button>
            </>
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
