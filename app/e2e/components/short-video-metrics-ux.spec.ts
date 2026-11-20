import { expect, test, type Page } from "@playwright/test";

async function published(page: Page) {
  await page.route("**/api/short-videos/**", (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (path === "capabilities")
      return route.fulfill({
        json: {
          userId: "metrics-user",
          autoSubmitEnabled: false,
          platforms: [],
          defaultTimeZone: "Asia/Shanghai",
        },
      });
    const publication = {
      id: "published-1",
      version: 1,
      status: "PUBLISHED",
      mode: "MANUAL",
      publishedAt: "2026-11-18T12:00:00Z",
      payload: {
        title: "原创短片",
        text: "",
        hashtags: [],
        aiGenerated: true,
        commercial: false,
      },
    };
    if (path === "publications/published-1")
      return route.fulfill({ json: publication });
    return route.fulfill({
      json: {
        items: path === "publications" ? [publication] : [],
        nextCursor: null,
      },
    });
  });
}

test("metrics distinguish unknown from zero and show readable history", async ({
  page,
}) => {
  await published(page);
  const writes: Record<string, unknown>[] = [];
  await page.route(
    "**/api/short-videos/publications/published-1/metrics",
    (route) => {
      if (route.request().method() === "POST") {
        writes.push(route.request().postDataJSON());
        return route.fulfill({ json: { id: "metric-1" } });
      }
      return route.fulfill({
        json: {
          items: writes.length
            ? [
                {
                  id: "metric-1",
                  observedAt: "2026-11-19T10:00:00Z",
                  windowLabel: "H24",
                  views: 0,
                  likes: null,
                  completionRate: 0.625,
                  source: "MANUAL",
                },
              ]
            : [],
          nextCursor: null,
        },
      });
    }
  );
  await page.goto("/short-video.html?mode=publications");
  await page.getByRole("button", { name: "打开审核与排期" }).click();
  await expect(
    page.getByText("还没有反馈记录，填写已知数据即可。")
  ).toBeVisible();
  await page.getByLabel("播放量", { exact: true }).fill("0");
  await page.getByLabel("完播率（%）", { exact: true }).fill("62.5");
  await page.getByLabel("指标窗口").selectOption("H24");
  await page.getByRole("button", { name: "保存指标快照" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "指标快照已保存" })
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].metrics).toMatchObject({
    views: 0,
    likes: null,
    completionRate: 0.625,
  });
  await expect(page.getByRole("table", { name: "发布反馈记录" })).toContainText(
    "62.5%"
  );
  await expect(page.getByRole("table", { name: "发布反馈记录" })).toContainText(
    "未知"
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test("metric retry preserves receipt and observation time after a lost response", async ({
  page,
}) => {
  await published(page);
  const writes: Record<string, unknown>[] = [];
  await page.route(
    "**/api/short-videos/publications/published-1/metrics",
    (route) => {
      if (route.request().method() === "POST") {
        writes.push(route.request().postDataJSON());
        if (writes.length === 1) return route.abort("failed");
        return route.fulfill({ json: { id: "metric-1" } });
      }
      return route.fulfill({ json: { items: [], nextCursor: null } });
    }
  );
  await page.goto("/short-video.html?mode=publications");
  await page.getByRole("button", { name: "打开审核与排期" }).click();
  await page.getByLabel("点赞数", { exact: true }).fill("12");
  await page.getByRole("button", { name: "保存指标快照" }).click();
  await expect(page.getByRole("alert")).toContainText("保存未确认");
  await page.reload();
  await page.getByRole("button", { name: "打开审核与排期" }).click();
  await page.getByLabel("点赞数", { exact: true }).fill("12");
  await page.getByRole("button", { name: "保存指标快照" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "指标快照已保存" })
  ).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});
