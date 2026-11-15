import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/image.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 640"><rect width="480" height="640" fill="#334155"/><circle cx="240" cy="230" r="85" fill="#94a3b8"/><path d="M110 600V440a130 130 0 0 1 260 0v160" fill="#64748b"/></svg>',
    })
  );
  await page.goto("/timeline.html");
});
test("点击各轨道打开对应操作，独立字幕编辑/移除/恢复不改配音原文", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "编辑第1镜字幕", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "本镜字幕" }).fill("修正字幕");
  await dialog.getByRole("button", { name: "保存字幕", exact: true }).click();
  await expect(page.getByLabel("原始对白")).toHaveText("原始对白");
  await expect(page.getByLabel("渲染字幕")).toHaveText("修正字幕");
  await dialog.getByRole("button", { name: "移除本镜字幕" }).click();
  await expect(page.getByLabel("渲染字幕")).toBeEmpty();
  await dialog.getByRole("button", { name: "恢复原文字幕" }).click();
  await expect(page.getByLabel("渲染字幕")).toHaveText("原始对白");
});
test("移除与撤销配音保留图片，失败显示错误且保留原素材", async ({ page }) => {
  await page
    .getByRole("button", { name: "编辑第1镜配音", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "移除配音" }).click();
  await expect(page.getByLabel("配音地址")).toBeEmpty();
  await expect(page.getByLabel("图片地址")).toContainText("image.svg");
  await dialog.getByRole("button", { name: "撤销移除" }).click();
  await expect(page.getByLabel("配音地址")).toContainText("voice.mp3");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("checkbox", { name: "模拟保存失败" }).check();
  await page
    .getByRole("button", { name: "编辑第1镜图片", exact: true })
    .click();
  await dialog.getByRole("button", { name: "移除图片" }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("图片地址")).toContainText("image.svg");
});
test("生成中禁止移除，点击图片编辑打开已有分镜编辑", async ({ page }) => {
  await page.getByRole("checkbox", { name: "模拟生成中" }).check();
  await page
    .getByRole("button", { name: "编辑第1镜图片", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "移除图片" })).toBeDisabled();
  await dialog.getByRole("button", { name: "打开分镜编辑" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("编辑目标")).toHaveText("s1:image");
});
test("手机可调整AI标识位置字号透明度并保存", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "AI 标识", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("标识位置").selectOption("br");
  await dialog.getByLabel("标识字号").fill("1.1");
  await dialog.getByLabel("标识不透明度").fill("0.6");
  await page.screenshot({
    path: testInfo.outputPath("ai-disclosure-mobile.png"),
  });
  await dialog.getByRole("button", { name: "保存设置" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("标识配置")).toContainText('"fontScale":1.1');
  await expect(page.getByLabel("标识配置")).toContainText('"opacity":0.6');
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 375);
});

test("AI标识保存失败保留草稿，可修复后重试", async ({ page }) => {
  await page.getByRole("checkbox", { name: "模拟保存失败" }).check();
  await page.getByRole("button", { name: "AI 标识", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("标识位置").selectOption("bottom");
  await dialog.getByRole("button", { name: "保存设置" }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  await expect(dialog.getByLabel("标识位置")).toHaveValue("bottom");
});

test("配音原文可以编辑保存，原有音频不会自动重新生成", async ({ page }) => {
  await page
    .getByRole("button", { name: "编辑第1镜配音", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "配音对白" }).fill("修正配音原文");
  await dialog.getByRole("combobox", { name: "配音语速" }).selectOption("1.25");
  await dialog.getByRole("button", { name: "保存配音原文" }).click();
  await expect(page.getByLabel("原始对白")).toHaveText("修正配音原文");
  await expect(page.getByLabel("配音地址")).toContainText("voice.mp3");
  await expect(dialog.getByRole("status")).toContainText("重新生成配音");
});

test("桌面键盘可打开视频片段并移除，取消不改变素材", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "编辑第1镜视频", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText("视频");
  await expect(dialog.getByRole("button", { name: "移除视频" })).toBeDisabled();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑第1镜图片", exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath("timeline-desktop.png") });
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByLabel("图片地址")).toContainText("image.svg");
});
