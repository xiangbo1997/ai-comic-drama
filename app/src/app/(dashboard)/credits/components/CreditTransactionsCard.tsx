import { useInfiniteQuery } from "@tanstack/react-query";
import { History, Loader2 } from "lucide-react";
import { fetchCreditTransactions, TX_TYPE_LABELS } from "./constants";

/* 积分明细：消费 / 失败退款 / 充值 / 签到全量可见。此前只有余额数字，
   用户遇到「生成失败但积分变少」时无法自证退款是否到账（ux-config P1-6） */
export function CreditTransactionsCard() {
  const {
    data: txData,
    isLoading: txLoading,
    isError: txError,
    fetchNextPage: fetchMoreTx,
    hasNextPage: hasMoreTx,
    isFetchingNextPage: fetchingMoreTx,
  } = useInfiniteQuery({
    queryKey: ["credit-transactions"],
    queryFn: ({ pageParam }) => fetchCreditTransactions(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const transactions = txData?.pages.flatMap((page) => page.transactions) ?? [];

  return (
    <div className="bg-card mb-8 rounded-xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <History size={24} className="text-primary" />
        <h2 className="text-lg font-semibold">积分明细</h2>
      </div>
      {txLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 size={24} className="text-muted-foreground animate-spin" />
        </div>
      ) : txError ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          明细加载失败，请刷新页面重试
        </p>
      ) : transactions.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-sm">
          暂无积分变动记录
        </p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="hover:bg-secondary/50 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="text-foreground truncate">
                  {TX_TYPE_LABELS[tx.type] ?? tx.type}
                  {tx.note ? (
                    <span className="text-muted-foreground"> · {tx.note}</span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {new Date(tx.createdAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={
                    tx.delta >= 0
                      ? "font-medium text-green-400"
                      : "text-foreground font-medium"
                  }
                >
                  {tx.delta >= 0 ? `+${tx.delta}` : tx.delta}
                </p>
                <p className="text-muted-foreground text-xs">
                  余额 {tx.balanceAfter}
                </p>
              </div>
            </div>
          ))}
          {hasMoreTx && (
            <button
              onClick={() => fetchMoreTx()}
              disabled={fetchingMoreTx}
              className="text-primary hover:bg-secondary/50 w-full rounded-lg py-2 text-center text-sm transition disabled:opacity-50"
            >
              {fetchingMoreTx ? "加载中..." : "加载更多"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
