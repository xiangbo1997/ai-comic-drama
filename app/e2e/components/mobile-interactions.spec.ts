import { expect, test, type Page } from "@playwright/test";

test("AI工具可直接进入自动制作，仅打开不会启动任务", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/assistant/executions") &&
      request.method() !== "GET"
    )
      writes.push(request.url());
  });
  await page.route("**/api/assistant/executions?**", (route) =>
    route.fulfill({ json: { execution: null } })
  );
  await page.route("**/api/assistant?**", (route) =>
    route.fulfill({
      json: {
        scope: {
          key: "project:fixture-project",
          type: "project",
          id: "fixture-project",
          title: "测试剧集",
        },
        messages: [],
        memory: { content: "", version: 0 },
      },
    })
  );
  await page.getByRole("button", { name: "AI 工具", exact: true }).click();
  await page.getByRole("menuitem", { name: /自动制作 \/ 一致性检查/ }).click();
  await expect(
    page.getByRole("heading", { name: "当前集自动制作" })
  ).toBeVisible();
  expect(writes).toEqual([]);
});

async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let step = 1; step <= 10; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / 10,
          y: from.y + ((to.y - from.y) * step) / 10,
          id: 1,
        },
      ],
    });
  }
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await session.detach();
}

test.beforeEach(async ({ page }) => {
  let order = Array.from({ length: 24 }, (_, i) => `scene-${i + 1}`);
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/scenes/reorder")) {
      order = route.request().postDataJSON().orderedIds;
      await route.fulfill({ json: { success: true } });
    } else await route.fulfill({ json: { configs: [], attempts: [] } });
  });
  await page.route("**/fixture-order", (route) =>
    route.fulfill({ json: order })
  );
  await page.goto("/?interactions");
});

test("长时间轴与工具栏限制在320px视口内，装饰设置可滚到末镜并保存", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const overflowing = await page.locator("body *").evaluateAll((elements) =>
    elements
      .filter(
        (element) =>
          element.getBoundingClientRect().right > 321 &&
          getComputedStyle(element).position !== "absolute"
      )
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        width: element.getBoundingClientRect().width,
      }))
      .slice(0, 15)
  );
  expect(
    await page.locator("body").evaluate((element) => element.scrollWidth),
    JSON.stringify(overflowing)
  ).toBe(320);
  for (const [button, title, saved] of [
    ["滤镜/变速", "滤镜 / 变速 / 音效（按分镜）", "滤镜已保存"],
    ["转场", "转场设置（分镜之间）", "转场已保存"],
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    await dialog.locator("select").last().scrollIntoViewIfNeeded();
    await expect(dialog.locator("select").last()).toBeInViewport();
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.getByLabel("已保存装饰")).toHaveText(saved);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
  }
});

test("真实触屏事件可拖动分镜手柄排序，普通卡片区域保留滚动", async ({
  page,
}) => {
  const handles = page.getByRole("button", { name: "拖拽调整分镜顺序" });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  const request = page.waitForRequest("**/scenes/reorder");
  await touchDrag(
    page,
    { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 },
    { x: second!.x + second!.width / 2, y: second!.y + second!.height / 2 + 20 }
  );
  expect((await request).postDataJSON().orderedIds.slice(0, 2)).toEqual([
    "scene-2",
    "scene-1",
  ]);
  const list = page.getByRole("region", { name: "分镜列表内容" });
  await touchDrag(page, { x: 270, y: 350 }, { x: 270, y: 180 });
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
});

test("长口播镜键盘微调不会被旧30秒上限截断", async ({ page }) => {
  await page.goto("/?interactions&long");
  const handle = page.getByRole("slider", { name: "调整镜头 1 时长" });
  await handle.focus();
  await handle.press("ArrowRight");
  await expect(page.getByLabel("已保存时长")).toHaveText("52.1");
});

test("工作流1起数据库镜序仍按显示位置标注首镜，不跳成第2镜", async ({
  page,
}) => {
  await page.goto("/?interactions&onebased");
  await expect(
    page.getByRole("slider", { name: "调整镜头 1 时长", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "滤镜/变速", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/^镜 #1\s/)).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "转场", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("镜 #1 → 镜 #2", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page.getByRole("button", { name: "+ 贴图", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator("select").first().locator("option").first()
  ).toHaveText(/^#1 /);
  await page.goto("/?onebased");
  await page
    .getByRole("navigation", { name: "编辑工作区" })
    .getByRole("button", { name: "分镜", exact: true })
    .click();
  await page.getByRole("button", { name: "选择分镜 1" }).click();
  await expect(
    page
      .getByRole("region", { name: "编辑工作区" })
      .getByText("分镜 #1", { exact: true })
  ).toBeVisible();
});

test("触屏可调整时间轴镜长", async ({ page }) => {
  const handle = page.getByRole("slider", { name: "调整镜头 1 时长" });
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  await touchDrag(
    page,
    { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
    { x: bounds!.x + bounds!.width / 2 + 30, y: bounds!.y + bounds!.height / 2 }
  );
  await expect(page.getByLabel("已保存时长")).not.toHaveText("0");
});

test("320px字幕、水印和贴图弹窗主要控件可达且完成可保存", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [name, title, saved] of [
    [/^字幕/, "字幕样式（全片统一）", "字幕已保存"],
    ["品牌水印", "品牌水印 / Logo（全片统一）", "水印已保存"],
    ["+ 贴图", "贴图 / 表情（按分镜叠加）", "贴图已保存"],
  ] as const) {
    await page.getByRole("button", { name }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    const last = dialog.locator("input, select, button").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    expect(
      await dialog.evaluate((element) => element.scrollWidth)
    ).toBeLessThanOrEqual(320);
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await expect(page.getByLabel("已保存装饰")).toHaveText(saved);
  }
});
