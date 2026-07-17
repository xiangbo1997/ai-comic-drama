"use client";

/**
 * 场景地点弹窗（计划 §5 · 2.2「场景锚图 / 地点空景板」）
 *
 * 列出项目的场景地点（GET locations 合并视图）：缩略图 / 地点标签 / 分镜数 / 描述。
 * 每行可：
 *  - 编辑描述（本地草稿态，失焦或点保存才 PATCH——避免每次 onChange 都 PATCH+刷新
 *    把输入刷回，即本仓库记录的 PATCH-refresh-clobber 坑）；
 *  - 生成/重新生成空景板（task 轮询，进度期间禁用，显示成本 1 积分）；
 *  - 上传替换（复用 uploadFileViaApi → PATCH imageUrl 回填）；
 *  - 点缩略图放大预览锚图（嵌套 Dialog）。
 * 顶部「AI 补全地点/描述」：POST describe（含 labelMissing，为未标注分镜补地点标签），
 * 提示本次打标的分镜数与写描述的地点数。
 *
 * 数据拉取：打开即拉（useEffect 监听 open，竞态守卫），与 SuggestLinksDialog 一致；
 * 不在 onOpenChange 里拉（外部按钮控制开启，onOpenChange 不为外部开启触发）。
 */

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  MapPin,
  Sparkles,
  Wand2,
  RotateCw,
  Upload,
  ImageOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  fetchLocations,
  describeLocations,
  patchLocation,
  generateLocationPlate,
  type ProjectLocationView,
} from "@/lib/assist-client";
import { uploadFileViaApi } from "@/lib/upload-client";

interface LocationsDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** 生成空景板用的图像配置 ID（跟随分镜列表当前选中的图像模型） */
  imageConfigId?: string;
}

const PLATE_COST = 1;

export function LocationsDialog({
  open,
  onClose,
  projectId,
  imageConfigId,
}: LocationsDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [locations, setLocations] = useState<ProjectLocationView[]>([]);
  // 描述草稿态：locationKey → 编辑中的文本（未提交）。用 key 而非 id，
  // 因为尚未建行的地点无 id，但仍需可编辑（描述提交前先建行）。
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 每个地点的进行中操作（generate/upload）：locationKey → true
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // 隐藏 file input（上传替换）；点按钮时记住目标地点
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<ProjectLocationView | null>(null);
  // 锚图大图预览：点缩略图打开嵌套 Dialog（url + 地点名做标题）
  const [preview, setPreview] = useState<{ url: string; key: string } | null>(
    null
  );

  // 打开即拉；竞态守卫（关闭/卸载后不再 setState）
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    fetchLocations(projectId)
      .then((res) => {
        if (!active) return;
        setLocations(res);
        // 初始化草稿态为当前描述
        const d: Record<string, string> = {};
        for (const loc of res) d[loc.locationKey] = loc.description ?? "";
        setDrafts(d);
      })
      .catch((err) => {
        if (!active) return;
        toast.error(err instanceof Error ? err.message : "读取场景地点失败");
        onClose();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // toast/onClose 引用稳定；仅在 open/projectId 变化时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const reload = async () => {
    try {
      const res = await fetchLocations(projectId);
      // 旧服务端值快照：用于判断草稿是否被用户改动过。
      // 此前按「key 不存在才写入」合并——但打开弹窗时已为全部地点初始化草稿
      // （含空串），AI 补全的新描述永远进不了草稿，文本框看起来"没更新"（数据
      // 其实已落库）。正确守卫 = 草稿与旧服务端值相同（用户没编辑过）才吃新值。
      const oldDescByKey = new Map(
        locations.map((l) => [l.locationKey, l.description ?? ""])
      );
      setLocations(res);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const loc of res) {
          const key = loc.locationKey;
          const fresh = loc.description ?? "";
          const draft = next[key];
          // 新地点（无草稿）或用户未编辑（草稿 == 旧服务端值）→ 吃进服务端新值；
          // 草稿 ≠ 旧值说明用户正在编辑 → 保留草稿不覆盖
          if (draft === undefined || draft === (oldDescByKey.get(key) ?? "")) {
            next[key] = fresh;
          }
        }
        return next;
      });
    } catch {
      // 静默：reload 失败不打断当前操作，下次打开会重拉
    }
  };

  const handleDescribe = async () => {
    setDescribing(true);
    try {
      // labelMissing=true：先为未标注地点的分镜补地点标签，再补描述
      const { labeled, described, describeError } = await describeLocations(
        projectId,
        true
      );
      // 部分成功（打标已落库、描述生成失败）：仍需刷新展示已打标地点，
      // 只是提示改为 warning「可重试」，不误报为整体失败（数据其实已入库）。
      await reload();
      if (describeError) {
        toast.warning("地点已打标，描述生成失败，可重试");
      } else {
        const parts: string[] = [];
        if (labeled > 0) parts.push(`为 ${labeled} 个分镜标注了地点`);
        if (described > 0) parts.push(`补全 ${described} 条地点描述`);
        toast.success(
          parts.length > 0 ? parts.join("，") : "没有需要补全的内容"
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "补全地点/描述失败");
    } finally {
      setDescribing(false);
    }
  };

  // 描述失焦：与当前值不同才 PATCH（避免无谓写库）
  const handleDescriptionBlur = async (loc: ProjectLocationView) => {
    const draft = (drafts[loc.locationKey] ?? "").trim();
    const current = (loc.description ?? "").trim();
    if (draft === current) return;
    try {
      // 尚未建行的地点：describe 尚未跑过，直接 PATCH 会 404（无 id）。
      // 提示用户先「AI 补全地点/描述」建行。
      if (!loc.id) {
        toast.info("请先点顶部「AI 补全地点/描述」建立地点后再编辑描述");
        return;
      }
      const updated = await patchLocation(projectId, loc.id, {
        description: draft,
      });
      setLocations((prev) =>
        prev.map((l) =>
          l.locationKey === loc.locationKey
            ? { ...l, description: updated.description }
            : l
        )
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存描述失败");
    }
  };

  const handleGenerate = async (loc: ProjectLocationView) => {
    if (!loc.id) {
      toast.info("请先点顶部「AI 补全地点/描述」建立地点后再生成锚图");
      return;
    }
    setBusy((b) => ({ ...b, [loc.locationKey]: true }));
    try {
      const { imageUrl } = await generateLocationPlate(projectId, loc.id, {
        imageConfigId,
      });
      setLocations((prev) =>
        prev.map((l) =>
          l.locationKey === loc.locationKey ? { ...l, imageUrl } : l
        )
      );
      toast.success("场景锚图已生成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成场景锚图失败");
    } finally {
      setBusy((b) => ({ ...b, [loc.locationKey]: false }));
    }
  };

  const handleUploadClick = (loc: ProjectLocationView) => {
    if (!loc.id) {
      toast.info("请先点顶部「AI 补全地点/描述」建立地点后再上传锚图");
      return;
    }
    uploadTargetRef.current = loc;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 立即清空，允许连续选同一文件重新触发 change
    e.target.value = "";
    const loc = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!file || !loc?.id) return;

    setBusy((b) => ({ ...b, [loc.locationKey]: true }));
    try {
      const url = await uploadFileViaApi({
        file,
        fileType: "image",
        projectId,
      });
      const updated = await patchLocation(projectId, loc.id, { imageUrl: url });
      setLocations((prev) =>
        prev.map((l) =>
          l.locationKey === loc.locationKey
            ? { ...l, imageUrl: updated.imageUrl }
            : l
        )
      );
      toast.success("锚图已替换");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上传替换失败");
    } finally {
      setBusy((b) => ({ ...b, [loc.locationKey]: false }));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col p-0">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <MapPin size={18} className="text-primary" />
            场景地点
          </DialogTitle>
          <DialogDescription>
            为每个地点沉淀一张「无人物空景板」作为场景锚，锁住同地点多镜的背景 /
            布局 / 光线。生成锚图每张消耗 {PLATE_COST} 积分。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <span className="text-muted-foreground text-xs">
            共 {locations.length} 个地点
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDescribe}
            disabled={describing || loading}
          >
            {describing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            AI 补全地点/描述
          </Button>
        </div>

        <div className="min-h-32 flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
              <Loader2 size={16} className="animate-spin" />
              加载中…
            </div>
          ) : locations.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 py-10 text-sm">
              <MapPin size={22} className="opacity-40" />
              <span>暂无场景地点</span>
              <span className="text-xs">
                点上方「AI 补全地点/描述」识别分镜地点
              </span>
            </div>
          ) : (
            <ul className="space-y-3">
              {locations.map((loc) => {
                const isBusy = Boolean(busy[loc.locationKey]);
                return (
                  <li
                    key={loc.locationKey}
                    className="border-border flex gap-3 rounded-lg border p-3"
                  >
                    {/* 缩略图 / 占位（有图时可点击放大预览） */}
                    <button
                      type="button"
                      onClick={() =>
                        loc.imageUrl &&
                        setPreview({
                          url: loc.imageUrl,
                          key: loc.locationKey,
                        })
                      }
                      disabled={!loc.imageUrl || isBusy}
                      title={loc.imageUrl ? "点击预览大图" : undefined}
                      className={`bg-secondary/50 relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md ${
                        loc.imageUrl && !isBusy
                          ? "hover:ring-primary/50 cursor-pointer transition hover:ring-2"
                          : "cursor-default"
                      }`}
                    >
                      {loc.imageUrl ? (
                        <img
                          src={loc.imageUrl}
                          alt={loc.locationKey}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageOff
                          size={20}
                          className="text-muted-foreground opacity-40"
                        />
                      )}
                      {isBusy && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2
                            size={18}
                            className="animate-spin text-white"
                          />
                        </div>
                      )}
                    </button>

                    {/* 信息 + 操作 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground truncate text-sm font-medium">
                          {loc.locationKey}
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {loc.sceneCount} 镜
                        </span>
                      </div>
                      <textarea
                        value={drafts[loc.locationKey] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [loc.locationKey]: e.target.value,
                          }))
                        }
                        onBlur={() => handleDescriptionBlur(loc)}
                        placeholder="地点环境描述（可编辑）"
                        rows={2}
                        className="border-border bg-background focus:ring-primary/40 mt-1.5 w-full resize-none rounded-md border px-2 py-1 text-xs focus:ring-2 focus:outline-none"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerate(loc)}
                          disabled={isBusy}
                        >
                          {loc.imageUrl ? (
                            <RotateCw size={13} />
                          ) : (
                            <Wand2 size={13} />
                          )}
                          {loc.imageUrl ? "重新生成" : "生成锚图"}
                          <span className="text-muted-foreground ml-1">
                            {PLATE_COST} 分
                          </span>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUploadClick(loc)}
                          disabled={isBusy}
                        >
                          <Upload size={13} />
                          上传替换
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 隐藏 file input（上传替换共用） */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* 锚图大图预览（嵌套 Dialog，点缩略图打开） */}
        <Dialog
          open={Boolean(preview)}
          onOpenChange={(next) => {
            if (!next) setPreview(null);
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MapPin size={16} className="text-primary" />
                {preview?.key}
              </DialogTitle>
            </DialogHeader>
            {preview && (
              <img
                src={preview.url}
                alt={preview.key}
                className="max-h-[75vh] w-full rounded-md bg-black object-contain"
              />
            )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
