import { Coins } from "lucide-react";
import { PACKAGES, MONTHLY_PLANS } from "./constants";

interface PurchaseSectionProps {
  onPurchase: (
    type: "credits" | "subscription",
    product: {
      id: string;
      name: string;
      price: number;
      credits: number;
    }
  ) => void;
}

export function PurchaseSection({ onPurchase }: PurchaseSectionProps) {
  return (
    <>
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
                  onPurchase("credits", {
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
                  onPurchase("subscription", {
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
    </>
  );
}
