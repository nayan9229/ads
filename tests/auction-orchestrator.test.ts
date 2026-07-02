import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { ConfigRegistry } from "../src/core/config-registry";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";

function makeStubPbjs(): PrebidAuctionApi & {
  renderAd: jest.Mock;
  requestBids: jest.Mock<void, [{ adUnitCodes: string[]; bidsBackHandler: () => void }]>;
  addAdUnits: jest.Mock;
  getHighestCpmBids: jest.Mock;
} {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler()),
    getHighestCpmBids: jest.fn((code: string) => [
      { adId: `bid_${code}`, width: 300, height: 250, cpm: 1 },
    ]),
    renderAd: jest.fn(),
  };
}

function makeSlot(
  slotId: string,
  callbacks: CallbackRegistry,
  pbjs: PrebidAuctionApi & { renderAd: (doc: Document, adId: string) => void },
) {
  const registry = new ConfigRegistry();
  const config = registry.register(slotId, {
    mediaTypes: { banner: { sizes: [[300, 250]] } },
    bidders: [{ bidder: "appnexus", params: { placementId: 1 } }],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const renderer = new BannerRenderer(pbjs, callbacks);
  const lifecycle = new SlotLifecycle({
    slotId,
    config,
    container,
    callbacks,
    bannerRenderer: renderer,
    pbjs,
  });
  return { slotId, config, lifecycle, container };
}

describe("AuctionOrchestrator — batched auction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("two slots enqueued back-to-back batch into ONE requestBids covering both adUnitCodes", () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const a = makeSlot("slot_a", callbacks, pbjs);
    const b = makeSlot("slot_b", callbacks, pbjs);

    orchestrator.enqueue(a);
    orchestrator.enqueue(b);

    expect(pbjs.requestBids).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
    const call = pbjs.requestBids.mock.calls[0]?.[0];
    expect(call?.adUnitCodes).toEqual(expect.arrayContaining(["slot_a", "slot_b"]));
    expect(call?.adUnitCodes).toHaveLength(2);
  });

  it("a single enqueued slot still flushes after the debounce window and renders", () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const a = makeSlot("solo_slot", callbacks, pbjs);

    orchestrator.enqueue(a);
    expect(pbjs.requestBids).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);

    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);
    expect(pbjs.renderAd).toHaveBeenCalledTimes(1);
    expect(a.container.querySelector("iframe")).not.toBeNull();
  });

  it("a late-arriving slot registered after flush triggers a separate second requestBids", () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const first = makeSlot("first_slot", callbacks, pbjs);
    orchestrator.enqueue(first);
    jest.advanceTimersByTime(50);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    const second = makeSlot("second_slot", callbacks, pbjs);
    orchestrator.enqueue(second);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(50);
    expect(pbjs.requestBids).toHaveBeenCalledTimes(2);

    const codes = pbjs.requestBids.mock.calls.map((c) => c[0].adUnitCodes);
    expect(codes).toEqual([["first_slot"], ["second_slot"]]);
  });

  it("emits resolved breakpoint sizes (not the raw map) to pbjs.addAdUnits", () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const registry = new ConfigRegistry();
    const config = registry.register("slot_bp", {
      mediaTypes: {
        banner: {
          sizes: {
            "0-767": [[300, 250]],
            "768-1199": [[728, 90]],
            "1200+": [[970, 250]],
          },
        },
      },
      bidders: [{ bidder: "appnexus", params: {} }],
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new BannerRenderer(pbjs, callbacks);
    const lifecycle = new SlotLifecycle({
      slotId: "slot_bp",
      config,
      container,
      callbacks,
      bannerRenderer: renderer,
      pbjs,
    });

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });

    orchestrator.enqueue({ slotId: "slot_bp", config, lifecycle });
    jest.advanceTimersByTime(50);

    expect(pbjs.addAdUnits).toHaveBeenCalledTimes(1);
    const units = pbjs.addAdUnits.mock.calls[0]?.[0] as Array<{
      mediaTypes: { banner: { sizes: number[][] } };
    }>;
    expect(units[0]?.mediaTypes.banner.sizes).toEqual([[728, 90]]);
  });

  it("dispatches each slot's own winner; no-bid slots take the noFill path", () => {
    const pbjs = makeStubPbjs();
    pbjs.getHighestCpmBids = jest.fn((code: string) => {
      if (code === "winner_slot") {
        return [{ adId: "bid_winner_slot", width: 300, height: 250, cpm: 2 }];
      }
      return [];
    });

    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const events: Array<{ event: string; payload: unknown }> = [];
    callbacks.on("adRenderSuccess", (p) => events.push({ event: "adRenderSuccess", payload: p }));
    callbacks.on("noFill", (p) => events.push({ event: "noFill", payload: p }));

    const orchestrator = new AuctionOrchestrator(pbjs);
    const winner = makeSlot("winner_slot", callbacks, pbjs);
    const loser = makeSlot("loser_slot", callbacks, pbjs);

    orchestrator.enqueue(winner);
    orchestrator.enqueue(loser);
    jest.advanceTimersByTime(50);

    expect(winner.container.querySelector("iframe")).not.toBeNull();
    expect(loser.container.querySelector("iframe")).toBeNull();

    expect(events).toEqual([
      {
        event: "adRenderSuccess",
        payload: {
          slotId: "winner_slot",
          adId: "bid_winner_slot",
          size: [300, 250],
          cpm: 2,
          currency: "USD",
          cpmUsd: 2,
        },
      },
      { event: "noFill", payload: { slotId: "loser_slot" } },
    ]);
  });

  it("re-enqueueing same slotId calls pbjs.removeAdUnit before addAdUnits so imp[] does not accumulate", () => {
    const pbjs = makeStubPbjs() as ReturnType<typeof makeStubPbjs> & {
      removeAdUnit: jest.Mock;
    };
    pbjs.removeAdUnit = jest.fn();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const s = makeSlot("retry_slot", callbacks, pbjs);

    orchestrator.enqueue({ slotId: s.slotId, config: s.config, lifecycle: s.lifecycle });
    jest.runAllTimers();
    orchestrator.enqueue({ slotId: s.slotId, config: s.config, lifecycle: s.lifecycle });
    jest.runAllTimers();

    expect(pbjs.addAdUnits).toHaveBeenCalledTimes(2);
    expect(pbjs.removeAdUnit).toHaveBeenCalledTimes(2);
    expect(pbjs.removeAdUnit).toHaveBeenNthCalledWith(1, "retry_slot");
    expect(pbjs.removeAdUnit).toHaveBeenNthCalledWith(2, "retry_slot");
  });
});

// P2/#4 (D65): the orchestrator stamps measured-viewable into the adUnit's imp.
describe("AuctionOrchestrator — imp viewability stamp (#4)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it("stamps ortb2Imp.ext.data.viewability when the slot reports a viewability signal", () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const a = makeSlot("slot_vp", callbacks, pbjs);
    jest.spyOn(a.lifecycle, "viewabilitySignal").mockReturnValue(0.7);

    orchestrator.enqueue(a);
    jest.advanceTimersByTime(50);

    const adUnit = pbjs.addAdUnits.mock.calls[0][0][0];
    expect(adUnit.ortb2Imp).toEqual({ ext: { data: { viewability: 0.7 } } });
  });

  it("omits ortb2Imp when no viewability signal is available (e.g. top surface)", () => {
    const pbjs = makeStubPbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);

    const a = makeSlot("slot_novp", callbacks, pbjs);
    orchestrator.enqueue(a);
    jest.advanceTimersByTime(50);

    const adUnit = pbjs.addAdUnits.mock.calls[0][0][0];
    expect(adUnit.ortb2Imp).toBeUndefined();
  });
});
