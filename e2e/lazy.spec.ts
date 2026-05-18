import { test, expect } from "@playwright/test";

test.describe("F6: below-fold lazy load", () => {
  test("no requestBids until page scrolled near the slot", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto("/test-page/lazy.html");

    // Page just loaded — slot is below the fold + 400px rootMargin. No auction yet.
    await page.waitForTimeout(300);
    const initial = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS.requestBids.length,
    );
    expect(initial).toBe(0);

    // Scroll to the slot container (script tag is non-visible).
    await page.locator('[data-adwrapper-slot="slot_lazy"]').scrollIntoViewIfNeeded();

    await page.waitForFunction(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS.requestBids.length >= 1,
    );

    const after = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS,
    );

    expect(after.requestBids.length).toBeGreaterThanOrEqual(1);
    expect(after.requestBids[0]?.adUnitCodes).toEqual(["slot_lazy"]);

    const container = page.locator('[data-adwrapper-slot="slot_lazy"]');
    await expect(container.locator("iframe")).toHaveCount(1);
  });
});
