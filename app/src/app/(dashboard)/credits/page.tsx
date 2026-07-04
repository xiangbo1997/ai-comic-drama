"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/components/ui/toast";
import { toFriendlyError } from "@/lib/error-copy";
import {
  fetchCredits,
  fetchCheckinStatus,
  fetchInviteInfo,
  doCheckin,
  fetchPaymentMethods,
  createPayment,
  checkOrderStatus,
  type SelectedProduct,
  type PaymentResult,
} from "./components/constants";
import { CurrentCreditsCard } from "./components/CurrentCreditsCard";
import { CheckinCard } from "./components/CheckinCard";
import { CreditTransactionsCard } from "./components/CreditTransactionsCard";
import { InviteCard } from "./components/InviteCard";
import { PurchaseSection } from "./components/PurchaseSection";
import { BenefitsFaq } from "./components/BenefitsFaq";
import { PaymentModal } from "./components/PaymentModal";

export default function CreditsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedProduct, setSelectedProduct] =
    useState<SelectedProduct | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(
    null
  );
  const [pollingOrder, setPollingOrder] = useState<string | null>(null);
  // 支付终态提示（过期/取消/失败/确认超时）——此前轮询只判断成功，
  // 其余状态永远停在「等待支付...」（ux-config P0-1）
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const pollCountRef = useRef(0);

  const {
    data: creditsData,
    isLoading: creditsLoading,
    isError: creditsError,
  } = useQuery({
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
      queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
    },
    onError: (error) => {
      toast.error(toFriendlyError(error, "签到失败，请稍后重试").message);
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

  // 轮询订单状态：成功 / 终态（过期、取消、失败）/ 超时三路出口，
  // 不再只判断 isPaid 导致其余情况永远转圈
  useEffect(() => {
    if (!pollingOrder) return;
    pollCountRef.current = 0;
    const MAX_POLLS = 100; // 3s × 100 = 5 分钟确认上限

    const TERMINAL_MESSAGES: Record<string, string> = {
      EXPIRED: "订单已过期，未扣款，请重新下单",
      CANCELLED: "订单已取消，如需购买请重新下单",
      FAILED: "支付失败，请重新下单；若已扣款请联系客服",
    };

    const interval = setInterval(async () => {
      pollCountRef.current += 1;
      try {
        const order = await checkOrderStatus(pollingOrder);
        if (order.isPaid) {
          setPollingOrder(null);
          setShowPaymentModal(false);
          setPaymentResult(null);
          setSelectedProduct(null);
          queryClient.invalidateQueries({ queryKey: ["credits"] });
          queryClient.invalidateQueries({ queryKey: ["credit-transactions"] });
          toast.success(`支付成功！获得 ${order.credits} 积分`);
          return;
        }
        const terminalMessage = TERMINAL_MESSAGES[order.status as string];
        if (terminalMessage) {
          // 回到支付方式选择视图并给出明确文案 + 重新下单出口
          setPollingOrder(null);
          setPaymentResult(null);
          setPaymentError(terminalMessage);
          return;
        }
      } catch {
        // 单次查询失败不终止轮询（网络抖动容忍）；持续失败由超时计数兜底
      }
      if (pollCountRef.current >= MAX_POLLS) {
        setPollingOrder(null);
        setPaymentResult(null);
        setPaymentError(
          "支付确认超时：若已完成支付，请稍后刷新页面查看余额；未支付可重新下单"
        );
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
    setPaymentError(null);
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = () => {
    if (!selectedProduct || !selectedMethod) return;
    setPaymentError(null);
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
    setPaymentError(null);
  };

  return (
    <div className="container mx-auto max-w-4xl px-6 py-8">
      {/* Current Credits */}
      <CurrentCreditsCard
        credits={creditsData?.credits}
        isLoading={creditsLoading}
        isError={creditsError}
      />

      {/* Daily Checkin */}
      <CheckinCard
        checkinData={checkinData}
        checkinLoading={checkinLoading}
        isPending={checkinMutation.isPending}
        isSuccess={checkinMutation.isSuccess}
        successData={checkinMutation.data}
        onCheckin={() => checkinMutation.mutate()}
      />

      {/* 积分明细 */}
      <CreditTransactionsCard />

      {/* Invite Friends */}
      <InviteCard inviteData={inviteData} />

      {/* 积分包 + 会员订阅 */}
      <PurchaseSection onPurchase={handlePurchase} />

      {/* 会员权益 + FAQ */}
      <BenefitsFaq />

      {/* Payment Modal */}
      {showPaymentModal && selectedProduct && (
        <PaymentModal
          selectedProduct={selectedProduct}
          paymentInfo={paymentInfo}
          selectedMethod={selectedMethod}
          onSelectMethod={setSelectedMethod}
          paymentResult={paymentResult}
          pollingOrder={pollingOrder}
          paymentError={paymentError}
          isPending={paymentMutation.isPending}
          isError={paymentMutation.isError}
          errorMessage={paymentMutation.error?.message}
          onConfirm={handleConfirmPayment}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
