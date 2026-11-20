import { expect, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`short video navigation identifies every stage at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/ai-models/configs", (route) =>
      route.fulfill({ json: { configs: [] } })
    );
    await page.route("**/api/short-videos/**", (route) => {
      const path = new URL(route.request().url()).pathname.split(
        "/api/short-videos/"
      )[1];
      if (path === "capabilities")
        return route.fulfill({
          json: {
            userId: "responsive-user",
            autoSubmitEnabled: false,
            platforms: [],
            defaultTimeZone: "Asia/Shanghai",
          },
        });
      if (path === "hot-briefs") return route.fulfill({ json: { item: null } });
      if (path === "videos/video-1")
        return route.fulfill({
          json: {
            id: "video-1",
            title: "闹钟也想午休",
            brief: "给闹钟安排一次反向叫醒服务",
            version: 1,
            scripts: [],
            artifacts: [],
            runs: [],
          },
        });
      return route.fulfill({ json: { items: [], nextCursor: null } });
    });
    for (const [mode, label] of [
      ["videos", "作品"],
      ["trends", "热点与导入"],
      ["publications", "发布中心"],
      ["accounts", "发布账号"],
      ["detail", "作品"],
    ]) {
      await page.goto(`/short-video.html?mode=${mode}`);
      const navigation = page.getByRole("navigation", { name: "短视频导航" });
      await expect(
        navigation.getByRole("link", { name: label, exact: true })
      ).toHaveAttribute("aria-current", "page");
      await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(page.getByText("加载中…", { exact: true })).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/short-video-optimization-${width}-${mode}.png`,
        fullPage: true,
      });
    }
  });
}
