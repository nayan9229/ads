import { test, expect } from "@playwright/test";

test.describe("F5: no-fill exponential retry", () => {
  test("5 retries on no-fill, then blank reserved container + noFill event", async ({ page }) => {
    await page.goto("/test-page/no-fill.html");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("noFill") ?? false;
    });

    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS,
    );

    // 1 initial auction + 5 retries = 6 total
    expect(calls.requestBids).toHaveLength(6);
    for (const call of calls.requestBids) {
      expect(call.adUnitCodes).toEqual(["slot_nofill"]);
    }

    const container = page.locator('[data-adwrapper-slot="slot_nofill"]');
    await expect(container).toHaveCount(1);
    await expect(container.locator("iframe")).toHaveCount(0);

    const box = await container.boundingBox();
    expect(box?.width).toBe(300);
    expect(box?.height).toBe(250);

    const events = page.locator("#events");
    await expect(events).toContainText(`"slotId":"slot_nofill"`);
  });
});
