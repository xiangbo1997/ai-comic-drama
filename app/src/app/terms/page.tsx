import Link from "next/link";

export const metadata = {
  title: "服务条款 - AI 漫剧工作台",
};

/**
 * 服务条款静态页。
 * 此前登录页的「服务条款」是 href="#" 死链（合规缺口），先以基础条款上线，
 * 后续由运营方按实际主体信息完善。
 */
export default function TermsPage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="container mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/login"
          className="text-primary mb-8 inline-block text-sm hover:underline"
        >
          ← 返回登录
        </Link>
        <h1 className="mb-2 text-3xl font-bold">服务条款</h1>
        <p className="text-muted-foreground mb-8 text-sm">
          最后更新：2026 年 7 月
        </p>

        <div className="space-y-6 text-sm leading-6">
          <section>
            <h2 className="mb-2 text-lg font-semibold">1. 服务说明</h2>
            <p className="text-muted-foreground">
              AI 漫剧工作台（以下简称「本平台」）提供将文本内容转化为
              分镜、图像、视频与配音的 AI 辅助创作工具。AI
              生成能力依赖你自行配置的第三方模型服务 API
              Key，对应的模型调用费用由你与第三方服务商结算。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">2. 账号与积分</h2>
            <p className="text-muted-foreground">
              注册即赠送体验积分。积分用于平台内的生成与导出操作，按操作类型
              定额消耗；生成失败的扣费将自动退还，明细可在「积分」页查询。
              积分不可转让、不支持兑换现金；充值积分的退款政策以购买页说明为准。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">3. 内容与版权</h2>
            <p className="text-muted-foreground">
              你须对输入本平台的文本、图片素材拥有合法权利。基于你的输入生成的
              作品归你所有；因输入内容引发的侵权责任由你自行承担。禁止利用本
              平台生成违反法律法规的内容，平台设有内容安全审核并保留处置权。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">4. 服务变更与终止</h2>
            <p className="text-muted-foreground">
              平台可能因维护、升级临时中断服务，将尽量提前通知。若你违反本
              条款，平台有权限制或终止你的账号使用。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">5. 联系我们</h2>
            <p className="text-muted-foreground">
              对本条款有任何疑问，请联系 support@aicomic.com。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
