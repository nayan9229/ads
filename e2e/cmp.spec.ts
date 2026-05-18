import { test, expect } from "@playwright/test";

test.describe("F8: consent gate", () => {
  test("EU geo + no CMP → auction blocked, E_NO_CMP error emitted", async ({ page }) => {
    await page.goto("/test-page/cmp.html?cmp=eu&cmp_state=none");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("E_NO_CMP") ?? false;
    });

    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS,
    );
    expect(calls.requestBids).toHaveLength(0);

    const container = page.locator('[data-adwrapper-slot="slot_cmp"]');
    await expect(container.locator("iframe")).toHaveCount(0);
  });

  test("EU geo + loaded TCF CMP → auction proceeds + slot renders", async ({ page }) => {
    await page.goto("/test-page/cmp.html?cmp=eu&cmp_state=loaded");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("adRenderSuccess") ?? false;
    });

    const container = page.locator('[data-adwrapper-slot="slot_cmp"]');
    await expect(container.locator("iframe")).toHaveCount(1);
  });

  test("non-EU geo + no CMP → auction proceeds without consent string", async ({ page }) => {
    await page.goto("/test-page/cmp.html?cmp=none&cmp_state=none");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("adRenderSuccess") ?? false;
    });

    const container = page.locator('[data-adwrapper-slot="slot_cmp"]');
    await expect(container.locator("iframe")).toHaveCount(1);
  });
});
