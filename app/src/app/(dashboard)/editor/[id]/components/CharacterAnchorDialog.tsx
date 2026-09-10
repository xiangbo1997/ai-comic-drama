"use client";

/**
 * CharacterAnchorDialog — 出图前的定妆照补齐确认（包 B · B2）
 *
 * 为什么不用 toast.confirm：这里是三选一（补定妆照 / 不补直接出图 / 取消），
 * 而 toast.confirm 只有「取消 / 确定」两个按钮。三个出口都必须在场：
 *  - 补：治一致性（主路径，明码标价积分）；
 *  - 不补：用户可能只是在试画风，不该被强制花钱；
 *  - 取消：用户想先去改角色设定再回来。
 *
 * 文案原则：讲清「为什么重要」（不补会怎样）而不是只给个术语。「定妆照」是
 * 用户没做过也能懂的词，「三视图」只在角色页已生成后才出现，这里不用。
 */

import { Loader2, UserRoundCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ANCHOR_CREDIT_COST_PER_CHARACTER,
  splitAnchorTargets,
  type AnchorCandidate,
} from "../hooks/use-character-anchor";

interface CharacterAnchorDialogProps {
  /** 缺定妆照的角色（空数组时不渲染） */
  missing: AnchorCandidate[];
  /** 补锚进行中（禁用全部按钮并显示进度） */
  isAnchoring: boolean;
  anchorProgress: { done: number; total: number } | null;
  onConfirmAnchor: () => void;
  onSkip: () => void;
  onCancel: () => void;
}

export function CharacterAnchorDialog({
  missing,
  isAnchoring,
  anchorProgress,
  onConfirmAnchor,
  onSkip,
  onCancel,
}: CharacterAnchorDialogProps) {
  // 报价按实际要花钱的部分算：已有参考图的角色走零成本提锚（把已有图提为
  // 定妆锚，不重画），把它们也计入积分会虚报成本、白白劝退用户。
  const { toGenerate, toPromote, cost } = splitAnchorTargets(missing);

  return (
    <Dialog
      open={missing.length > 0}
      onOpenChange={(open) => {
        // 补锚进行中不允许点遮罩关闭（请求已发出，关掉只会让用户失去进度感知）
        if (!open && !isAnchoring) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRoundCheck size={18} className="text-agent" />
            先给角色拍定妆照？
          </DialogTitle>
          <DialogDescription>
            定妆照是角色在所有画面里的长相基准。
            {missing.length} 个角色还没有定妆照，直接出图的话，
            同一个人在不同镜头里很可能长得不一样。
          </DialogDescription>
        </DialogHeader>

        <div className="border-border bg-card/50 rounded-lg border p-3">
          <p className="text-muted-foreground mb-2 text-xs">待拍定妆照的角色</p>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((character) => (
              <span
                key={character.id}
                className="bg-secondary rounded-full px-2 py-0.5 text-xs"
              >
                {character.name}
              </span>
            ))}
          </div>
          <div className="text-muted-foreground mt-3 space-y-1 text-xs">
            {toGenerate.length > 0 && (
              <p>
                为 {toGenerate.length} 个角色生成定妆照，消耗{" "}
                <span className="text-foreground font-medium">{cost} 积分</span>
                （每个角色 {ANCHOR_CREDIT_COST_PER_CHARACTER} 积分）。
              </p>
            )}
            {/* 已有参考图的角色只需把已有图设为定妆锚，不重画、不花钱——
                这件事值得单独说，否则用户看不出为什么 N 个角色只收 M 份钱 */}
            {toPromote.length > 0 && (
              <p>
                其中 {toPromote.length}{" "}
                个角色已有参考图，直接采用其现有图作定妆照，
                <span className="text-foreground font-medium">不额外扣费</span>
                。
              </p>
            )}
            <p>完成后自动继续出图。</p>
          </div>
        </div>

        {anchorProgress && (
          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 size={13} className="animate-spin" />
            正在处理定妆照 {anchorProgress.done}/{anchorProgress.total}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isAnchoring}
            className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm transition disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={isAnchoring}
            className="bg-secondary hover:bg-secondary/80 rounded-lg px-3 py-2 text-sm transition disabled:opacity-50"
            title="不生成定妆照直接出图；同一角色在不同镜头可能不一致"
          >
            不拍，直接出图
          </button>
          <button
            type="button"
            onClick={onConfirmAnchor}
            disabled={isAnchoring}
            className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50"
          >
            {isAnchoring && <Loader2 size={14} className="animate-spin" />}
            {/* 全部走零成本提锚时不显示「0 积分」（读着像在强调收费），
                直接说「设定妆照」——因为这时确实一张都不用重画 */}
            {cost > 0 ? `拍定妆照（${cost} 积分）` : "设为定妆照（免费）"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
