import { expect, test } from "@playwright/test";
import { buildHotBrief } from "../../src/services/short-video/hot-discovery/ideas";
import { parseDouyinBoard } from "../../src/services/short-video/hot-discovery/sources";
const now = new Date("2026-11-19T12:10:00Z");
const report = buildHotBrief(
  {
    query: "搜索最新梗",
    platforms: ["DOUYIN", "KUAISHOU", "XIAOHONGSHU"],
    style: "XIANXIA",
    windowDays: 3,
  },
  [
    parseDouyinBoard(
      {
        status_code: 0,
        data: {
          active_time: "2026-11-19 20:04:36",
          word_list: [
            { word: "慌啥子嘛要好好吃饭呀", position: 17 },
            { word: "谢谢小猫递来的红薯", position: 20 },
          ],
        },
      },
      now
    ),
    {
      platform: "KUAISHOU",
      status: "UNAVAILABLE",
      items: [],
      fetchedAt: now.toISOString(),
      sourceUrl: null,
      reason: "来源暂不可用",
    },
    {
      platform: "XIAOHONGSHU",
      status: "UNAVAILABLE",
      items: [],
      fetchedAt: now.toISOString(),
      sourceUrl: null,
      reason: "未取得可验证的小红书热点",
    },
  ],
  now
);
test("searches in background, shows evidence and original ideas, saves reviewed draft without paid calls", async ({
  page,
}) => {
  let started = false;
  let searches = 0;
  let saves = 0;
  let completed = false;
  await page.route("**/api/short-videos/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (path === "capabilities")
      return route.fulfill({
        json: {
          userId: "test-user",
          autoSubmitEnabled: false,
          defaultTimeZone: "Asia/Shanghai",
          platforms: [],
        },
      });
    if (path === "hot-briefs" && route.request().method() === "POST") {
      started = true;
      searches++;
      const input = route.request().postDataJSON();
      expect(input.platforms).toEqual(["DOUYIN", "KUAISHOU", "XIAOHONGSHU"]);
      expect(input.requestId).toBeTruthy();
      return route.fulfill({
        status: 202,
        json: { id: "brief-1", status: "PENDING", report: null },
      });
    }
    if (path === "hot-briefs")
      return route.fulfill({
        json: {
          item: started
            ? {
                id: "brief-1",
                status: completed ? "COMPLETED" : "PENDING",
                report: completed ? report : null,
              }
            : null,
        },
      });
    if (path === "hot-briefs/brief-1") {
      completed = true;
      return route.fulfill({
        json: { id: "brief-1", status: "COMPLETED", report },
      });
    }
    if (path === "hot-briefs/brief-1/save-idea") {
      saves++;
      const input = route.request().postDataJSON();
      expect(input.content.title).toBe("用户修改后的原创片名");
      return route.fulfill({ json: { videoId: "saved-video" } });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/short-video.html?mode=trends");
  await page.getByLabel("搜索方式").selectOption("PUBLIC");
  await page.getByRole("button", { name: "搜索最新梗与改编点子" }).click();
  await expect(page.getByText(/等待后台读取来源/)).toBeVisible();
  await expect(page.getByText(/如果先做一条/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/未取得可验证的小红书热点/)).toBeVisible();
  await expect(
    page
      .getByRole("link", { name: "慌啥子嘛要好好吃饭呀", exact: true })
      .first()
  ).toHaveAttribute("href", /www.douyin.com\/search/);
  await page.getByRole("button", { name: "展开分镜" }).first().click();
  const script = JSON.parse(
    await page.getByLabel("编辑结构化草案").inputValue()
  );
  script.title = "用户修改后的原创片名";
  await page.getByLabel("编辑结构化草案").fill(JSON.stringify(script));
  await page.getByRole("button", { name: "保存来源与草案到作品" }).click();
  await expect(
    page.getByRole("button", { name: "进入作品继续制作" })
  ).toBeVisible();
  expect(searches).toBe(1);
  expect(saves).toBe(1);
  await page.reload();
  await expect(page.getByText(/如果先做一条/)).toBeVisible();
  expect(searches).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
test("an unavailable result never invents today's memes and search errors can be reread", async ({
  page,
}) => {
  let fail = true;
  const empty = buildHotBrief(
    {
      query: "最新梗",
      platforms: ["XIAOHONGSHU"],
      style: "XIANXIA",
      windowDays: 1,
    },
    [
      {
        platform: "XIAOHONGSHU",
        status: "UNAVAILABLE",
        items: [],
        fetchedAt: now.toISOString(),
        sourceUrl: null,
        reason: "未取得可验证结果",
      },
    ],
    now
  );
  await page.route("**/api/short-videos/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (path === "capabilities")
      return route.fulfill({
        json: { autoSubmitEnabled: false, platforms: [] },
      });
    if (path === "hot-briefs") {
      if (route.request().method() === "POST" && fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "来源暂不可用，请读取状态" } },
        });
      return route.fulfill({
        json: {
          item: fail
            ? null
            : { id: "empty", status: "COMPLETED", report: empty },
        },
      });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto("/short-video.html?mode=trends");
  await page.getByLabel("搜索方式").selectOption("PUBLIC");
  await page.getByRole("button", { name: "搜索最新梗与改编点子" }).click();
  await expect(page.getByRole("alert")).toContainText("来源暂不可用");
  fail = false;
  await page.getByRole("button", { name: "读取最近搜索" }).click();
  await expect(
    page.getByText(/未取得足够证据支持新的抽象选题推荐/)
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "展开分镜" })).toHaveCount(0);
});

test("AI search uses the shared tested config, displays citations/usage and saves the brief without generation", async ({
  page,
}) => {
  const ai = {
    answer:
      "## 今晚推荐\n仙尊渡劫，先在村口登记。[榜单出处](https://source.example/hot) [未引用链接](https://invented.example/)",
    model: "native-search-model",
    responseId: "resp-browser",
    retrievedAt: now.toISOString(),
    toolCalls: 3,
    sources: [
      { title: "带日期的第三方热点", url: "https://source.example/hot" },
    ],
    usage: { inputTokens: 300, outputTokens: 100, totalTokens: 400 },
  };
  let searches = 0;
  let saved = 0;
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({
      json: {
        configs: [
          {
            id: "shared-search",
            providerId: "provider",
            provider: {
              id: "provider",
              name: "共用搜索通道",
              slug: "native",
              category: "LLM",
              models: [{ id: "native-search-model", name: "联网搜索模型" }],
            },
            selectedModel: "native-search-model",
            isDefault: true,
            isEnabled: true,
            testStatus: "SUCCESS",
            webSearchTransport: "responses",
          },
        ],
      },
    })
  );
  await page.route("**/api/short-videos/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (path === "hot-briefs" && route.request().method() === "POST") {
      searches++;
      expect(route.request().postDataJSON().searchConfigId).toBe(
        "shared-search"
      );
      return route.fulfill({
        status: 202,
        json: {
          id: "ai-brief",
          status: "COMPLETED",
          report: { ...report, ai },
        },
      });
    }
    if (path === "hot-briefs")
      return route.fulfill({
        json: {
          item: searches
            ? { id: "ai-brief", status: "COMPLETED", report: { ...report, ai } }
            : null,
        },
      });
    if (path === "hot-briefs/ai-brief/save-ai") {
      saved++;
      return route.fulfill({ json: { videoId: "ai-video" } });
    }
    if (path === "capabilities")
      return route.fulfill({
        json: { autoSubmitEnabled: false, platforms: [] },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await expect(
    page.getByText("联网搜索模型", { exact: true }).last()
  ).toBeVisible();
  await page.getByRole("button", { name: "搜索最新梗与改编点子" }).click();
  await expect(
    page.getByRole("region", { name: "AI联网搜索结果" })
  ).toContainText("先在村口登记");
  await expect(page.getByRole("link", { name: "榜单出处" })).toHaveAttribute(
    "href",
    "https://source.example/hot"
  );
  await expect(page.getByRole("link", { name: "未引用链接" })).toHaveCount(0);
  await page.getByText("核对搜索来源与用量", { exact: true }).click();
  await expect(page.getByText(/输入300/)).toBeVisible();
  await page.getByRole("button", { name: "收藏AI简报并开始创作" }).click();
  await expect(
    page.getByRole("button", { name: "进入作品继续制作" })
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "AI联网搜索结果" })
  ).toBeVisible();
  expect(searches).toBe(1);
  expect(saved).toBe(1);
});
