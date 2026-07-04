import { Coins, Loader2 } from "lucide-react";

interface CurrentCreditsCardProps {
  credits: number | undefined;
  isLoading: boolean;
  isError: boolean;
}

export function CurrentCreditsCard({
  credits,
  isLoading,
  isError,
}: CurrentCreditsCardProps) {
  return (
    <div className="bg-primary mb-8 rounded-2xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-primary-foreground/80 mb-1">当前积分</p>
          <div className="flex items-center gap-2">
            <Coins size={32} className="text-yellow-400" />
            {isLoading ? (
              <Loader2 size={32} className="animate-spin" />
            ) : isError ? (
              // 加载失败显示占位而非 0——「余额 0」会让用户误以为积分被清空
              <span className="text-4xl font-bold" title="余额加载失败">
                —
              </span>
            ) : (
              <span className="text-4xl font-bold">{credits ?? 0}</span>
            )}
          </div>
        </div>
        <div className="text-primary-foreground/80 text-right text-sm">
          <p>图片生成: 1-3积分/张</p>
          <p>视频生成: 10积分/5秒</p>
          <p>语音合成: 2积分/100字</p>
        </div>
      </div>
    </div>
  );
}
