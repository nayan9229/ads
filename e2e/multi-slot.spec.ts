import { test, expect } from "@playwright/test";

test.describe("F4: multi-slot batched auction", () => {
  test("three eager slots batch into a single requestBids call", async ({ page }) => {
    await page.goto("/test-page/multi-slot.html");

    await page.waitForFunction(() => {
      const out = document.getElementById("events");
      const txt = out?.textContent || "";
      return (txt.match(/adRenderSuccess/g) || []).length >= 3;
    });

    const calls = await page.evaluate(
      () =>
        (
          window as unknown as {
            MOCK_PBJS_CALLS: { requestBids: Array<{ adUnitCodes: string[] }> };
          }
        ).MOCK_PBJS_CALLS,
    );

    expect(calls.requestBids).toHaveLength(1);
    expect(calls.requestBids[0]?.adUnitCodes.sort()).toEqual(["slot_a", "slot_b", "slot_c"]);

    for (const code of ["slot_a", "slot_b", "slot_c"]) {
      const container = page.locator(`[data-adwrapper-slot="${code}"]`);
      await expect(container).toHaveCount(1);
      await expect(container.locator("iframe")).toHaveCount(1);
    }
  });
});
