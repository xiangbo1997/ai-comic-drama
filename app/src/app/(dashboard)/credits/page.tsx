"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Coins,
  Check,
  Loader2,
  Calendar,
  Gift,
  Flame,
  Users,
  Copy,
  Share2,
  CreditCard,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/toast";

interface PaymentMethod {
  id: string;
  name: string;
  icon: string;
}

interface PaymentInfo {
  methods: PaymentMethod[];
  packages: Array<{
    id: string;
    name: string;
    price: number;
    credits: number;
  }>;
  plans: Array<{
    id: string;
    name: string;
    price: number;
    credits: number;
    period: string;
  }>;
}

const PACKAGES = [
  {
    id: "trial",
    name: "体验包",
    price: 9.9,
    credits: 100,
    description: "约1条完整漫剧",
    popular: false,
  },
  {
    id: "basic",
    name: "基础包",
    price: 49,
    credits: 600,
    description: "约5条漫剧",
    popular: true,
  },
  {
    id: "pro",
    name: "专业包",
    price: 199,
    credits: 3000,
    description: "约25条漫剧",
    popular: false,
  },
];

const MONTHLY_PLANS = [
  {
    id: "monthly",
    name: "月度会员",
    price: 99,
    credits: 1500,
    description: "每月1500积分",
    period: "月",
  },
  {
    id: "yearly",
    name: "年度会员",
    price: 999,
    credits: 20000,
    description: "每月约1666积分",
    period: "年",
    discount: "省17%",
  },
];

async function fetchCredits() {
  const res = await fetch("/api/user/credits");
  if (!res.ok) throw new Error("Failed to fetch credits");
  return res.json();
}

async function fetchCheckinStatus() {
  const res = await fetch("/api/user/checkin");
  if (!res.ok) throw new Error("Failed to fetch checkin status");
  return res.json();
}

async function fetchInviteInfo() {
  const res = await fetch("/api/user/invite");
  if (!res.ok) throw new Error("Failed to fetch invite info");
  return res.json();
}

async function doCheckin() {
  const res = await fetch("/api/user/checkin", { method: "POST" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to checkin");
  }
  return res.json();
}

async function fetchPaymentMethods(): Promise<PaymentInfo> {
  const res = await fetch("/api/payment/create");
  if (!res.ok) throw new Error("Failed to fetch payment methods");
  return res.json();
}

async function createPayment(params: {
  type: "credits" | "subscription";
  productId: string;
  paymentMethod: string;
}) {
  const res = await fetch("/api/payment/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create payment");
  }
  return res.json();
}

async function checkOrderStatus(orderNo: string) {
  const res = await fetch(`/api/payment/order/${orderNo}`);
  if (!res.ok) throw new Error("Failed to check order");
  return res.json();
}

export default function CreditsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{
    type: "credits" | "subscription";
    id: string;
    name: string;
    price: number;
    credits: number;
  } | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [paymentResult, setPaymentResult] = useState<{
    orderNo: string;
    qrCode?: string;
    paymentUrl?: string;
  } | null>(null);
  const [pollingOrder, setPollingOrder] = useState<string | null>(null);

  const { data: creditsData, isLoading: creditsLoading } = useQuery({
    queryKey: ["credits"],
    queryFn: fetchCredits,
  });

  const { data: checkinData, isLoading: checkinLoading } = useQuery({
    queryKey: ["checkin"],
    queryFn: fetchCheckinStatus,
  });

  const { data: inviteData } = useQuery({
    queryKey: ["invite"],
    queryFn: fetchInviteInfo,
  });

  const checkinMutation = useMutation({
    mutationFn: doCheckin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      queryClient.invalidateQueries({ queryKey: ["checkin"] });
    },
  });

  const { data: paymentInfo } = useQuery({
    queryKey: ["paymentMethods"],
    queryFn: fetchPaymentMethods,
  });

  const paymentMutation = useMutation({
    mutationFn: createPayment,
    onSuccess: (data) => {
      setPaymentResult({
        orderNo: data.orderNo,
        qrCode: data.qrCode,
        paymentUrl: data.paymentUrl,
      });
      // 如果有支付链接，跳转
      if (data.paymentUrl) {
        window.open(data.paymentUrl, "_blank");
      }
      // 开始轮询订单状态
      setPollingOrder(data.orderNo);
    },
  });

  // 轮询订单状态
  useEffect(() => {
    if (!pollingOrder) return;

    const interval = setInterval(async () => {
      try {
        const order = await checkOrderStatus(pollingOrder);
        if (order.isPaid) {
          setPollingOrder(null);
          setShowPaymentModal(false);
          setPaymentResult(null);
          setSelectedProduct(null);
          queryClient.invalidateQueries({ queryKey: ["credits"] });
          toast.success(`支付成功！获得 ${order.credits} 积分`);
        }
      } catch (error) {
        console.error("Check order error:", error);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [pollingOrder, queryClient, toast]);

  const handlePurchase = (
    type: "credits" | "subscription",
    product: {
      id: string;
      name: string;
      price: number;
      credits: number;
    }
  ) => {
    setSelectedProduct({ type, ...product });
    setSelectedMethod(paymentInfo?.methods[0]?.id || "");
    setPaymentResult(null);
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = () => {
    if (!selectedProduct || !selectedMethod) return;
    paymentMutation.mutate({
      type: selectedProduct.type,
      productId: selectedProduct.id,
      paymentMethod: selectedMethod,
    });
  };

  const handleCloseModal = () => {
    setShowPaymentModal(false);
    setPaymentResult(null);
    setSelectedProduct(null);
    setPollingOrder(null);
  };

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
    <div className="container mx-auto max-w-4xl px-6 py-8">
      {/* Current Credits */}
      <div className="bg-primary mb-8 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-primary-foreground/80 mb-1">当前积分</p>
            <div className="flex items-center gap-2">
              <Coins size={32} className="text-yellow-400" />
              {creditsLoading ? (
                <Loader2 size={32} className="animate-spin" />
              ) : (
                <span className="text-4xl font-bold">
                  {creditsData?.credits ?? 0}
                </span>
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

      {/* Daily Checkin */}
      <div className="bg-card mb-8 rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar size={24} className="text-primary" />
            <h2 className="text-lg font-semibold">每日签到</h2>
          </div>
          {checkinData?.streak > 0 && (
            <div className="flex items-center gap-1 text-orange-400">
              <Flame size={18} />
              <span className="text-sm">连续 {checkinData.streak} 天</span>
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
          onClick={() => checkinMutation.mutate()}
          disabled={
            checkinLoading ||
            checkinMutation.isPending ||
            checkinData?.checkedInToday
          }
          className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium transition ${
            checkinData?.checkedInToday
              ? "bg-secondary text-muted-foreground cursor-not-allowed"
              : "bg-primary hover:bg-primary/90"
          }`}
        >
          {checkinMutation.isPending ? (
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

        {checkinMutation.isSuccess && (
          <p className="mt-2 text-center text-sm text-green-400">
            签到成功！获得 {checkinMutation.data.creditsEarned} 积分
          </p>
        )}
      </div>

      {/* Invite Friends */}
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

      {/* One-time Packages */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">积分包</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {PACKAGES.map((pkg) => (
            <div
              key={pkg.id}
              className={`bg-card relative rounded-xl border-2 p-6 transition ${
                pkg.popular
                  ? "border-primary"
                  : "hover:border-border border-transparent"
              }`}
            >
              {pkg.popular && (
                <div className="bg-primary absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs">
                  最受欢迎
                </div>
              )}
              <h3 className="mb-2 text-xl font-semibold">{pkg.name}</h3>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">¥{pkg.price}</span>
              </div>
              <div className="mb-2 flex items-center gap-2 text-yellow-400">
                <Coins size={18} />
                <span className="font-medium">{pkg.credits} 积分</span>
              </div>
              <p className="text-muted-foreground mb-4 text-sm">
                {pkg.description}
              </p>
              <button
                onClick={() =>
                  handlePurchase("credits", {
                    id: pkg.id,
                    name: pkg.name,
                    price: pkg.price,
                    credits: pkg.credits,
                  })
                }
                className={`w-full rounded-lg py-2 font-medium transition ${
                  pkg.popular
                    ? "bg-primary hover:bg-primary/90"
                    : "bg-secondary hover:bg-secondary/80"
                }`}
              >
                购买
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Subscription Plans */}
      <div className="mb-8">
        <h2 className="mb-4 text-lg font-semibold">会员订阅</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {MONTHLY_PLANS.map((plan) => (
            <div
              key={plan.id}
              className="bg-card hover:border-border rounded-xl border-2 border-transparent p-6 transition"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                {plan.discount && (
                  <span className="rounded bg-green-600 px-2 py-1 text-xs">
                    {plan.discount}
                  </span>
                )}
              </div>
              <div className="mb-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">¥{plan.price}</span>
                <span className="text-muted-foreground">/{plan.period}</span>
              </div>
              <div className="mb-2 flex items-center gap-2 text-yellow-400">
                <Coins size={18} />
                <span className="font-medium">{plan.credits} 积分</span>
              </div>
              <p className="text-muted-foreground mb-4 text-sm">
                {plan.description}
              </p>
              <button
                onClick={() =>
                  handlePurchase("subscription", {
                    id: plan.id,
                    name: plan.name,
                    price: plan.price,
                    credits: plan.credits,
                  })
                }
                className="bg-secondary hover:bg-secondary/80 w-full rounded-lg py-2 font-medium transition"
              >
                订阅
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Benefits */}
      <div className="bg-card rounded-xl p-6">
        <h2 className="mb-4 text-lg font-semibold">会员权益</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            "每月固定积分发放",
            "优先生成队列",
            "高清视频导出",
            "专属客服支持",
            "角色库无限存储",
            "批量生成功能",
          ].map((benefit) => (
            <div key={benefit} className="flex items-center gap-2">
              <Check size={18} className="text-green-500" />
              <span className="text-foreground">{benefit}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div className="text-muted-foreground mt-8 text-center text-sm">
        <p>如有问题，请联系客服：support@aicomic.com</p>
        <p className="mt-1">积分永久有效，不会过期</p>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card mx-4 w-full max-w-md rounded-xl p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-xl font-semibold">确认支付</h3>
              <button
                onClick={handleCloseModal}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={24} />
              </button>
            </div>

            {/* Product Info */}
            <div className="bg-secondary/50 mb-6 rounded-lg p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted-foreground">商品</span>
                <span className="font-medium">{selectedProduct.name}</span>
              </div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted-foreground">积分</span>
                <span className="font-medium text-yellow-400">
                  {selectedProduct.credits} 积分
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">金额</span>
                <span className="text-foreground text-2xl font-bold">
                  ¥{selectedProduct.price}
                </span>
              </div>
            </div>

            {/* Payment Result: QR Code */}
            {paymentResult?.qrCode && (
              <div className="mb-6 text-center">
                <div className="mb-2 inline-block rounded-lg bg-white p-4">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(paymentResult.qrCode)}`}
                    alt="支付二维码"
                    className="h-48 w-48"
                  />
                </div>
                <p className="text-muted-foreground text-sm">
                  请使用微信扫码支付
                </p>
                {pollingOrder && (
                  <div className="text-primary mt-2 flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">等待支付...</span>
                  </div>
                )}
              </div>
            )}

            {/* Payment Methods */}
            {!paymentResult && (
              <>
                <div className="mb-6">
                  <p className="text-muted-foreground mb-3 text-sm">
                    选择支付方式
                  </p>
                  <div className="space-y-2">
                    {paymentInfo?.methods && paymentInfo.methods.length > 0 ? (
                      paymentInfo.methods.map((method) => (
                        <button
                          key={method.id}
                          onClick={() => setSelectedMethod(method.id)}
                          className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 transition ${
                            selectedMethod === method.id
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-border"
                          }`}
                        >
                          {method.icon === "wechat" && (
                            <div className="flex h-8 w-8 items-center justify-center rounded bg-green-500">
                              <span className="text-foreground text-xs font-bold">
                                微信
                              </span>
                            </div>
                          )}
                          {method.icon === "alipay" && (
                            <div className="bg-primary flex h-8 w-8 items-center justify-center rounded">
                              <span className="text-foreground text-xs font-bold">
                                支付宝
                              </span>
                            </div>
                          )}
                          {method.icon === "credit-card" && (
                            <CreditCard size={24} className="text-purple-400" />
                          )}
                          <span>{method.name}</span>
                          {selectedMethod === method.id && (
                            <Check size={18} className="text-primary ml-auto" />
                          )}
                        </button>
                      ))
                    ) : (
                      <p className="text-muted-foreground py-4 text-center">
                        暂无可用支付方式，请联系管理员配置
                      </p>
                    )}
                  </div>
                </div>

                {/* Confirm Button */}
                <button
                  onClick={handleConfirmPayment}
                  disabled={!selectedMethod || paymentMutation.isPending}
                  className="bg-primary hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {paymentMutation.isPending ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      创建订单中...
                    </>
                  ) : (
                    <>
                      <CreditCard size={20} />
                      立即支付 ¥{selectedProduct.price}
                    </>
                  )}
                </button>

                {paymentMutation.isError && (
                  <p className="mt-2 text-center text-sm text-red-400">
                    {paymentMutation.error?.message || "创建订单失败，请重试"}
                  </p>
                )}
              </>
            )}

            {/* Payment URL Message */}
            {paymentResult?.paymentUrl && !paymentResult.qrCode && (
              <div className="text-center">
                <p className="text-muted-foreground mb-4 text-sm">
                  已在新窗口打开支付页面，请完成支付
                </p>
                {pollingOrder && (
                  <div className="text-primary flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm">等待支付完成...</span>
                  </div>
                )}
                <button
                  onClick={() =>
                    window.open(paymentResult.paymentUrl, "_blank")
                  }
                  className="text-primary hover:text-primary/80 mt-4 text-sm"
                >
                  重新打开支付页面
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
