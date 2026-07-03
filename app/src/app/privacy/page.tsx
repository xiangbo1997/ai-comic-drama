import Link from "next/link";

export const metadata = {
  title: "隐私政策 - AI 漫剧工作台",
};

/**
 * 隐私政策静态页。
 * 此前登录页的「隐私政策」是 href="#" 死链（合规缺口），先以基础政策上线，
 * 后续由运营方按实际数据处理情况完善。
 */
export default function PrivacyPage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      <div className="container mx-auto max-w-3xl px-6 py-12">
        <Link
          href="/login"
          className="text-primary mb-8 inline-block text-sm hover:underline"
        >
          ← 返回登录
        </Link>
        <h1 className="mb-2 text-3xl font-bold">隐私政策</h1>
        <p className="text-muted-foreground mb-8 text-sm">
          最后更新：2026 年 7 月
        </p>

        <div className="space-y-6 text-sm leading-6">
          <section>
            <h2 className="mb-2 text-lg font-semibold">1. 我们收集的信息</h2>
            <p className="text-muted-foreground">
              注册信息（邮箱、昵称）、你主动输入的创作内容（文本、上传图片）、
              以及为完成生成所需的操作记录（任务状态、积分流水）。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">
              2. API Key 的存储与使用
            </h2>
            <p className="text-muted-foreground">
              你配置的第三方模型 API Key 使用 AES-256 加密存储，仅在执行你
              发起的生成任务时解密调用对应服务商接口，不用于任何其他用途，
              界面上仅展示掩码。你可以随时删除已保存的配置。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">3. 信息的使用与共享</h2>
            <p className="text-muted-foreground">
              你的创作内容仅用于为你提供生成服务；执行生成时，相关文本/图片会
              发送给你所配置的第三方模型服务商处理，其数据政策以对应服务商为准。
              除法律要求外，我们不会向其他第三方出售或共享你的个人信息。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">4. 数据的保留与删除</h2>
            <p className="text-muted-foreground">
              项目及其生成产物在你删除项目时一并删除且不可恢复。如需注销账号
              并删除全部数据，请联系客服处理。
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-semibold">5. 联系我们</h2>
            <p className="text-muted-foreground">
              对本政策有任何疑问，请联系 support@aicomic.com。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
