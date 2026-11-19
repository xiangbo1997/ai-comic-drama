import { expect, test } from "@playwright/test";
test("shared LLM settings save and test search capability using the same saved credentials", async ({
  page,
}) => {
  let tested = false;
  let saved = false;
  await page.route("**/api/ai-models/configs/tts-config", (route) => {
    if (route.request().method() === "PUT") {
      saved = true;
      expect(
        route.request().postDataJSON().extraConfig.webSearchTransport
      ).toBe("responses");
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: { extraConfig: {} } });
  });
  await page.route("**/api/ai-models/configs/tts-config/test", (route) => {
    tested = true;
    expect(route.request().postDataJSON()).toMatchObject({
      modelId: "search-model",
      extraConfig: { webSearchTransport: "responses" },
    });
    expect(route.request().postDataJSON().apiKey).toBeUndefined();
    return route.fulfill({
      json: {
        success: true,
        message: "联网搜索实测通过：2次搜索工具调用，1个来源引用。",
      },
    });
  });
  await page.goto("/tts-models.html?provider=search");
  await page
    .getByRole("combobox", { name: /联网搜索能力/ })
    .selectOption("responses");
  await expect(
    page.getByText("https://search.example/v1/responses", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "测试", exact: true }).click();
  await expect(page.getByText(/联网搜索实测通过/)).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => saved).toBe(true);
  expect(tested).toBe(true);
});
