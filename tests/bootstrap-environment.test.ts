import { bootstrap } from "../src/core/bootstrap";

describe("bootstrap — environment_detected event", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });
  afterEach(() => {
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("emits environment_detected event with explicit environment override", () => {
    const seen: unknown[] = [];
    const api = bootstrap({
      prebidSrc: "https://example.com/prebid.js",
      consentDisabled: true,
      environment: "webview",
    });
    api.on("environment_detected", (p) => seen.push(p));

    // Subscribe after bootstrap — emit happens via deferred microtask so handler attaches first.
    return Promise.resolve().then(() => {
      expect(seen).toEqual([{ environment: "webview" }]);
    });
  });
});
