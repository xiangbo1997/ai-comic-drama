const router = {
  push: (path: string) => {
    document.body.dataset.navigation = path;
  },
  replace: (path: string) => {
    document.body.dataset.navigation = path;
  },
};

// 记录导航意图；隔离宿主不把 Next 路由调用冒充真实页面跳转。
export function useRouter() {
  return router;
}

export function usePathname() {
  if (location.pathname !== "/short-video.html") return location.pathname;
  const mode = new URLSearchParams(location.search).get("mode") || "detail";
  return mode === "videos"
    ? "/short-videos"
    : mode === "detail"
      ? "/short-videos/video-1"
      : `/short-videos/${mode}`;
}
