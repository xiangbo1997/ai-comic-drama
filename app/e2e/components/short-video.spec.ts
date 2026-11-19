import { expect, test, type Page } from "@playwright/test";
const caps = {
  userId: "isolated-user",
  autoSubmitEnabled: false,
  defaultTimeZone: "Asia/Shanghai",
  platforms: [
    {
      platform: "DOUYIN",
      discovery: "MANUAL",
      publish: "MANUAL",
      reason: "BLOCKED：未配置授权连接器",
    },
  ],
};
async function defaults(page: Page) {
  await page.route("**/api/short-videos/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/api/short-videos/"
    )[1];
    if (path === "capabilities") return route.fulfill({ json: caps });
    if (path === "models")
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path === "templates")
      return route.fulfill({
        json: {
          items: [{ id: "t1", name: "打工动物", version: 1 }],
          nextCursor: null,
        },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
}
test("manual source import preserves traceability and unavailable auto capability", async ({
  page,
}) => {
  await defaults(page);
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/short-videos/sources**", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: "source-1" } });
    }
    return route.fulfill({
      json: {
        items: writes.length
          ? [
              {
                id: "source-1",
                platform: "DOUYIN",
                summary: "水豚主持午休",
                observedAt: "2026-11-19T00:00:00Z",
                ingestionMode: "MANUAL",
                originalUrl: "https://www.douyin.com/video/123",
                metrics: null,
              },
            ]
          : [],
        nextCursor: null,
      },
    });
  });
  await page.goto("/short-video.html?mode=trends");
  await page
    .getByLabel("原链接（可留空，不自动下载原片）")
    .fill("https://www.douyin.com/video/123");
  await page.getByLabel("梗摘要").fill("水豚主持午休");
  await page.getByRole("button", { name: "保存来源", exact: true }).click();
  await expect(page.getByRole("article").getByRole("strong")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "平台授权搜索暂不可用" })
  ).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    platform: "DOUYIN",
    summary: "水豚主持午休",
  });
  expect(writes[0].requestId).toBeTruthy();
  await page.reload();
  await expect(page.getByRole("article").getByRole("strong")).toBeVisible();
  expect(writes).toHaveLength(1);
});
test("manual upload to review, schedule and user-reported result in narrow screen", async ({
  page,
}) => {
  await defaults(page);
  const artifact = {
    id: "artifact-1",
    kind: "VIDEO",
    version: 1,
    bytes: "1234",
    durationMs: 20000,
    width: 720,
    height: 1280,
    storageBackend: "LOCAL",
    verifiedAt: "2026-11-19T00:00:00Z",
  };
  let uploaded = false;
  let version = 1;
  let status = "DRAFT";
  let schedule = "";
  const account = {
    id: "account-1",
    platform: "DOUYIN",
    displayName: "人工账号",
    mode: "MANUAL",
    version: 1,
  };
  const publication = () => ({
    id: "publication-1",
    videoId: "video-1",
    account,
    artifactId: artifact.id,
    version,
    status,
    mode: "MANUAL",
    payload: {
      title: "午休会议",
      text: "原创作品",
      hashtags: [],
      aiGenerated: true,
      commercial: false,
    },
    reviewHash: "a".repeat(64),
    displayTimeZone: "Asia/Shanghai",
    scheduledAt: schedule || null,
    publishedAt: new Date().toISOString(),
    externalUrl:
      status === "PUBLISHED" ? "https://www.douyin.com/video/123" : null,
  });
  await page.route("**/api/short-videos/accounts?**", (route) =>
    route.fulfill({ json: { items: [account], nextCursor: null } })
  );
  await page.route("**/api/short-videos/videos/video-1", (route) =>
    route.fulfill({
      json: {
        id: "video-1",
        title: "午休会议",
        brief: "原创",
        version: uploaded ? 2 : 1,
        artifacts: uploaded ? [artifact] : [],
        scripts: [],
        runs: [],
      },
    })
  );
  await page.route(
    "**/api/short-videos/videos/video-1/artifacts/upload",
    (route) => {
      uploaded = true;
      return route.fulfill({ json: artifact });
    }
  );
  await page.route("**/api/short-videos/publications**", async (route) => {
    if (route.request().url().endsWith("/actions")) {
      const body = route.request().postDataJSON();
      expect(body.expectedVersion).toBe(version);
      version++;
      if (body.action === "approve") {
        expect(body.approvedHash).toBe("a".repeat(64));
        status = "APPROVED";
      } else if (body.action === "schedule") {
        schedule = body.scheduledAt;
        status = "SCHEDULED";
      } else if (body.action === "mark_manual_published") status = "PUBLISHED";
    }
    return route.fulfill({ json: publication() });
  });
  await page.goto("/short-video.html");
  await page.getByLabel("选择素材").setInputFiles({
    name: "original.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from(
      "browser test upload; media validation is covered by real PostgreSQL tests"
    ),
  });
  await page.getByLabel("我确认素材使用权限，备注").fill("本人原创");
  await page.getByRole("button", { name: "上传并检查素材" }).click();
  await expect(page.getByText(/素材已持久化/)).toBeVisible();
  await page.getByLabel("目标账号").selectOption("account-1");
  await page.getByRole("button", { name: "创建待审快照" }).click();
  await page.getByRole("button", { name: "批准此快照" }).click();
  await page
    .getByLabel("计划提交时间（含时区）")
    .fill("2026-11-20T20:00:00+08:00");
  await page.getByRole("button", { name: "保存排期" }).click();
  await expect(
    page.getByRole("heading", { name: "审核与排期 · 已排期" })
  ).toBeVisible();
  expect(schedule).toBe("2026-11-20T12:00:00.000Z");
  status = "AWAITING_MANUAL";
  version++;
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  await page
    .getByLabel("平台公开作品链接")
    .fill("https://www.douyin.com/video/123");
  await page.getByLabel("真实发布时间（含时区）").fill("2026-11-19T00:00:00Z");
  await page
    .getByRole("button", { name: "登记人工发布结果（用户回填）" })
    .click();
  await expect(page.getByText(/USER_REPORTED/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
test("unknown run cannot be resumed or silently resubmitted after refresh", async ({
  page,
}) => {
  await defaults(page);
  let writes = 0;
  await page.route("**/api/short-videos/videos/video-1", (route) =>
    route.fulfill({
      json: {
        id: "video-1",
        title: "恢复测试",
        version: 1,
        runs: [{ id: "run-1" }],
        artifacts: [],
        scripts: [],
      },
    })
  );
  await page.route("**/api/short-videos/runs/run-1**", (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({
      json: {
        id: "run-1",
        kind: "RENDER",
        status: "NEEDS_RECONCILIATION",
        version: 3,
        spentCredits: 0,
        reservedCredits: 5,
        maxCredits: 100,
        plan: { models: [], upperBoundCredits: 5, supplierFees: "未取得账单" },
        steps: [
          {
            id: "step-1",
            key: "image:s1:1",
            status: "UNKNOWN",
            estimatedCredits: 5,
          },
        ],
      },
    });
  });
  await page.goto("/short-video.html");
  await expect(page.getByRole("heading", { name: /结果未知/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复原计划" })).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "核对原任务", exact: true })
  ).toBeVisible();
  expect(writes).toBe(0);
});
test("API permission failure is visible and never presented as an empty success", async ({
  page,
}) => {
  await defaults(page);
  await page.route("**/api/short-videos/capabilities", (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: "FEATURE_DISABLED",
          message: "抽象短视频尚未向当前账号开放",
        },
      },
    })
  );
  await page.goto("/short-video.html?mode=videos");
  await expect(page.getByRole("alert")).toContainText("尚未向当前账号开放");
});

test("test connector automatic path distinguishes processing and verified public status", async ({
  page,
}) => {
  await defaults(page);
  let status = "PROCESSING";
  const pub = () => ({
    id: "auto-1",
    version: 4,
    status,
    mode: "AUTO",
    account: { displayName: "测试授权账号", platform: "DOUYIN" },
    payload: {
      title: "自动链路契约测试",
      text: "",
      hashtags: [],
      aiGenerated: true,
      commercial: false,
    },
    reviewHash: "a".repeat(64),
    publishedAt: new Date().toISOString(),
  });
  await page.route("**/api/short-videos/publications**", (route) =>
    route.fulfill({
      json: route.request().url().endsWith("/auto-1")
        ? pub()
        : { items: [pub()], nextCursor: null },
    })
  );
  await page.goto("/short-video.html?mode=publications");
  await page.getByRole("button", { name: "打开审核与排期" }).click();
  await expect(
    page.getByRole("heading", { name: "审核与排期 · 供应方处理中" })
  ).toBeVisible();
  await expect(page.getByText(/发布结果：/)).toHaveCount(0);
  status = "PUBLISHED";
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "审核与排期 · 已发布" })
  ).toBeVisible();
  await expect(page.getByText(/发布结果：平台核验/)).toBeVisible();
});
