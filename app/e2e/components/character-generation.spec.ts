import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/portrait.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#756758"/></svg>',
    })
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/characters") {
      await route.fulfill({
        json: {
          items: [
            {
              id: "hero",
              name: "测试角色",
              referenceImages: ["/portrait.svg"],
              canonicalImageUrl: "/portrait.svg",
              tags: [],
            },
            { id: "empty", name: "无图角色", referenceImages: [], tags: [] },
          ],
          nextCursor: null,
        },
      });
    } else if (url.pathname === "/api/user/credits") {
      await route.fulfill({ json: { credits: 100 } });
    } else if (url.pathname === "/api/tags") {
      await route.fulfill({ json: [] });
    } else if (route.request().method() === "POST") {
      await route.fulfill({ json: { taskId: "pending-task" } });
    } else if (url.pathname.includes("pending-task")) {
      await route.fulfill({ json: { status: "PROCESSING" } });
    } else {
      await route.fulfill({ json: { configs: [] } });
    }
  });
  await page.goto("/characters.html");
});

test("参考图弹窗只有一个生成操作，四张候选的总价清楚", async ({ page }) => {
  await page
    .getByRole("button", { name: "AI 生成参考图", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "4 张", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: /生成参考图.*4 张.*12 积分/ })
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /三视图|表情集/ })
  ).toHaveCount(0);
});

test("三视图和表情集独立确认，不展示无效的来源或候选张数", async ({ page }) => {
  for (const [name, cost] of [
    ["三视图", 9],
    ["表情集", 18],
  ] as const) {
    await page
      .getByRole("button", { name: `生成${name}`, exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: `生成${name}` })
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: `生成${name}（${cost} 积分）`,
        exact: true,
      })
    ).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "4 张", exact: true })
    ).toHaveCount(0);
    await expect(dialog.getByAltText("生成使用的角色参考图")).toHaveAttribute(
      "src",
      "/portrait.svg"
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }
});

test("三视图生成时仍能提交角色参考图，同类任务保持禁用", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST")
      posts.push(new URL(request.url()).pathname);
  });
  await page
    .getByRole("button", { name: "生成三视图", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "生成三视图（9 积分）", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "生成三视图", exact: true }).first()
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "AI 生成参考图", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /生成参考图.*3 积分/ })
    .click();
  await expect
    .poll(
      () => posts.filter((url) => url.endsWith("generate-three-views")).length
    )
    .toBe(1);
  await expect
    .poll(
      () => posts.filter((url) => url.endsWith("generate-reference")).length
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "生成表情集", exact: true }).first()
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "生成表情集", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "生成表情集（18 积分）", exact: true })
    .click();
  await expect
    .poll(
      () => posts.filter((url) => url.endsWith("generate-expressions")).length
    )
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "生成表情集", exact: true }).first()
  ).toBeDisabled();
});

test("参考图生成中仍能启动三视图，失败后同类入口可重试", async ({ page }) => {
  await page
    .getByRole("button", { name: "AI 生成参考图", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /生成参考图.*3 积分/ })
    .click();
  await expect(
    page.getByRole("button", { name: "AI 生成参考图", exact: true }).first()
  ).toBeDisabled();
  await page.route("**/api/characters/hero/generate-three-views", (route) =>
    route.fulfill({ status: 500, json: { error: "测试失败" } })
  );
  await page
    .getByRole("button", { name: "生成三视图", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "生成三视图（9 积分）", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "生成三视图", exact: true }).first()
  ).toBeEnabled();
  await page.route("**/api/characters/hero/generate-three-views", (route) =>
    route.fulfill({ json: { taskId: "pending-task" } })
  );
  await page
    .getByRole("button", { name: "生成三视图", exact: true })
    .first()
    .click();
  const request = page.waitForRequest(
    (req) =>
      req.method() === "POST" && req.url().endsWith("generate-three-views")
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "生成三视图（9 积分）", exact: true })
    .click();
  await request;
  await expect(
    page.getByRole("button", { name: "生成三视图", exact: true }).first()
  ).toBeDisabled();
});

test("缺少参考图时表情集说明前置条件，参考图仍可生成", async ({ page }) => {
  const expressions = page
    .getByRole("button", { name: "生成表情集", exact: true })
    .last();
  await expect(expressions).toBeDisabled();
  await expect(expressions).toHaveAttribute("title", /先.*参考图/);
  await expect(
    page.getByRole("button", { name: "AI 生成参考图", exact: true }).last()
  ).toBeEnabled();
});

test("专项生成按自身费用判断余额", async ({ page }) => {
  await page.route("**/api/user/credits", (route) =>
    route.fulfill({ json: { credits: 10 } })
  );
  await page
    .getByRole("button", { name: "生成表情集", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "生成表情集（18 积分）", exact: true })
  ).toBeDisabled();
  await expect(dialog.getByRole("link", { name: /去充值/ })).toBeVisible();
});
