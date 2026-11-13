import type { ImgHTMLAttributes } from "react";

// 浏览器宿主没有 Next 图片优化服务；保留图像DOM与可访问属性，不测试图片代理。
export default function ImageFixture({
  fill: _fill,
  unoptimized: _unoptimized,
  priority: _priority,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean;
  unoptimized?: boolean;
  priority?: boolean;
}) {
  return <img {...props} alt={props.alt ?? ""} />;
}
