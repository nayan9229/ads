import { bootstrap } from "../src/core/bootstrap";

describe("bootstrap — singleton", () => {
  beforeEach(() => {
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("returns the same instance on a second call (window.AdWrapper preserved)", () => {
    const a = bootstrap({ prebidSrc: "https://example.com/prebid.js" });
    const b = bootstrap({ prebidSrc: "https://example.com/prebid.js" });

    expect(a).toBe(b);
    expect((window as { AdWrapper?: unknown }).AdWrapper).toBe(a);
  });
});
