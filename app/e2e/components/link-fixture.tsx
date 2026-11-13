import type { AnchorHTMLAttributes } from "react";

// 组件验收不启动 Next Router；仅将路由链接替换为等价锚点，不模拟导航成功。
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
