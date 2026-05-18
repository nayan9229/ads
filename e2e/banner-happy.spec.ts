import { test, expect } from "@playwright/test";

test.describe("F1: single banner happy path", () => {
  test("mock bidder wins → container reserved + iframe rendered + adRenderSuccess fires", async ({
    page,
  }) => {
    await page.goto("/test-page/index.html");

    const container = page.locator('[data-adwrapper-slot="homepage_300x250_top"]');
    await expect(container).toHaveCount(1);

    const box = await container.boundingBox();
    expect(box?.width).toBe(300);
    expect(box?.height).toBe(250);

    const iframe = container.locator("iframe");
    await expect(iframe).toHaveCount(1);

    const events = page.locator("#events");
    await expect(events).toContainText("adRenderSuccess", { timeout: 5000 });
    await expect(events).toContainText("homepage_300x250_top");

    const mockBody = iframe.contentFrame()?.locator("[data-mock-ad]");
    if (mockBody) await expect(mockBody).toContainText("MOCK AD");
  });

  test("layout does not shift after ad renders (reserved-space CLS check)", async ({ page }) => {
    await page.goto("/test-page/index.html");

    const belowPanel = page.getByText("Below the ad");
    await expect(belowPanel).toBeVisible();
    const beforeBox = await belowPanel.boundingBox();

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("adRenderSuccess");
    });

    const afterBox = await belowPanel.boundingBox();
    expect(afterBox?.y).toBe(beforeBox?.y);
  });
});
