import { bootstrap } from "../src/core/bootstrap";
import type { PrebidGlobal } from "../src/core/dependency-loader";
import {
  installIntersectionObserverStub,
  uninstallIntersectionObserverStub,
  triggerEntry,
} from "./helpers/iox-stub";

interface PbjsStub {
  que: Array<() => void>;
  setConfig: jest.Mock;
  addAdUnits: jest.Mock;
  removeAdUnit: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
  renderAd: jest.Mock;
}

function makePbjs(winner: { adId: string; width: number; height: number } | null): PbjsStub {
  return {
    que: [],
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue(winner ? [{ ...winner, cpm: 1 }] : []),
    renderAd: jest.fn(),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  jest.advanceTimersByTime(50);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function installSendBeaconStub(): {
  calls: Array<{ url: string; body: string }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; body: string }> = [];
  const prev = navigator.sendBeacon;
  (navigator as unknown as { sendBeacon: (u: string, b?: BodyInit) => boolean }).sendBeacon = (
    url,
    data,
  ) => {
    calls.push({ url, body: typeof data === "string" ? data : "" });
    return true;
  };
  return {
    calls,
    restore: () => {
      (navigator as unknown as { sendBeacon: typeof navigator.sendBeacon }).sendBeacon = prev;
    },
  };
}

describe("bootstrap — analytics emitter wiring", () => {
  let pbjs: PbjsStub;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    jest.useFakeTimers();
    installIntersectionObserverStub();
  });
  afterEach(() => {
    jest.useRealTimers();
    uninstallIntersectionObserverStub();
    delete (window as { AdWrapper?: unknown }).AdWrapper;
  });

  it("wires emitter from analytics.endpoint; adRenderSuccess fires a beacon", async () => {
    pbjs = makePbjs({ adId: "bid_a", width: 300, height: 250 });
    const stub = installSendBeaconStub();
    try {
      (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
        slot_an: {
          mediaTypes: { banner: { sizes: [[300, 250]] } },
          bidders: [{ bidder: "appnexus", params: {} }],
          eager: true,
        },
      };
      const script = document.createElement("script");
      script.id = "slot_an";
      document.body.appendChild(script);

      const api = bootstrap({
        prebidSrc: "https://example.com/prebid.js",
        prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
        consentDisabled: true,
        analytics: { endpoint: "https://analytics.example.com/e" },
      });

      const reg = api.registerScript(script);
      await flush();
      await reg;

      const types = stub.calls.map((c) => (JSON.parse(c.body) as { type: string }).type);
      expect(types).toContain("adRenderSuccess");
    } finally {
      stub.restore();
    }
  });

  it("forwards noFill to the beacon", async () => {
    pbjs = makePbjs(null);
    const stub = installSendBeaconStub();
    try {
      (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
        slot_nf: {
          mediaTypes: { banner: { sizes: [[300, 250]] } },
          bidders: [{ bidder: "appnexus", params: {} }],
          eager: true,
        },
      };
      const script = document.createElement("script");
      script.id = "slot_nf";
      document.body.appendChild(script);

      const api = bootstrap({
        prebidSrc: "https://example.com/prebid.js",
        prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
        consentDisabled: true,
        analytics: { endpoint: "https://analytics.example.com/e" },
        retryDelaysMs: [10, 10, 10, 10, 10],
      });

      const reg = api.registerScript(script);
      await flush();
      await reg;

      // Exhaust retries quickly.
      for (let i = 0; i < 5; i++) {
        await jest.advanceTimersByTimeAsync(10);
        await jest.advanceTimersByTimeAsync(50);
      }

      const types = stub.calls.map((c) => (JSON.parse(c.body) as { type: string }).type);
      expect(types).toContain("noFill");
    } finally {
      stub.restore();
    }
  });

  it("forwards viewable event to the beacon", async () => {
    pbjs = makePbjs({ adId: "bid_v", width: 300, height: 250 });
    const stub = installSendBeaconStub();
    try {
      (window as unknown as { AdWrapperConfig: Record<string, unknown> }).AdWrapperConfig = {
        slot_v: {
          mediaTypes: { banner: { sizes: [[300, 250]] } },
          bidders: [{ bidder: "appnexus", params: {} }],
          eager: true,
        },
      };
      const script = document.createElement("script");
      script.id = "slot_v";
      document.body.appendChild(script);

      const api = bootstrap({
        prebidSrc: "https://example.com/prebid.js",
        prebidLoaderOverride: () => Promise.resolve(pbjs as unknown as PrebidGlobal),
        consentDisabled: true,
        analytics: { endpoint: "https://analytics.example.com/e" },
      });

      const reg = api.registerScript(script);
      await flush();
      await reg;

      const container = document.querySelector('[data-adwrapper-slot="slot_v"]') as HTMLDivElement;
      triggerEntry(container, true, 0.7);
      await jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();

      const types = stub.calls.map((c) => (JSON.parse(c.body) as { type: string }).type);
      expect(types).toContain("viewable");
    } finally {
      stub.restore();
    }
  });
});
