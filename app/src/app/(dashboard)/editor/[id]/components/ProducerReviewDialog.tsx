"use client";

/**
 * ProducerReviewDialog — 一键 AI 制片人审阅清单（计划 §6 · 3.1 核心增量）
 *
 * 制片人向导生成的项目进入编辑器后，逐项审阅草稿（世界观/脚本/每个角色/每镜分镜），
 * 每项可确认或修改，全部确认后才放行去出图（花积分的软关口）。
 *
 * 审阅态存 generationParams.producerReview（白名单已放行，见 producer-review.ts）。
 * 角色外貌复用 AppearanceEditor 内联编辑，走 PATCH /api/characters/[id]。
 * 分区/逐项确认走 updateProject 落库。
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  BookOpen,
  FileText,
  Users,
  ListVideo,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import {
  AppearanceEditor,
  toAppearanceFormData,
  type AppearanceFormData,
} from "@/components/appearance-editor";
import {
  isProducerReviewComplete,
  countProducerReviewProgress,
} from "@/lib/producer-review";
import type { ProjectDetail, ProducerReview, CharacterListItem } from "@/types";

interface ProducerReviewDialogProps {
  isOpen: boolean;
  project: ProjectDetail;
  onClose: () => void;
  /** 更新项目（PATCH generationParams），返回 Promise 供 await */
  updateProject: (data: Partial<ProjectDetail>) => Promise<unknown>;
  /** 刷新项目数据 */
  invalidateProject: () => void;
  /** 点某分镜「跳转查看」→ 选中该分镜并关闭弹窗 */
  onJumpToScene: (sceneId: string) => void;
}

/** 空审阅态（向导写入的初值一致）：所有分区未确认 */
const EMPTY_REVIEW: ProducerReview = {
  createdByProducer: true,
  confirmed: { worldview: false, script: false, characters: [], scenes: [] },
};

/** 拉取用户全部角色（含 appearance）——项目 GET 的角色 select 不含 appearance，
 * 审阅内联编辑外貌需要完整字段，故单独取列表再按项目角色 id 过滤 */
async function fetchCharactersWithAppearance(): Promise<CharacterListItem[]> {
  const res = await fetch("/api/characters");
  if (!res.ok) throw new Error("读取角色失败");
  return res.json();
}

export function ProducerReviewDialog({
  isOpen,
  project,
  onClose,
  updateProject,
  invalidateProject,
  onJumpToScene,
}: ProducerReviewDialogProps) {
  const toast = useToast();

  const review = project.generationParams?.producerReview ?? EMPTY_REVIEW;
  const characterIds = useMemo(
    () => project.characters.map((c) => c.character.id),
    [project.characters]
  );
  const sceneIds = useMemo(
    () => project.scenes.map((s) => s.id),
    [project.scenes]
  );

  const progress = countProducerReviewProgress(review, characterIds, sceneIds);
  const allConfirmed = isProducerReviewComplete(review, characterIds, sceneIds);

  // 分区折叠态
  const [openSection, setOpenSection] = useState<string | null>("worldview");
  // 正在保存的确认项（禁用重复点击）
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // 角色完整数据（含外貌）——仅本弹窗内联编辑用
  const { data: fullCharacters } = useQuery({
    queryKey: ["characters", "with-appearance"],
    queryFn: fetchCharactersWithAppearance,
    enabled: isOpen,
  });
  const appearanceByCharId = useMemo(() => {
    const map = new Map<string, CharacterListItem>();
    for (const c of fullCharacters ?? []) map.set(c.id, c);
    return map;
  }, [fullCharacters]);

  // 最新短剧脚本（世界观 / 脚本分区展示）
  const { data: scriptSummary } = useQuery({
    queryKey: ["drama-script-summary", project.id],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${project.id}/drama-script`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        scripts: Array<{
          filmTitle: string | null;
          worldview: string | null;
          scriptDoc: { logline?: string; scenes?: unknown[] } | null;
        }>;
      };
      return data.scripts?.[0] ?? null;
    },
    enabled: isOpen,
  });

  /** 写回一个新的 producerReview（不可变构造） */
  const persistReview = async (next: ProducerReview) => {
    await updateProject({
      generationParams: {
        ...project.generationParams,
        producerReview: next,
      },
    });
  };

  /** 切换分区级确认（worldview / script） */
  const toggleSection = async (section: "worldview" | "script") => {
    if (savingKey) return;
    setSavingKey(section);
    try {
      await persistReview({
        ...review,
        confirmed: {
          ...review.confirmed,
          [section]: !review.confirmed[section],
        },
      });
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSavingKey(null);
    }
  };

  /** 切换逐项确认（角色 / 分镜 id 进出已确认集） */
  const toggleItem = async (kind: "characters" | "scenes", id: string) => {
    if (savingKey) return;
    setSavingKey(`${kind}:${id}`);
    try {
      const list = review.confirmed[kind];
      const nextList = list.includes(id)
        ? list.filter((x) => x !== id)
        : [...list, id];
      await persistReview({
        ...review,
        confirmed: { ...review.confirmed, [kind]: nextList },
      });
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSavingKey(null);
    }
  };

  /** 全部确认：世界观+脚本置 true，所有角色/分镜 id 一次性纳入 */
  const confirmAll = async () => {
    if (savingKey) return;
    setSavingKey("all");
    try {
      await persistReview({
        ...review,
        confirmed: {
          worldview: true,
          script: true,
          characters: [...characterIds],
          scenes: [...sceneIds],
        },
      });
      toast.success("已全部确认，可以去生成图片了");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSavingKey(null);
    }
  };

  const handleFinish = () => {
    // 软关口：全部确认后关闭弹窗（滚动到分镜列表由编辑器承载）
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b px-6 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Check size={18} className="text-agent" />
            AI 制片人草稿审阅
          </DialogTitle>
          <DialogDescription>
            逐项确认 AI
            起草的世界观、脚本、角色与分镜；全部确认后再去生成图片（花积分）。
            已确认 {progress.confirmed}/{progress.total}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
          {/* 世界观分区 */}
          <ReviewSection
            icon={<BookOpen size={15} />}
            title="世界观"
            confirmed={review.confirmed.worldview}
            open={openSection === "worldview"}
            saving={savingKey === "worldview"}
            onToggleOpen={() =>
              setOpenSection(openSection === "worldview" ? null : "worldview")
            }
            onToggleConfirm={() => toggleSection("worldview")}
          >
            <p className="text-muted-foreground text-sm whitespace-pre-wrap">
              {scriptSummary?.worldview?.trim() ||
                "（暂无世界观内容，可回世界观创作面板补充）"}
            </p>
          </ReviewSection>

          {/* 脚本分区 */}
          <ReviewSection
            icon={<FileText size={15} />}
            title="脚本"
            confirmed={review.confirmed.script}
            open={openSection === "script"}
            saving={savingKey === "script"}
            onToggleOpen={() =>
              setOpenSection(openSection === "script" ? null : "script")
            }
            onToggleConfirm={() => toggleSection("script")}
          >
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                《{scriptSummary?.filmTitle?.trim() || project.title}》
              </p>
              {scriptSummary?.scriptDoc?.logline && (
                <p className="text-muted-foreground">
                  {scriptSummary.scriptDoc.logline}
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                共 {project.scenes.length} 个分镜
              </p>
            </div>
          </ReviewSection>

          {/* 角色分区（每个角色一项，可内联改外貌 + 单独确认） */}
          <SectionHeader
            icon={<Users size={15} />}
            title={`角色（${characterIds.length}）`}
            open={openSection === "characters"}
            onToggle={() =>
              setOpenSection(openSection === "characters" ? null : "characters")
            }
          />
          {openSection === "characters" && (
            <div className="space-y-2 pl-2">
              {project.characters.length === 0 && (
                <p className="text-muted-foreground text-xs">本项目暂无角色</p>
              )}
              {project.characters.map(({ character }) => (
                <CharacterReviewItem
                  key={character.id}
                  characterId={character.id}
                  name={character.name}
                  fullCharacter={appearanceByCharId.get(character.id)}
                  confirmed={review.confirmed.characters.includes(character.id)}
                  saving={savingKey === `characters:${character.id}`}
                  onToggleConfirm={() => toggleItem("characters", character.id)}
                  onSavedAppearance={invalidateProject}
                />
              ))}
            </div>
          )}

          {/* 分镜分区（每镜一项，可跳转 + 单独确认） */}
          <SectionHeader
            icon={<ListVideo size={15} />}
            title={`分镜（${sceneIds.length}）`}
            open={openSection === "scenes"}
            onToggle={() =>
              setOpenSection(openSection === "scenes" ? null : "scenes")
            }
          />
          {openSection === "scenes" && (
            <div className="space-y-1 pl-2">
              {project.scenes.map((scene, idx) => (
                <div
                  key={scene.id}
                  className="border-border bg-card/50 flex items-start gap-2 rounded-lg border p-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleItem("scenes", scene.id)}
                    disabled={savingKey === `scenes:${scene.id}`}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                      review.confirmed.scenes.includes(scene.id)
                        ? "border-agent bg-agent text-agent-foreground"
                        : "border-border"
                    }`}
                    title="确认此分镜"
                  >
                    {savingKey === `scenes:${scene.id}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : review.confirmed.scenes.includes(scene.id) ? (
                      <Check size={12} />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => onJumpToScene(scene.id)}
                    className="min-w-0 flex-1 text-left"
                    title="跳转到该分镜"
                  >
                    <p className="text-xs font-medium">分镜 {idx + 1}</p>
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                      {scene.description || "（无描述）"}
                    </p>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部：全部确认 + 完成关口 */}
        <div className="border-border flex shrink-0 items-center justify-between gap-2 border-t px-6 py-3">
          <button
            type="button"
            onClick={confirmAll}
            disabled={savingKey === "all" || allConfirmed}
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition disabled:opacity-50"
          >
            {savingKey === "all" && (
              <Loader2 size={13} className="animate-spin" />
            )}
            全部确认
          </button>
          <button
            type="button"
            onClick={handleFinish}
            disabled={!allConfirmed}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            title={
              allConfirmed
                ? "全部已确认，去分镜列表生成图片"
                : "请先逐项确认所有草稿"
            }
          >
            审阅完成，去生成图片
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 分区头（图标 + 标题 + 展开箭头），用于角色/分镜的容器标题 */
function SectionHeader({
  icon,
  title,
  open,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="hover:bg-card/50 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition"
    >
      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      <span className="text-agent">{icon}</span>
      {title}
    </button>
  );
}

/** 可确认的折叠分区（世界观 / 脚本）：标题行含确认勾选 + 展开箭头 */
function ReviewSection({
  icon,
  title,
  confirmed,
  open,
  saving,
  onToggleOpen,
  onToggleConfirm,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  confirmed: boolean;
  open: boolean;
  saving: boolean;
  onToggleOpen: () => void;
  onToggleConfirm: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border rounded-lg border">
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          onClick={onToggleConfirm}
          disabled={saving}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
            confirmed
              ? "border-agent bg-agent text-agent-foreground"
              : "border-border"
          }`}
          title={confirmed ? "已确认，点击取消" : "确认此项"}
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : confirmed ? (
            <Check size={12} />
          ) : null}
        </button>
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex flex-1 items-center gap-2 text-left text-sm font-medium"
        >
          <span className="text-agent">{icon}</span>
          {title}
          {open ? (
            <ChevronDown size={15} className="ml-auto" />
          ) : (
            <ChevronRight size={15} className="ml-auto" />
          )}
        </button>
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** 单个角色审阅项：名字 + 确认勾选 + 内联外貌编辑（复用 AppearanceEditor） */
function CharacterReviewItem({
  characterId,
  name,
  fullCharacter,
  confirmed,
  saving,
  onToggleConfirm,
  onSavedAppearance,
}: {
  characterId: string;
  name: string;
  fullCharacter: CharacterListItem | undefined;
  confirmed: boolean;
  saving: boolean;
  onToggleConfirm: () => void;
  onSavedAppearance: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [draft, setDraft] = useState<AppearanceFormData | null>(null);

  const startEdit = () => {
    setDraft(toAppearanceFormData(fullCharacter?.appearance));
    setEditing(true);
  };

  const saveAppearance = async () => {
    if (!draft || savingAppearance) return;
    setSavingAppearance(true);
    try {
      const res = await fetch(`/api/characters/${characterId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appearance: draft }),
      });
      if (!res.ok) throw new Error("保存失败");
      toast.success("外貌已更新");
      setEditing(false);
      onSavedAppearance();
    } catch {
      toast.error("外貌保存失败，请重试");
    } finally {
      setSavingAppearance(false);
    }
  };

  const summary = summarizeAppearance(fullCharacter?.appearance);

  return (
    <div className="border-border bg-card/50 rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleConfirm}
          disabled={saving}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
            confirmed
              ? "border-agent bg-agent text-agent-foreground"
              : "border-border"
          }`}
          title={confirmed ? "已确认，点击取消" : "确认此角色"}
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" />
          ) : confirmed ? (
            <Check size={12} />
          ) : null}
        </button>
        <span className="text-sm font-medium">{name}</span>
        <button
          type="button"
          onClick={editing ? () => setEditing(false) : startEdit}
          className="text-primary hover:text-primary/80 ml-auto text-xs"
        >
          {editing ? "收起" : "改外貌"}
        </button>
      </div>
      {!editing && summary && (
        <p className="text-muted-foreground mt-1 pl-7 text-xs">{summary}</p>
      )}
      {editing && draft && (
        <div className="mt-2 pl-7">
          <AppearanceEditor
            value={draft}
            onChange={setDraft}
            compact
            characterContext={{ name }}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-muted-foreground text-xs"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveAppearance}
              disabled={savingAppearance}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1 rounded px-3 py-1 text-xs transition disabled:opacity-50"
            >
              {savingAppearance && (
                <Loader2 size={11} className="animate-spin" />
              )}
              保存外貌
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 把结构化外貌压成一行摘要（发型/发色/瞳色…），供未展开时展示 */
function summarizeAppearance(
  appearance: CharacterListItem["appearance"]
): string {
  if (!appearance) return "";
  const parts = [
    appearance.hairStyle,
    appearance.hairColor,
    appearance.eyeColor,
    appearance.bodyType,
    appearance.freeText,
  ].filter((x): x is string => Boolean(x?.trim()));
  return parts.join(" · ");
}
