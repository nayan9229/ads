import { test, expect } from "@playwright/test";

test.describe("F7: viewability-gated refresh", () => {
  test("multiple requestBids fire after viewable; tab hidden pauses", async ({ page, context }) => {
    await page.goto("/test-page/refresh.html");

    // First impression renders.
    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("adRenderSuccess") ?? false;
    });

    // Wait for viewable + at least one refresh + second requestBids actually fired.
    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      const txt = out?.textContent || "";
      const calls = (
        window as unknown as {
          MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
        }
      ).MOCK_PBJS_CALLS.requestBids.length;
      return txt.includes("viewable") && calls >= 2;
    });

    const before = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS.requestBids.length,
    );
    expect(before).toBeGreaterThanOrEqual(2);

    // Hide tab — refreshes should pause.
    await context.newPage(); // brings focus to another tab; original goes hidden
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await page.waitForTimeout(2500);
    const after = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS.requestBids.length,
    );

    // Tolerate one in-flight refresh that started before pause; verify rate stopped.
    expect(after - before).toBeLessThanOrEqual(1);
  });
});
