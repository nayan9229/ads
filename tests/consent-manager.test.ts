import { ConsentManager } from "../src/core/consent-manager";

describe("ConsentManager", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete (window as unknown as { __tcfapi?: unknown }).__tcfapi;
    delete (window as unknown as { __uspapi?: unknown }).__uspapi;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("resolves within timeout when no __tcfapi or __uspapi is present", async () => {
    const cm = new ConsentManager({ timeoutMs: 1000, timezone: "America/New_York" });

    const p = cm.resolve();
    await jest.advanceTimersByTimeAsync(1000);

    const state = await p;
    expect(state.tcString).toBeUndefined();
    expect(state.uspString).toBeUndefined();
    expect(state.blocked).toBe(false);
  });

  it("resolves with tcString from __tcfapi when tcloaded event fires (consent granted)", async () => {
    const tcData = {
      tcString: "CO_TEST_STRING",
      eventStatus: "tcloaded",
      gdprApplies: true,
      purpose: { consents: { 1: true } },
    };
    (window as unknown as { __tcfapi: unknown }).__tcfapi = (
      command: string,
      _version: number,
      cb: (data: unknown, success: boolean) => void,
    ) => {
      if (command === "addEventListener") {
        cb(tcData, true);
      }
    };

    const cm = new ConsentManager({ timeoutMs: 1000, timezone: "Europe/London" });
    const state = await cm.resolve();

    expect(state.tcString).toBe("CO_TEST_STRING");
    expect(state.blocked).toBe(false);
  });

  it("resolves with uspString from __uspapi (CCPA)", async () => {
    (window as unknown as { __uspapi: unknown }).__uspapi = (
      command: string,
      _version: number,
      cb: (data: unknown, success: boolean) => void,
    ) => {
      if (command === "getUSPData") cb({ uspString: "1YNN" }, true);
    };

    const cm = new ConsentManager({ timeoutMs: 1000, timezone: "America/New_York" });
    const p = cm.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    const state = await p;

    expect(state.uspString).toBe("1YNN");
    expect(state.blocked).toBe(false);
  });

  it("blocks when TCF gdprApplies=true and purpose 1 consent is missing", async () => {
    (window as unknown as { __tcfapi: unknown }).__tcfapi = (
      command: string,
      _version: number,
      cb: (data: unknown, success: boolean) => void,
    ) => {
      if (command === "addEventListener") {
        cb(
          {
            tcString: "CO_REVOKED",
            eventStatus: "tcloaded",
            gdprApplies: true,
            purpose: { consents: { 1: false } },
          },
          true,
        );
      }
    };

    const cm = new ConsentManager({ timeoutMs: 1000, timezone: "Europe/Paris" });
    const state = await cm.resolve();

    expect(state.tcString).toBe("CO_REVOKED");
    expect(state.blocked).toBe(true);
  });

  it("proceeds without consent when no CMP detected and timezone is non-EU", async () => {
    const cm = new ConsentManager({ timeoutMs: 1000, timezone: "Asia/Tokyo" });
    const p = cm.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    const state = await p;

    expect(state.blocked).toBe(false);
    expect(state.tcString).toBeUndefined();
    expect(state.uspString).toBeUndefined();
  });

  it("blocks when no CMP detected and timezone is in EU/UK", async () => {
    const cm = new ConsentManager({ timeoutMs: 1000, timezone: "Europe/London" });
    const p = cm.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    const state = await p;

    expect(state.blocked).toBe(true);
    expect(state.tcString).toBeUndefined();
  });
});

// P1 (D65): in a SafeFrame the CMP lives on the top page, unreachable directly.
// ConsentManager must reach it via the IAB __tcfLocator postMessage bridge.
describe("ConsentManager — safeframe cross-frame bridge", () => {
  let locator: HTMLIFrameElement;
  let cmpListener: ((e: MessageEvent) => void) | null = null;

  beforeEach(() => {
    jest.useRealTimers();
    delete (window as unknown as { __tcfapi?: unknown }).__tcfapi;
    locator = document.createElement("iframe");
    locator.name = "__tcfLocator";
    document.body.appendChild(locator);
  });
  afterEach(() => {
    if (cmpListener) window.removeEventListener("message", cmpListener);
    cmpListener = null;
    locator.remove();
  });

  it("resolves tcString over the postMessage bridge", async () => {
    cmpListener = (e: MessageEvent) => {
      const data = e.data as { __tcfapiCall?: { callId: string; command: string } };
      if (data && data.__tcfapiCall && data.__tcfapiCall.command === "addEventListener") {
        // Reply as a real CMP does — from the target frame — so event.source is
        // set (jsdom's window.postMessage leaves source null). The SDK bridge
        // trusts replies only from the frame it posted to.
        const reply = new MessageEvent("message", {
          data: {
            __tcfapiReturn: {
              callId: data.__tcfapiCall.callId,
              success: true,
              returnValue: {
                tcString: "CO_SAFEFRAME",
                eventStatus: "tcloaded",
                gdprApplies: true,
                purpose: { consents: { 1: true } },
              },
            },
          },
          source: window as unknown as Window & typeof globalThis,
        });
        window.dispatchEvent(reply);
      }
    };
    window.addEventListener("message", cmpListener);

    const cm = new ConsentManager({ timeoutMs: 3000, timezone: "Europe/London", surface: "safeframe" });
    const state = await cm.resolve();

    expect(state.tcString).toBe("CO_SAFEFRAME");
    expect(state.blocked).toBe(false);
  });

  it("does not use window.__tcfapi directly in safeframe (no in-frame CMP) — falls back to no-CMP policy", async () => {
    locator.remove(); // no locator frame → no bridge target
    const cm = new ConsentManager({ timeoutMs: 40, timezone: "Asia/Tokyo", surface: "safeframe" });
    const state = await cm.resolve();
    expect(state.blocked).toBe(false); // non-EU tz, no CMP reachable
    expect(state.tcString).toBeUndefined();
  });

  it("rejects a forged __tcfapiReturn from a source other than the CMP frame (anti-spoof)", async () => {
    const attacker = document.createElement("iframe");
    document.body.appendChild(attacker);
    cmpListener = (e: MessageEvent) => {
      const data = e.data as { __tcfapiCall?: { callId: string; command: string } };
      if (data && data.__tcfapiCall && data.__tcfapiCall.command === "addEventListener") {
        const forged = new MessageEvent("message", {
          data: {
            __tcfapiReturn: {
              callId: data.__tcfapiCall.callId,
              success: true,
              returnValue: {
                tcString: "FORGED",
                eventStatus: "tcloaded",
                gdprApplies: true,
                purpose: { consents: { 1: true } },
              },
            },
          },
          source: attacker.contentWindow as unknown as Window & typeof globalThis, // NOT the target frame
        });
        window.dispatchEvent(forged);
      }
    };
    window.addEventListener("message", cmpListener);

    const cm = new ConsentManager({ timeoutMs: 60, timezone: "Asia/Tokyo", surface: "safeframe" });
    const state = await cm.resolve();
    attacker.remove();
    expect(state.tcString).toBeUndefined(); // forged reply ignored → timed out to no-CMP
  });
});
