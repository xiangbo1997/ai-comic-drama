// 账户控件不属于本地布局验收范围，替换其网络/会话依赖。
export function UserMenu() {
  return (
    <button type="button" aria-label="用户菜单">
      用户
    </button>
  );
}
export function CreditsDisplay() {
  return <span>积分 10</span>;
}
