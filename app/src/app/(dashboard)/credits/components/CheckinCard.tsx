import { Calendar, Flame, Check, Gift, Loader2 } from "lucide-react";

interface CheckinCardProps {
  checkinData:
    | {
        streak?: number;
        monthlyCheckins?: string[];
        checkedInToday?: boolean;
        creditsPerCheckin?: number;
      }
    | undefined;
  checkinLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  successData: { creditsEarned: number } | undefined;
  onCheckin: () => void;
}

export function CheckinCard({
  checkinData,
  checkinLoading,
  isPending,
  isSuccess,
  successData,
  onCheckin,
}: CheckinCardProps) {
  // 生成日历数据
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = new Date(year, month, 1).getDay();

  const calendarDays = [];
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  const checkedDates = new Set(checkinData?.monthlyCheckins || []);

  return (
    <div className="bg-card mb-8 rounded-xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar size={24} className="text-primary" />
          <h2 className="text-lg font-semibold">每日签到</h2>
        </div>
        {(checkinData?.streak ?? 0) > 0 && (
          <div className="flex items-center gap-1 text-orange-400">
            <Flame size={18} />
            <span className="text-sm">连续 {checkinData?.streak} 天</span>
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="mb-4">
        <div className="text-muted-foreground mb-2 text-center text-sm">
          {year}年{month + 1}月
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs">
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
            <div key={day} className="text-muted-foreground py-1">
              {day}
            </div>
          ))}
          {calendarDays.map((day, index) => {
            if (day === null) {
              return <div key={`empty-${index}`} />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isChecked = checkedDates.has(dateStr);
            const isToday = day === today.getDate();

            return (
              <div
                key={day}
                className={`rounded-lg py-2 ${
                  isChecked
                    ? "bg-primary text-primary-foreground"
                    : isToday
                      ? "bg-primary/20 text-primary ring-primary ring-1"
                      : "text-muted-foreground"
                }`}
              >
                {isChecked ? <Check size={14} className="mx-auto" /> : day}
              </div>
            );
          })}
        </div>
      </div>

      {/* Checkin Button */}
      <button
        onClick={onCheckin}
        disabled={checkinLoading || isPending || checkinData?.checkedInToday}
        className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium transition ${
          checkinData?.checkedInToday
            ? "bg-secondary text-muted-foreground cursor-not-allowed"
            : "bg-primary hover:bg-primary/90"
        }`}
      >
        {isPending ? (
          <Loader2 size={20} className="animate-spin" />
        ) : checkinData?.checkedInToday ? (
          <>
            <Check size={20} />
            今日已签到
          </>
        ) : (
          <>
            <Gift size={20} />
            签到领取 {checkinData?.creditsPerCheckin || 5} 积分
          </>
        )}
      </button>

      {isSuccess && (
        <p className="mt-2 text-center text-sm text-green-400">
          签到成功！获得 {successData?.creditsEarned} 积分
        </p>
      )}
    </div>
  );
}
