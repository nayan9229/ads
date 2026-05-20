import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ConfigRegistry } from "../src/core/config-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { SlotLifecycle } from "../src/core/slot-lifecycle";

function makePbjs(): PrebidAuctionApi & { renderAd: jest.Mock; requestBids: jest.Mock } {
  return {
    addAdUnits: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler({})),
    getHighestCpmBids: jest.fn().mockReturnValue([]),
    renderAd: jest.fn(),
  };
}

describe("SlotLifecycle bidder_config emission", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("emits bidder_config event once with normalized bidders_json at auction start", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_a", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [
        { bidder: "pubmatic", params: { publisherId: "156276", adSlot: "pubmatic_test@300x250" } },
        { bidder: "yahoossp", params: { dcn: "8a96", pos: "300x250_top" } },
      ],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
    callbacks.on("bidder_config", (p) =>
      events.push({ name: "bidder_config", payload: p as Record<string, unknown> }),
    );

    const lifecycle = new SlotLifecycle({
      slotId: "slot_a",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
    });

    lifecycle.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toHaveLength(1);
    const p = events[0]!.payload;
    expect(p["slotId"]).toBe("slot_a");
    expect(p["bidder_count"]).toBe(2);
    expect(p["bidder_names"]).toBe("pubmatic,yahoossp");

    const parsed = JSON.parse(p["bidders_json"] as string) as Array<{
      bidder: string;
      params: Record<string, unknown>;
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.bidder).toBe("pubmatic");
    expect(parsed[0]!.params["publisherId"]).toBe("156276");
    expect(parsed[0]!.params["adSlot"]).toBe("pubmatic_test@300x250");
    expect(parsed[1]!.bidder).toBe("yahoossp");
    expect(parsed[1]!.params["dcn"]).toBe("8a96");
  });

  it("strips PII-class param keys (email, uid2, eids) before serialization", async () => {
    const pbjs = makePbjs();
    const callbacks = new CallbackRegistry(new ErrorRegistry());
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();
    const config = registry.register("slot_pii", {
      mediaTypes: { banner: { sizes: [[300, 250]] } },
      bidders: [
        {
          bidder: "rubicon",
          params: {
            accountId: 14062,
            siteId: 70608,
            email: "a@b.com",
            uid2: "should_drop",
            eids: ["should_drop"],
            hashedEmail: "deadbeef",
          },
        },
      ],
      eager: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);

    const events: Array<Record<string, unknown>> = [];
    callbacks.on("bidder_config", (p) => events.push(p as Record<string, unknown>));

    const lifecycle = new SlotLifecycle({
      slotId: "slot_pii",
      config,
      container,
      callbacks,
      bannerRenderer: new BannerRenderer(pbjs, callbacks),
      pbjs,
      orchestrator,
      isInView: () => true,
    });

    lifecycle.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toHaveLength(1);
    const parsed = JSON.parse(events[0]!["bidders_json"] as string) as Array<{
      bidder: string;
      params: Record<string, unknown>;
    }>;
    const params = parsed[0]!.params;
    expect(params["accountId"]).toBe(14062);
    expect(params["siteId"]).toBe(70608);
    expect(params).not.toHaveProperty("email");
    expect(params).not.toHaveProperty("uid2");
    expect(params).not.toHaveProperty("eids");
    expect(params).not.toHaveProperty("hashedEmail");
  });
});
