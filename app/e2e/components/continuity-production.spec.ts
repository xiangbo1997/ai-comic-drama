import { test, expect } from "@playwright/test";

test("已有AI场记显示道具/空间问题并合并成一次原路径修复", async ({ page }) => {
  await page.route("**/api/projects/p1/continuity-check", (route) =>
    route.fulfill({ json: { taskId: "check1" } })
  );
  await page.route("**/api/projects/p1/continuity-check/check1", (route) =>
    route.fulfill({
      json: {
        status: "COMPLETED",
        result: {
          report: {
            grade: "C",
            summary: "发现两处连续性问题",
            checkedPairs: 1,
            skippedPairs: 0,
            totalPairs: 1,
            issues: [
              {
                sceneId: "s1",
                prevSceneId: "s0",
                sceneOrder: 2,
                dimension: "道具状态",
                severity: "严重",
                description: "钥匙无故换手",
                fixNote: "保持钥匙在右手",
              },
              {
                sceneId: "s1",
                prevSceneId: "s0",
                sceneOrder: 2,
                dimension: "空间站位",
                severity: "中等",
                description: "阿宁站位异常翻转",
                fixNote: "恢复阿宁左侧站位",
              },
            ],
          },
        },
      },
    })
  );
  await page.goto("/continuity-production.html");
  await expect(page.getByText(/道具状态与空间站位是否跳变/)).toBeVisible();
  await page.getByRole("button", { name: "开始体检", exact: true }).click();
  await expect(page.getByText("钥匙无故换手", { exact: true })).toBeVisible();
  await expect(
    page.getByText("阿宁站位异常翻转", { exact: true })
  ).toBeVisible();
  const repair = page.getByRole("button", { name: /按建议重生成/ });
  await expect(repair).toHaveCount(1);
  await repair.click();
  await expect(page.getByLabel("修复调用")).toContainText('"id":"s1"');
  await expect(page.getByLabel("修复调用")).toContainText(
    "保持钥匙在右手；恢复阿宁左侧站位"
  );
  await expect(page.getByLabel("修复调用")).toContainText(
    "https://example.test/0.png"
  );
});
