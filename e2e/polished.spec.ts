import { test, expect } from "@playwright/test";

test.describe("polished demo", () => {
  test("renders all above-fold showcase slots in all-win scenario", async ({ page }) => {
    await page.goto("/test-page/polished.html?scenario=all-win");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return (out?.textContent?.match(/adRenderSuccess/g) || []).length >= 4;
    });

    for (const code of ["slot_300x250", "slot_responsive", "slot_refresh"]) {
      const container = page.locator(`[data-adwrapper-slot="${code}"]`);
      await expect(container).toHaveCount(1);
      await expect(container.locator("iframe")).toHaveCount(1);
    }
    const nativeContainer = page.locator('[data-adwrapper-slot="slot_native"]');
    await expect(nativeContainer.locator(".card-native")).toHaveCount(1);
  });

  test("scenario picker navigates to the chosen scenario", async ({ page }) => {
    await page.goto("/test-page/polished.html?scenario=all-win");

    await page.selectOption("#scenario-picker", "no-fill");
    await page.waitForURL(/scenario=no-fill/);

    // No-fill scenario produces noFill events after retry exhaustion.
    await page.waitForFunction(
      () => {
        const out = document.getElementById("events");
        return out?.textContent?.includes("noFill") ?? false;
      },
      undefined,
      { timeout: 30_000 },
    );
  });

  test("event stream displays adRenderSuccess and per-slot badge shows rendered", async ({
    page,
  }) => {
    await page.goto("/test-page/polished.html?scenario=all-win");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      return out?.textContent?.includes("adRenderSuccess") ?? false;
    });

    const badge = page.locator('[data-slot="slot_300x250"]');
    await expect(badge).toHaveAttribute("data-state", "rendered");
  });
});
