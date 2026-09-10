"use client";

/**
 * 出图前的「角色定妆锚」关口 + 自动补锚（包 B · B2/B3）
 *
 * 治的是什么：跨镜头人物一致性的地基是每个角色有一张定妆锚（canonicalImageUrl，
 * 权威依据见 lib/character-finalized.ts）。产品此前只在两条路径上弹一句「建议先到
 * 角色页生成三视图」的劝退式确认，用户点「继续」就得到一整批不像的图；而底部
 * 「批量图片」「逐镜出图」「制片人向导」三条路径连这句提示都没有。
 *
 * 现在改成：检测到缺锚 → 明确告知要花多少积分 → 用户确认后**就地补锚**再出图。
 * 补锚走轻量路径（generate-reference count=1，3 积分/角色），不是 9 积分的三视图。
 *
 * 为什么必须事前告知而非静默消费：项目既有设计哲学是「避免擅自烧额度」
 * （见 WorkflowPanel.tsx / batchGenerateVideos 的衔接提示注释：不阻断、不自动出图）。
 * 自动补锚会真实扣费，所以先摊开成本让用户点头，且始终留「不补也继续」的出口。
 *
 * 降级：单个角色补锚失败不阻断整批——其余角色照常补、出图照常继续，
 * 失败角色在结果 toast 里点名，用户知道哪几个人可能不像。
 */

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { toFriendlyError } from "@/lib/error-copy";
import { isCharacterFinalized } from "@/lib/character-finalized";
import {
  generateReference,
  selectReference,
} from "@/app/(dashboard)/characters/components/constants";

/** 单张纯 AI 生成参考图的积分成本（与 generate-reference 路由的 perImageCost 同源） */
export const ANCHOR_CREDIT_COST_PER_CHARACTER = 3;

/** 待补锚角色的最小形状（project.characters[].character 满足） */
export interface AnchorCandidate {
  id: string;
  name: string;
  canonicalImageUrl?: string | null;
  /**
   * 已有参考图。非空 + canonical 为空 = 可走零成本提锚快路径
   * （历史数据、上传过垫图、早期生成过参考图但从未定稿的角色）。
   */
  referenceImages?: string[];
}

/** 可零成本提锚的角色：已有图但没设定妆锚，直接把首图提为锚即可，不花积分 */
function canPromoteExistingImage(character: AnchorCandidate): boolean {
  return Boolean(
    !character.canonicalImageUrl?.trim() && character.referenceImages?.[0]
  );
}

/**
 * 补锚的实际成本拆分：已有图的角色走零成本提锚，只有一张图都没有的才需生成。
 * 弹窗据此报价——把「其实不花钱」的角色也算进积分会虚报成本、劝退用户。
 */
export function splitAnchorTargets(targets: AnchorCandidate[]): {
  /** 需生成定妆照（扣积分） */
  toGenerate: AnchorCandidate[];
  /** 仅需提锚（零积分） */
  toPromote: AnchorCandidate[];
  /** 总积分消耗 */
  cost: number;
} {
  const toPromote = targets.filter(canPromoteExistingImage);
  const toGenerate = targets.filter((t) => !canPromoteExistingImage(t));
  return {
    toGenerate,
    toPromote,
    cost: toGenerate.length * ANCHOR_CREDIT_COST_PER_CHARACTER,
  };
}

/** 补锚确认弹窗的状态（null = 未打开） */
export interface AnchorPromptState {
  /** 缺锚角色（含 id/name），用于列名字与算积分 */
  missing: AnchorCandidate[];
  /** 用户选择补锚 */
  onConfirmAnchor: () => void;
  /** 用户选择不补、直接出图 */
  onSkip: () => void;
  /** 用户取消整个操作 */
  onCancel: () => void;
}

/** 关口结果：放行（继续出图）或中止 */
type GateResult = boolean;

/**
 * 从项目关联角色里挑出缺定妆锚的角色。
 * 与 collectUnfinalizedCharacterNames 同判据（isCharacterFinalized），
 * 但回传完整对象——补锚需要 id。
 */
export function collectUnanchoredCharacters(
  projectCharacters: Array<{ character: AnchorCandidate }> | undefined
): AnchorCandidate[] {
  if (!projectCharacters?.length) return [];
  const seen = new Set<string>();
  const missing: AnchorCandidate[] = [];
  for (const { character } of projectCharacters) {
    if (isCharacterFinalized(character) || seen.has(character.id)) continue;
    seen.add(character.id);
    missing.push(character);
  }
  return missing;
}

interface UseCharacterAnchorArgs {
  /** 项目 id（补锚后 await 重拉项目用） */
  projectId: string;
  /** 项目关联角色（project.characters） */
  projectCharacters: Array<{ character: AnchorCandidate }> | undefined;
}

export interface UseCharacterAnchorResult {
  /**
   * 出图前统一关口：无缺锚角色时直接放行（不打扰）；有缺锚时弹窗让用户
   * 三选一（补锚 / 不补继续 / 取消）。返回 true 表示继续出图。
   *
   * 四条出图路径（一键 workflow / 顶部批量 / 底部批量 / 逐镜）与制片人路径
   * 全部走这一个函数，保证门禁语义单一真源。
   */
  ensureAnchors: () => Promise<GateResult>;
  /** 补锚确认弹窗状态（null = 关闭）；由页面渲染 CharacterAnchorDialog */
  anchorPrompt: AnchorPromptState | null;
  /** 补锚进行中（禁用触发入口、显示进度） */
  isAnchoring: boolean;
  /** 补锚进度 { done, total }（未运行时为 null） */
  anchorProgress: { done: number; total: number } | null;
}

export function useCharacterAnchor({
  projectId,
  projectCharacters,
}: UseCharacterAnchorArgs): UseCharacterAnchorResult {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [anchorPrompt, setAnchorPrompt] = useState<AnchorPromptState | null>(
    null
  );
  const [anchorProgress, setAnchorProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  /**
   * 逐角色补锚：生成 1 张纯 AI 参考图 → 入库（首图会同时写 canonicalImageUrl）。
   * 串行执行避免并发 N 次出图触发限流（与向导建档、批量出图同策略）。
   * 单角色失败只记名字，不 throw——整批继续。
   */
  const anchorCharacters = useCallback(
    async (targets: AnchorCandidate[]): Promise<void> => {
      if (targets.length === 0) return;
      setAnchorProgress({ done: 0, total: targets.length });
      const failed: string[] = [];

      for (const target of targets) {
        try {
          const existing = target.referenceImages?.[0];
          if (canPromoteExistingImage(target) && existing) {
            // 零成本提锚快路径：角色已有参考图、只是没设定妆锚（历史数据、
            // 上传过垫图等）。把已有图回传给 select-reference 即命中其幂等
            // 分支——不生成、不扣积分，只补写 canonicalImageUrl
            // （服务端判据已由包 A 改为 needsCanonical，见该路由注释）。
            // 没有这条快路径就得白花 3 积分重画一张，且画出来的还不是用户
            // 已经认可的那张脸。
            await selectReference(target.id, existing);
          } else {
            const { candidates } = await generateReference(target.id, {
              count: 1,
            });
            const first = candidates[0];
            if (!first?.imageUrl) throw new Error("未生成任何候选定妆照");
            // count=1 自动入库（照抄角色页 page.tsx 的单张自动点选先例）；
            // 该端点在 canonical 为空时写入 canonicalImageUrl，定妆锚由此建立。
            await selectReference(target.id, first.imageUrl);
          }
        } catch (error) {
          failed.push(target.name);
          // 首个失败给出可行动的原因（积分不足会附「去充值」出口）
          if (failed.length === 1) {
            const fe = toFriendlyError(error, "定妆照生成失败");
            toast.error(`${target.name} 定妆照生成失败：${fe.message}`, fe.cta);
          }
        }
        setAnchorProgress((prev) =>
          prev ? { ...prev, done: prev.done + 1 } : prev
        );
      }

      // 角色页缓存失效即可（下次进页面重拉）
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      // 项目必须 **await refetch** 而非 invalidate：紧接着就要出图，
      // derivePromptInputs 读的是 React Query 缓存里的 project.characters。
      // invalidate 只标记过期、重拉是异步的，mutate 会抢在新数据到达之前发出，
      // 刚花钱拍的定妆照就拿不到——这一批图依然不像（等于白扣费）。
      await queryClient.refetchQueries({ queryKey: ["project", projectId] });
      // 进度态留到重拉完成后再清：期间弹窗按钮仍需保持禁用，
      // 否则用户能在「已扣费、数据还没回来」的窗口里点取消。
      setAnchorProgress(null);

      const ok = targets.length - failed.length;
      if (failed.length === 0) {
        toast.success(`已为 ${ok} 个角色生成定妆照，跨镜头一致性已就位`);
        return;
      }
      toast.warning(
        `定妆照完成 ${ok}/${targets.length}：${failed.join("、")} 未成功，` +
          `这些角色在后续画面里可能不像，可稍后在角色页重试`
      );
    },
    [projectId, queryClient, toast]
  );

  const ensureAnchors = useCallback(async (): Promise<GateResult> => {
    const missing = collectUnanchoredCharacters(projectCharacters);
    // 全部已定妆 / 项目无角色：直接放行，零打扰（保持既有「不硬阻断」语义）
    if (missing.length === 0) return true;

    // 弹窗三选一：把 Promise 的 resolve 挂到三个回调上，由弹窗按钮驱动。
    // 选「补锚」时刻意**不关弹窗**——补锚要花几十秒，弹窗留着显示逐角色进度，
    // 补完再由下方统一关闭（否则用户点完按钮界面毫无反应）。
    const choice = await new Promise<"anchor" | "skip" | "cancel">(
      (resolve) => {
        setAnchorPrompt({
          missing,
          onConfirmAnchor: () => resolve("anchor"),
          onSkip: () => {
            setAnchorPrompt(null);
            resolve("skip");
          },
          onCancel: () => {
            setAnchorPrompt(null);
            resolve("cancel");
          },
        });
      }
    );

    if (choice === "cancel") return false;
    if (choice === "skip") {
      // 用户明确拒绝补锚：继续出图，但把后果说清楚（不再是静默通过）
      toast.warning(
        `未生成定妆照就出图：${missing
          .map((c) => c.name)
          .join("、")} 在各镜头之间可能长得不一样`
      );
      return true;
    }

    await anchorCharacters(missing);
    setAnchorPrompt(null);
    // 补锚失败也继续出图（降级不阻断）：失败角色已在 anchorCharacters 里点名警示
    return true;
  }, [projectCharacters, anchorCharacters, toast]);

  return {
    ensureAnchors,
    anchorPrompt,
    isAnchoring: anchorProgress !== null,
    anchorProgress,
  };
}
