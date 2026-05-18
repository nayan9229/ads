import { test, expect } from "@playwright/test";

test.describe("F3: native ad", () => {
  test("native card renders with template; malicious title not executed", async ({ page }) => {
    const xssFlag: { triggered: boolean } = { triggered: false };
    page.on("pageerror", () => {
      // pageerror would fire if a script in title executed; record nothing here.
    });

    await page.exposeFunction("__xssTrip", () => {
      xssFlag.triggered = true;
    });

    await page.addInitScript(() => {
      Object.defineProperty(window, "__xss", {
        set() {
          (window as unknown as { __xssTrip: () => void }).__xssTrip();
        },
        get() {
          return undefined;
        },
        configurable: true,
      });
    });

    await page.goto("/test-page/native.html");

    const container = page.locator('[data-adwrapper-slot="slot_native"]');
    await expect(container).toHaveCount(1);

    const card = container.locator(".card");
    await expect(card).toHaveCount(1);

    await expect(card.locator(".title")).toContainText("window.__xss=true");
    await expect(card.locator(".title")).toContainText("Hello");
    await expect(card.locator(".body")).toHaveText("Native ad body text.");
    await expect(card.locator(".cta")).toHaveText("Buy now");

    expect(await container.locator("script").count()).toBe(0);

    await page.waitForTimeout(300);
    expect(xssFlag.triggered).toBe(false);
  });
});
