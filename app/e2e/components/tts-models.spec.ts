import { expect, test } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/ai-models/configs/tts-config", (route) =>
    route.fulfill({ json: { extraConfig: {} } })
  );
  await page.route("**/api/ai-models/configs/tts-config/test", (route) =>
    route.fulfill({
      json: {
        success: true,
        message: "语音模型已登记，鉴权及模型列表连接成功；未执行真实语音合成",
      },
    })
  );
});
test("留空Key编辑Grok：切协议、预览和实际测试请求一致", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/tts-models.html");
  const select = page.getByRole("combobox");
  await select.selectOption("grok");
  await expect(
    page.getByText("https://grok2api.example/v1/tts", { exact: true })
  ).toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/tts-config/test") && r.method() === "POST"
  );
  await page.getByRole("button", { name: "测试", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    apiProtocol: "grok",
    modelId: "grok-voice-latest",
    customBaseUrl: "https://grok2api.example/v1",
  });
  await expect(
    page.getByText(/未执行真实语音合成/, { exact: false }).last()
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/ai-comic-grok-tts-desktop.png",
    fullPage: true,
  });
});
test("chatgpt-tts保留OpenAI语音端点和协议", async ({ page }) => {
  await page.goto("/tts-models.html?provider=openai");
  await expect(page.getByRole("combobox")).toHaveValue("openai");
  await expect(
    page.getByText("https://chatgpt2api.example/v1/audio/speech", {
      exact: true,
    })
  ).toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/tts-config/test") && r.method() === "POST"
  );
  await page.getByRole("button", { name: "测试", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    apiProtocol: "openai",
    modelId: "chatgpt-tts",
  });
});
test("手机设置显示Grok且没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tts-models.html");
  await page.getByRole("combobox").selectOption("grok");
  await expect(page.getByText(/Grok 网关 \/tts 请选择 Grok/)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/ai-comic-grok-tts-mobile.png",
    fullPage: true,
  });
});
