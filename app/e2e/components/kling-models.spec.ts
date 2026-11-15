import { expect, test } from "@playwright/test";

test("旧预设新建：API Key 单密钥可保存，默认协议和端点正确", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/api/ai-models/configs", (route) =>
    route.fulfill({ json: { success: true } })
  );
  await page.goto("/kling-models.html");
  await expect(page.getByRole("combobox")).toHaveValue("kling");
  await page
    .getByPlaceholder("输入 API Key / Access Key", { exact: true })
    .fill("test-api-key");
  const secret = page.getByPlaceholder(/输入 Secret Key/);
  await expect(secret).not.toHaveAttribute("required");
  const saved = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/ai-models/configs") &&
      request.method() === "POST"
  );
  await page.getByRole("button", { name: /保存/ }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    apiKey: "test-api-key",
    apiProtocol: "kling",
    selectedModel: "kling-v2-6",
  });
});

test("编辑 AK/SK：测试请求包含修改的 Secret Key，主密钥留空保留", async ({
  page,
}) => {
  await page.route("**/api/ai-models/configs/kling-config", (route) =>
    route.fulfill({
      json: { extraConfig: { secretKey: "save****alue", mode: "std" } },
    })
  );
  await page.route("**/api/ai-models/configs/kling-config/test", (route) =>
    route.fulfill({
      json: {
        success: true,
        message: "Kling 连接成功（仅查询任务列表，未验证模型生成权限与余额）",
      },
    })
  );
  await page.goto("/kling-models.html?edit");
  const secret = page.getByPlaceholder(/输入 Secret Key/);
  await expect(secret).toHaveValue("save****alue");
  await secret.fill("edited-secret");
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith("/kling-config/test") &&
      request.method() === "POST"
  );
  await page.getByRole("button", { name: "测试", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({
    apiProtocol: "kling",
    extraConfig: { secretKey: "edited-secret", mode: "std" },
  });
  expect((await sent).postDataJSON()).not.toHaveProperty("apiKey");
  await expect(page.getByText(/未验证模型生成权限/).last()).toBeVisible();
});

test("自定义可灵协议：显示双密钥字段、v1端点无重复且手机无溢出", async ({
  page,
}) => {
  await page.goto("/kling-models.html?custom");
  await expect(page.getByRole("combobox")).toHaveValue("kling");
  await expect(page.getByPlaceholder(/输入 Secret Key/)).toBeVisible();
  await page
    .getByPlaceholder("https://api-beijing.klingai.com", { exact: true })
    .fill("https://proxy.example/v1");
  await expect(
    page.getByText("https://proxy.example/v1/videos/image2video", {
      exact: true,
    })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
