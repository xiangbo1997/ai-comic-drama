import { X, Loader2, CreditCard, Check } from "lucide-react";
import type { PaymentInfo, SelectedProduct, PaymentResult } from "./constants";

interface PaymentModalProps {
  selectedProduct: SelectedProduct;
  paymentInfo: PaymentInfo | undefined;
  selectedMethod: string;
  onSelectMethod: (methodId: string) => void;
  paymentResult: PaymentResult | null;
  pollingOrder: string | null;
  paymentError: string | null;
  isPending: boolean;
  isError: boolean;
  errorMessage: string | undefined;
  onConfirm: () => void;
  onClose: () => void;
}

export function PaymentModal({
  selectedProduct,
  paymentInfo,
  selectedMethod,
  onSelectMethod,
  paymentResult,
  pollingOrder,
  paymentError,
  isPending,
  isError,
  errorMessage,
  onConfirm,
  onClose,
}: PaymentModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-card mx-4 w-full max-w-md rounded-xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-semibold">确认支付</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="关闭"
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
            <p className="text-muted-foreground text-sm">请使用微信扫码支付</p>
            {pollingOrder && (
              <div className="text-primary mt-2 flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">等待支付...</span>
              </div>
            )}
          </div>
        )}

        {/* 支付终态提示（过期/取消/失败/超时）：回到方式选择即可重新下单 */}
        {paymentError && !paymentResult && (
          <div className="bg-destructive/10 text-destructive mb-4 rounded-lg p-3 text-center text-sm">
            {paymentError}
          </div>
        )}

        {/* Payment Methods */}
        {!paymentResult && (
          <>
            <div className="mb-6">
              <p className="text-muted-foreground mb-3 text-sm">选择支付方式</p>
              <div className="space-y-2">
                {paymentInfo?.methods && paymentInfo.methods.length > 0 ? (
                  paymentInfo.methods.map((method) => (
                    <button
                      key={method.id}
                      onClick={() => onSelectMethod(method.id)}
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
              onClick={onConfirm}
              disabled={!selectedMethod || isPending}
              className="bg-primary hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg py-3 font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? (
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

            {isError && (
              <p className="mt-2 text-center text-sm text-red-400">
                {errorMessage || "创建订单失败，请重试"}
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
              onClick={() => window.open(paymentResult.paymentUrl, "_blank")}
              className="text-primary hover:text-primary/80 mt-4 text-sm"
            >
              重新打开支付页面
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
