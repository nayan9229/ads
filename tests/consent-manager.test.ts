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
