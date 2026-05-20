import { NewRelicSink, ScriptLoader } from "../src/core/nr-sink";

interface MockAgent {
  addPageAction: jest.Mock;
}

interface NRWin {
  newrelic?: Partial<MockAgent>;
  NREUM?: {
    loader_config?: Record<string, unknown>;
    info?: Record<string, unknown>;
    init?: Record<string, unknown>;
  };
}

function makeWin(initial: NRWin = {}): NRWin {
  return { ...initial };
}

function makeAgent(): MockAgent {
  return {
    addPageAction: jest.fn(),
  };
}

function neverScriptLoader(): ScriptLoader {
  return () => new Promise<void>(() => undefined);
}

const baseConfig = {
  licenseKey: "lk-1",
  applicationID: "app-1",
} as const;

describe("NewRelicSink", () => {
  describe("with pre-existing window.newrelic", () => {
    it("addPageAction is called with adwrapper_ prefix and allowlisted attrs", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "sess_1",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      sink.emit("adRenderSuccess", {
        slotId: "slot_a",
        bidder: "rubicon",
        cpm: 1.37,
        size: [300, 250],
        mediaType: "banner",
        deviceId: "dev_should_be_dropped",
        eids: ["should_be_dropped"],
      });

      expect(agent.addPageAction).toHaveBeenCalledTimes(1);
      const [name, attrs] = agent.addPageAction.mock.calls[0]!;
      expect(name).toBe("adwrapper_adRenderSuccess");
      expect(attrs).toEqual({
        sessionId: "sess_1",
        slotId: "slot_a",
        bidder: "rubicon",
        cpm_bucket: 1.25,
        size: "300x250",
        mediaType: "banner",
      });
      expect(attrs).not.toHaveProperty("deviceId");
      expect(attrs).not.toHaveProperty("eids");
      expect(attrs).not.toHaveProperty("cpm");
    });

    it("error events route through addPageAction with adwrapper_error name", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "sess_2",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      sink.emitError({
        code: "E_RENDER_FAIL",
        message: "render failed",
        context: { slotId: "slot_b" },
      });

      expect(agent.addPageAction).toHaveBeenCalledTimes(1);
      const [name, attrs] = agent.addPageAction.mock.calls[0]!;
      expect(name).toBe("adwrapper_error");
      expect(attrs).toEqual({
        sessionId: "sess_2",
        code: "E_RENDER_FAIL",
        message: "render failed",
        slotId: "slot_b",
      });
    });

    it("bidder_config event forwards normalized bidder snapshot", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      sink.emit("bidder_config", {
        slotId: "slot_a",
        bidder_count: 2,
        bidder_names: "pubmatic,yahoossp",
        bidders_json:
          '[{"bidder":"pubmatic","params":{"publisherId":"156276","adSlot":"pubmatic_test@300x250"}},{"bidder":"yahoossp","params":{"dcn":"8a96..."}}]',
        deviceId: "should_be_dropped",
      });

      expect(agent.addPageAction).toHaveBeenCalledTimes(1);
      const [name, attrs] = agent.addPageAction.mock.calls[0]!;
      expect(name).toBe("adwrapper_bidder_config");
      expect(attrs).toMatchObject({
        sessionId: "s",
        slotId: "slot_a",
        bidder_count: 2,
        bidder_names: "pubmatic,yahoossp",
      });
      expect((attrs as Record<string, unknown>)["bidders_json"]).toContain("pubmatic");
      expect(attrs).not.toHaveProperty("deviceId");
    });

    it("unknown event names are dropped (no allowlist match)", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      sink.emit("not_a_real_event", { slotId: "x" });

      expect(agent.addPageAction).not.toHaveBeenCalled();
    });

    it("error message longer than 200 chars is truncated", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      const long = "x".repeat(500);
      sink.emitError({ code: "E_X", message: long });

      const attrs = agent.addPageAction.mock.calls[0]![1] as { message: string };
      expect(attrs.message.length).toBe(200);
    });

    it("does not seed window.NREUM when agent already present", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
       
      const _sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });
      expect(win.NREUM).toBeUndefined();
    });
  });

  describe("sampling", () => {
    it("sampleRate: 0 drops non-error events but error events still flow", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: { ...baseConfig, sampleRate: 0 },
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      sink.emit("viewable", { slotId: "a" });
      sink.emit("refresh", { slotId: "a", count: 1 });
      sink.emitError({ code: "E_RENDER_FAIL", message: "boom" });

      expect(agent.addPageAction).toHaveBeenCalledTimes(1);
      expect(agent.addPageAction.mock.calls[0]![0]).toBe("adwrapper_error");
    });

    it("sampleRate is session-coherent (one decision for the sink)", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      // rng returns 0.1 once at construction → sampledIn (< 0.5)
      const sink = new NewRelicSink({
        config: { ...baseConfig, sampleRate: 0.5 },
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
        rng: () => 0.1,
      });

      for (let i = 0; i < 5; i++) sink.emit("viewable", { slotId: "a" });
      expect(agent.addPageAction).toHaveBeenCalledTimes(5);
    });

    it("sampledOut session drops all non-error events uniformly", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: { ...baseConfig, sampleRate: 0.5 },
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
        rng: () => 0.9,
      });

      for (let i = 0; i < 5; i++) sink.emit("viewable", { slotId: "a" });
      expect(agent.addPageAction).not.toHaveBeenCalled();
    });
  });

  describe("pre-ready queue", () => {
    it("buffers events until loader resolves, then flushes", async () => {
      let resolveLoader: (() => void) | null = null;
      const loader: ScriptLoader = (_src, win) =>
        new Promise<void>((resolve) => {
          resolveLoader = () => {
            (win as unknown as NRWin).newrelic = makeAgent();
            resolve();
          };
        });

      const win = makeWin();
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: loader,
      });

      sink.emit("viewable", { slotId: "a" });
      sink.emitError({ code: "E_X", message: "m" });

      // No agent yet — nothing should have been called
      expect(win.newrelic).toBeUndefined();

      resolveLoader!();
      await new Promise((r) => setTimeout(r, 0));

      const agent = win.newrelic as unknown as MockAgent;
      expect(agent.addPageAction).toHaveBeenCalledTimes(2);
      const names = agent.addPageAction.mock.calls.map((c) => c[0]);
      expect(names).toEqual(["adwrapper_viewable", "adwrapper_error"]);
    });

    it("loader rejection silently drops the queue", async () => {
      const loader: ScriptLoader = () => Promise.reject(new Error("blocked by CSP"));

      const win = makeWin();
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: loader,
      });

      sink.emit("viewable", { slotId: "a" });
      await new Promise((r) => setTimeout(r, 0));

      // dispose works fine and there is no thrown error
      expect(() => sink.dispose()).not.toThrow();
    });

    it("queueCap drops oldest when buffer fills (no overflow event)", async () => {
      let resolveLoader: (() => void) | null = null;
      const loader: ScriptLoader = (_src, win) =>
        new Promise<void>((resolve) => {
          resolveLoader = () => {
            (win as unknown as NRWin).newrelic = makeAgent();
            resolve();
          };
        });

      const win = makeWin();
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: loader,
        queueCap: 3,
      });

      for (let i = 0; i < 10; i++) sink.emit("viewable", { slotId: "slot_" + i });

      resolveLoader!();
      await new Promise((r) => setTimeout(r, 0));

      const agent = win.newrelic as unknown as MockAgent;
      // Only the last 3 should have flushed
      expect(agent.addPageAction).toHaveBeenCalledTimes(3);
      const slotIds = agent.addPageAction.mock.calls.map((c) => (c[1] as { slotId: string }).slotId);
      expect(slotIds).toEqual(["slot_7", "slot_8", "slot_9"]);
    });
  });

  describe("NREUM seeding", () => {
    it("seeds window.NREUM with publisher config before triggering loader", () => {
      const loader: ScriptLoader = () => new Promise<void>(() => undefined);
      const win = makeWin();
       
      const _sink = new NewRelicSink({
        config: {
          licenseKey: "lk-eu",
          applicationID: "app-eu",
          accountID: "acc-eu",
          beacon: "bam.eu01.nr-data.net",
        },
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: loader,
      });

      expect(win.NREUM).toBeDefined();
      expect(win.NREUM!.loader_config).toMatchObject({
        licenseKey: "lk-eu",
        applicationID: "app-eu",
        accountID: "acc-eu",
      });
      expect(win.NREUM!.info).toMatchObject({
        licenseKey: "lk-eu",
        applicationID: "app-eu",
        beacon: "bam.eu01.nr-data.net",
        errorBeacon: "bam.eu01.nr-data.net",
      });
    });

    it("init disables every NR auto-feature except page_action", () => {
      const loader: ScriptLoader = () => new Promise<void>(() => undefined);
      const win = makeWin();
       
      const _sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: loader,
      });

      const init = win.NREUM!.init as Record<string, { enabled?: boolean }>;
      expect(init["ajax"]?.enabled).toBe(false);
      expect(init["jserrors"]?.enabled).toBe(false);
      expect(init["metrics"]?.enabled).toBe(false);
      expect(init["page_view_event"]?.enabled).toBe(false);
      expect(init["page_view_timing"]?.enabled).toBe(false);
      expect(init["session_replay"]?.enabled).toBe(false);
      expect(init["session_trace"]?.enabled).toBe(false);
      expect(init["spa"]?.enabled).toBe(false);
      expect(init["distributed_tracing"]?.enabled).toBe(false);
      expect(init["page_action"]?.enabled).toBe(true);
    });

    it("enabled: false skips loader injection and NREUM seeding", () => {
      const loader = jest.fn(() => new Promise<void>(() => undefined));
      const win = makeWin();
       
      const _sink = new NewRelicSink({
        config: { ...baseConfig, enabled: false },
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: loader,
      });

      expect(loader).not.toHaveBeenCalled();
      expect(win.NREUM).toBeUndefined();
    });
  });

  describe("dispose", () => {
    it("after dispose, no further calls reach the agent", () => {
      const agent = makeAgent();
      const win = makeWin({ newrelic: agent });
      const sink = new NewRelicSink({
        config: baseConfig,
        sessionId: "s",
        window: win as unknown as Window & typeof win,
        scriptLoader: neverScriptLoader(),
      });

      sink.dispose();
      sink.emit("viewable", { slotId: "a" });
      sink.emitError({ code: "E_X", message: "m" });

      expect(agent.addPageAction).not.toHaveBeenCalled();
    });
  });
});
