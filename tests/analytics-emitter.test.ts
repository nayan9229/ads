import { AnalyticsEmitter } from "../src/core/analytics-emitter";

function installSendBeaconStub(): {
  calls: Array<{ url: string; body: string }>;
  restore: () => void;
  setReturn(v: boolean): void;
} {
  const calls: Array<{ url: string; body: string }> = [];
  let ret = true;
  const prev = navigator.sendBeacon;
  (navigator as unknown as { sendBeacon: (url: string, data?: BodyInit) => boolean }).sendBeacon = (
    url: string,
    data?: BodyInit,
  ): boolean => {
    const body = typeof data === "string" ? data : "";
    calls.push({ url, body });
    return ret;
  };
  return {
    calls,
    restore: () => {
      (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon = prev;
    },
    setReturn: (v: boolean) => {
      ret = v;
    },
  };
}

describe("AnalyticsEmitter", () => {
  it("emit() calls navigator.sendBeacon with versioned JSON schema", () => {
    const stub = installSendBeaconStub();
    try {
      const emitter = new AnalyticsEmitter({
        endpoint: "https://analytics.example.com/v1/events",
        sessionId: "sess_xyz",
        getNow: () => 1730000000000,
      });

      emitter.emit("adRenderSuccess", { slotId: "slot_a", adId: "bid_1" });

      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]?.url).toBe("https://analytics.example.com/v1/events");
      expect(JSON.parse(stub.calls[0]!.body)).toEqual({
        v: 1,
        type: "adRenderSuccess",
        ts: 1730000000000,
        sessionId: "sess_xyz",
        slotId: "slot_a",
        adId: "bid_1",
      });
    } finally {
      stub.restore();
    }
  });

  it("sampleRate: 0 suppresses every emission", () => {
    const stub = installSendBeaconStub();
    try {
      const emitter = new AnalyticsEmitter({
        endpoint: "https://x.example.com/e",
        sessionId: "s",
        sampleRate: 0,
      });
      for (let i = 0; i < 10; i++) emitter.emit("evt", { i });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it("sampleRate: 0.5 with deterministic RNG drops half the events", () => {
    const stub = installSendBeaconStub();
    const rngValues = [0.2, 0.7, 0.4, 0.9];
    let i = 0;
    try {
      const emitter = new AnalyticsEmitter({
        endpoint: "https://x.example.com/e",
        sessionId: "s",
        sampleRate: 0.5,
        rng: () => rngValues[i++ % rngValues.length] ?? 0,
      });
      for (let k = 0; k < 4; k++) emitter.emit("evt", { k });

      // RNG returns 0.2 (< 0.5 → emit), 0.7 (>= 0.5 → drop),
      // 0.4 (< 0.5 → emit), 0.9 (>= 0.5 → drop).
      expect(stub.calls).toHaveLength(2);
    } finally {
      stub.restore();
    }
  });

  it("buffers when sendBeacon returns false; flushes on pagehide", () => {
    const stub = installSendBeaconStub();
    stub.setReturn(false);

    try {
      const emitter = new AnalyticsEmitter({
        endpoint: "https://x.example.com/e",
        sessionId: "s",
      });
      emitter.attachPageHideFlush(window);

      emitter.emit("evt", { i: 1 });
      emitter.emit("evt", { i: 2 });

      // sendBeacon called but returned false; buffer holds events.
      const beforeFlush = stub.calls.length;
      expect(beforeFlush).toBe(2);

      stub.setReturn(true);
      window.dispatchEvent(new Event("pagehide"));

      // Two buffered events should have flushed (extra sendBeacon calls).
      expect(stub.calls.length - beforeFlush).toBe(2);

      emitter.dispose();
    } finally {
      stub.restore();
    }
  });

  it("buffer overflow emits a buffer_overflow event once and drops further", () => {
    const stub = installSendBeaconStub();
    stub.setReturn(false);

    try {
      const emitter = new AnalyticsEmitter({
        endpoint: "https://x.example.com/e",
        sessionId: "s",
        bufferCap: 3,
      });
      emitter.attachPageHideFlush(window);

      for (let i = 0; i < 10; i++) emitter.emit("evt", { i });

      const callsBeforeFlush = stub.calls.length;
      stub.setReturn(true);
      window.dispatchEvent(new Event("pagehide"));

      const flushed = stub.calls
        .slice(callsBeforeFlush)
        .map((c) => JSON.parse(c.body) as { type: string });
      // Buffer holds 3 entries max; final one is the buffer_overflow marker.
      expect(flushed).toHaveLength(3);
      expect(flushed[flushed.length - 1]?.type).toBe("buffer_overflow");

      emitter.dispose();
    } finally {
      stub.restore();
    }
  });

  it("no endpoint configured → no sendBeacon call", () => {
    const stub = installSendBeaconStub();
    try {
      const emitter = new AnalyticsEmitter({ sessionId: "s1" });
      emitter.emit("adRenderSuccess", { slotId: "x" });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });
});
