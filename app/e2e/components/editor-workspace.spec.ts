import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: { configs: [], attempts: [] } })
  );
});

test("窄屏可从创作切换到分镜编辑，切回仍保留未提交草稿", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "编辑工作区" });
  await expect(nav).toBeVisible();
  const script = page.getByRole("region", { name: "创作工作区" });
  await script.getByRole("textbox").fill("主角发现门外的人来自未来。");
  await nav.getByRole("button", { name: "分镜", exact: true }).click();
  await expect(script).toBeHidden();
  await page.getByRole("button", { name: "选择分镜 1" }).click();
  const editor = page.getByRole("region", { name: "编辑工作区" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText("画面描述", { exact: true })).toBeVisible();
  const description = editor.locator("textarea").first();
  await description.fill("她推开门，看到未来的自己。");
  await nav.getByRole("button", { name: "创作", exact: true }).click();
  await expect(script.getByRole("textbox")).toHaveValue(
    "主角发现门外的人来自未来。"
  );
  await nav.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(description).toHaveValue("她推开门，看到未来的自己。");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 375);
  await page.screenshot({ path: testInfo.outputPath("mobile-editor.png") });
});

test("320px长标题仍保留主要入口，不把编辑区挤到屏幕外", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "预览", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "导出", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "创作工作区" }).getByRole("textbox")
  ).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 320);
});

test("桌面折叠偏好不阻止手机输入，桌面仍同时展示三栏", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("editor-script-panel-collapsed", "1")
  );
  await page.goto("/");
  const script = page.getByRole("region", { name: "创作工作区" });
  await expect(script.getByRole("textbox")).toBeVisible();
  await script.getByRole("textbox").fill("手机仍能输入故事");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("navigation", { name: "编辑工作区" })
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "展开创作面板" })
  ).toBeVisible();
  await page.getByRole("button", { name: "展开创作面板" }).click();
  await expect(script.getByRole("textbox")).toHaveValue("手机仍能输入故事");
  await expect(page.getByRole("heading", { name: "分镜列表" })).toBeVisible();
  await expect(page.getByText("选择分镜进行编辑")).toBeVisible();
});

test("视口缩短后创作与逐镜输入仍可滚动到达，草稿保留", async ({ page }) => {
  await page.goto("/");
  await page.setViewportSize({ width: 375, height: 360 });
  const nav = page.getByRole("navigation", { name: "编辑工作区" });
  const input = page
    .getByRole("region", { name: "创作工作区" })
    .getByRole("textbox");
  await input.fill("缩短视口下的创作草稿");
  await expect(input).toBeInViewport();
  await nav.getByRole("button", { name: "分镜", exact: true }).click();
  await page.getByRole("button", { name: "选择分镜 1" }).click();
  const description = page
    .getByRole("region", { name: "编辑工作区" })
    .locator("textarea")
    .first();
  await description.fill("缩短视口下的逐镜草稿");
  await expect(description).toBeInViewport();
  await nav.getByRole("button", { name: "创作", exact: true }).click();
  await expect(input).toHaveValue("缩短视口下的创作草稿");
});
