import { useState } from "react";
import { Users, Check, Copy, Share2 } from "lucide-react";

interface InviteCardProps {
  inviteData:
    | {
        inviteLink?: string;
        stats?: {
          completed: number;
          pending: number;
          totalEarned: number;
        };
      }
    | undefined;
}

export function InviteCard({ inviteData }: InviteCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyInviteLink = () => {
    if (inviteData?.inviteLink) {
      navigator.clipboard.writeText(inviteData.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (inviteData?.inviteLink && navigator.share) {
      try {
        await navigator.share({
          title: "AI 漫剧 - 邀请你加入",
          text: "一键将小说转化为漫剧视频，注册即送积分！",
          url: inviteData.inviteLink,
        });
      } catch {
        handleCopyInviteLink();
      }
    } else {
      handleCopyInviteLink();
    }
  };

  return (
    <div className="bg-card mb-8 rounded-xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <Users size={24} className="text-purple-400" />
        <h2 className="text-lg font-semibold">邀请好友</h2>
      </div>

      <div className="bg-primary/10 mb-4 rounded-lg p-4">
        <p className="mb-2 text-purple-200">
          邀请好友注册，双方各得{" "}
          <span className="text-foreground font-bold">50 积分</span>
        </p>
        <p className="text-muted-foreground text-sm">
          好友通过你的链接注册后，你将立即获得奖励
        </p>
      </div>

      {/* Invite Link */}
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          readOnly
          value={inviteData?.inviteLink || "加载中..."}
          className="bg-secondary text-foreground flex-1 rounded-lg px-4 py-2 text-sm"
        />
        <button
          onClick={handleCopyInviteLink}
          className="bg-secondary hover:bg-secondary/80 flex items-center gap-2 rounded-lg px-4 py-2 transition"
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
          {copied ? "已复制" : "复制"}
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 transition hover:bg-purple-700"
        >
          <Share2 size={18} />
          分享
        </button>
      </div>

      {/* Stats */}
      {inviteData?.stats && (
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-foreground text-2xl font-bold">
              {inviteData.stats.completed}
            </p>
            <p className="text-muted-foreground text-xs">成功邀请</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-foreground text-2xl font-bold">
              {inviteData.stats.pending}
            </p>
            <p className="text-muted-foreground text-xs">待注册</p>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-yellow-400">
              {inviteData.stats.totalEarned}
            </p>
            <p className="text-muted-foreground text-xs">获得积分</p>
          </div>
        </div>
      )}
    </div>
  );
}
