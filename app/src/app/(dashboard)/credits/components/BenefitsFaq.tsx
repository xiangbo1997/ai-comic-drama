import { Check } from "lucide-react";

export function BenefitsFaq() {
  return (
    <>
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
    </>
  );
}
