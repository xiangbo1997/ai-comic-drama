import { expect, test } from "@playwright/test";
import { buildHotBrief } from "../../src/services/short-video/hot-discovery/ideas";
import { parseDouyinBoard } from "../../src/services/short-video/hot-discovery/sources";

const now = new Date("2026-11-19T12:10:00Z");
const report = buildHotBrief(
  { query: "日常反差", platforms: ["DOUYIN"], style: "DAILY", windowDays: 3 },
  [
    parseDouyinBoard(
      {
        status_code: 0,
        data: {
          active_time: "2026-11-19 20:04:36",
          word_list: [{ word: "谢谢小猫递来的红薯", position: 20 }],
        },
      },
      now
    ),
  ],
  now
);

test("waits for existing search before allowing another request", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/short-videos/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/hot-briefs")) {
      await gate;
      return route.fulfill({ json: { item: null } });
    }
    return route.fulfill({ json: { items: [], platforms: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await page.getByLabel("搜索方式").selectOption("PUBLIC");
  await expect(
    page.getByRole("button", { name: "搜索最新梗与改编点子" })
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("button", { name: "搜索最新梗与改编点子" })
  ).toBeEnabled();
});

test("changing recent brief clears the previous script selection", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/short-videos/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/hot-briefs")) {
      reads++;
      return route.fulfill({
        json: {
          item: {
            id: reads === 1 ? "brief-first" : "brief-second",
            status: "COMPLETED",
            report,
          },
        },
      });
    }
    return route.fulfill({ json: { items: [], platforms: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await page.getByRole("button", { name: "展开分镜" }).first().click();
  await expect(
    page.getByRole("button", { name: "保存来源与草案到作品" })
  ).toBeVisible();
  await page.getByRole("button", { name: "读取最近搜索" }).click();
  await expect(
    page.getByRole("button", { name: "保存来源与草案到作品" })
  ).toHaveCount(0);
});

test("unknown search result explains reconciliation and never starts another paid search", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/short-videos/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/hot-briefs")) {
      if (route.request().method() === "POST") posts++;
      return route.fulfill({
        json: {
          item: {
            id: "unknown-search",
            status: "FAILED",
            errorCode: "HOT_AI_UNKNOWN",
            report: null,
            errorSummary: "模型结果未知",
          },
        },
      });
    }
    return route.fulfill({ json: { items: [], platforms: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await expect(page.getByText(/结果未知.*核对/).first()).toBeVisible();
  await page.getByLabel("搜索方式").selectOption("PUBLIC");
  await expect(
    page.getByRole("button", { name: "搜索最新梗与改编点子" })
  ).toBeDisabled();
  expect(posts).toBe(0);
});

test("edits public draft by field and keeps save payload valid on mobile", async ({
  page,
}) => {
  let savedTitle = "";
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/short-videos/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/hot-briefs"))
      return route.fulfill({
        json: { item: { id: "brief-edit", status: "COMPLETED", report } },
      });
    if (path.endsWith("/save-idea")) {
      const body = route.request().postDataJSON();
      savedTitle = body.content.title;
      expect(body.content.shots).toHaveLength(2);
      return route.fulfill({ json: { videoId: "edited-video" } });
    }
    return route.fulfill({ json: { items: [], platforms: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await page.getByRole("button", { name: "展开分镜" }).first().click();
  await page.getByLabel("草案标题", { exact: true }).fill("小猫今天当老板");
  await page.getByRole("button", { name: "保存来源与草案到作品" }).click();
  await expect(
    page.getByRole("button", { name: "进入作品继续制作" })
  ).toBeVisible();
  expect(savedTitle).toBe("小猫今天当老板");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

test("malformed reports and advanced drafts show recovery instead of crashing", async ({
  page,
}) => {
  let malformed = true;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/short-videos/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/hot-briefs"))
      return route.fulfill({
        json: {
          item: {
            id: "safe-report",
            status: "COMPLETED",
            report: malformed ? { ideas: [null] } : report,
          },
        },
      });
    return route.fulfill({ json: { items: [], platforms: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await expect(page.getByRole("alert")).toContainText("无法完整读取");
  malformed = false;
  await page.getByRole("button", { name: "读取最近搜索" }).click();
  await page.getByRole("button", { name: "展开分镜" }).first().click();
  await page.getByText("高级编辑：完整脚本 JSON", { exact: true }).click();
  const editor = page.getByLabel("编辑结构化草案");
  const draft = JSON.parse(await editor.inputValue());
  await editor.fill(JSON.stringify({ ...draft, shots: [null] }));
  await expect(
    page.getByRole("button", { name: "保存来源与草案到作品" })
  ).toBeDisabled();
  await expect(page.getByText(/草案结构有误/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("an explicitly acknowledged unknown search creates a new receipt", async ({
  page,
}) => {
  const oldRequestId = "2d55af7a-9d25-4e7d-b705-0a9cfda40b14";
  let requestId = "";
  await page.addInitScript(
    ({ oldRequestId }) => {
      sessionStorage.setItem(
        "short-video-hot-pending",
        JSON.stringify({
          fingerprint: JSON.stringify({
            query: "搜索一下有啥最新的梗可以做成抽象视频吗",
            platforms: ["DOUYIN", "KUAISHOU", "XIAOHONGSHU"],
            style: "XIANXIA",
            windowDays: 3,
          }),
          id: oldRequestId,
        })
      );
    },
    { oldRequestId }
  );
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { configs: [] } })
  );
  await page.route("**/api/short-videos/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/hot-briefs")) {
      if (route.request().method() === "POST") {
        requestId = route.request().postDataJSON().requestId;
        return route.fulfill({
          status: 202,
          json: { id: "new-search", status: "PENDING", report: null },
        });
      }
      return route.fulfill({
        json: {
          item: {
            id: "unknown",
            status: "FAILED",
            errorCode: "HOT_AI_UNKNOWN",
            report: null,
          },
        },
      });
    }
    return route.fulfill({ json: { items: [], platforms: [] } });
  });
  await page.goto("/short-video.html?mode=trends");
  await page.getByLabel("搜索方式").selectOption("PUBLIC");
  await expect(
    page.getByRole("button", { name: "搜索最新梗与改编点子" })
  ).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "已核对原请求和用量，我要另建一次搜索（可能产生新费用）",
    })
    .check();
  await page.getByRole("button", { name: "搜索最新梗与改编点子" }).click();
  await expect(page.getByText("等待后台读取来源")).toBeVisible();
  expect(requestId).not.toBe(oldRequestId);
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
});
