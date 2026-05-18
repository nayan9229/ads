import { AuctionOrchestrator, PrebidAuctionApi } from "../src/core/auction-orchestrator";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { ConfigRegistry } from "../src/core/config-registry";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";

function makeStubPbjs(): PrebidAuctionApi & {
  addAdUnits: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
  renderAd: jest.Mock;
  removeAdUnit: jest.Mock;
} {
  return {
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler()),
    getHighestCpmBids: jest.fn(() => []),
    renderAd: jest.fn(),
  };
}

function enqueueVideoSlot(
  registry: ConfigRegistry,
  orchestrator: AuctionOrchestrator,
  pbjs: PrebidAuctionApi & { renderAd: (doc: Document, adId: string) => void },
  slotId: string,
  rawConfig: Record<string, unknown>,
): void {
  const config = registry.register(slotId, rawConfig);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const callbacks = new CallbackRegistry(new ErrorRegistry());
  const banner = new BannerRenderer(pbjs, callbacks);
  const lifecycle = new SlotLifecycle({
    slotId,
    config,
    container,
    callbacks,
    bannerRenderer: banner,
    pbjs,
  });
  orchestrator.enqueue({ slotId, config, lifecycle });
}

function getEmittedVideo(
  pbjs: PrebidAuctionApi & { addAdUnits: jest.Mock },
): Record<string, unknown> {
  const units = pbjs.addAdUnits.mock.calls[0]?.[0] as Array<{
    mediaTypes: { video?: Record<string, unknown> };
  }>;
  return units[0]!.mediaTypes.video!;
}

describe("video linearity — coerce-to-1 default", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("forwards linearity: 1 verbatim into emitted adUnit", () => {
    const pbjs = makeStubPbjs();
    const orchestrator = new AuctionOrchestrator(pbjs);
    enqueueVideoSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_lin1", {
      mediaTypes: {
        video: { context: "instream", linearity: 1, playerSize: [640, 480], mimes: ["video/mp4"] },
      },
      bidders: [{ bidder: "pubmatic", params: { publisherId: "x", adSlot: "y" } }],
    });
    jest.runAllTimers();

    expect(getEmittedVideo(pbjs).linearity).toBe(1);
  });

  it("forwards linearity: 2 verbatim into emitted adUnit", () => {
    const pbjs = makeStubPbjs();
    const orchestrator = new AuctionOrchestrator(pbjs);
    enqueueVideoSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_lin2", {
      mediaTypes: {
        video: { context: "outstream", linearity: 2, playerSize: [640, 480], mimes: ["video/mp4"] },
      },
      bidders: [{ bidder: "pubmatic", params: { publisherId: "x", adSlot: "y" } }],
    });
    jest.runAllTimers();

    expect(getEmittedVideo(pbjs).linearity).toBe(2);
  });

  it("coerces invalid linearity to 1 without throwing", () => {
    const pbjs = makeStubPbjs();
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();

    expect(() =>
      enqueueVideoSlot(registry, orchestrator, pbjs, "slot_lin_bad", {
        mediaTypes: {
          video: {
            context: "instream",
            linearity: 99,
            playerSize: [640, 480],
            mimes: ["video/mp4"],
          },
        },
        bidders: [{ bidder: "pubmatic", params: { publisherId: "x", adSlot: "y" } }],
      }),
    ).not.toThrow();
    jest.runAllTimers();

    expect(getEmittedVideo(pbjs).linearity).toBe(1);
  });

  it("defaults linearity to 1 when absent", () => {
    const pbjs = makeStubPbjs();
    const orchestrator = new AuctionOrchestrator(pbjs);
    enqueueVideoSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_lin_absent", {
      mediaTypes: {
        video: { context: "instream", playerSize: [640, 480], mimes: ["video/mp4"] },
      },
      bidders: [{ bidder: "pubmatic", params: { publisherId: "x", adSlot: "y" } }],
    });
    jest.runAllTimers();

    expect(getEmittedVideo(pbjs).linearity).toBe(1);
  });

  it("coerces non-numeric linearity (string) to 1 without throwing", () => {
    const pbjs = makeStubPbjs();
    const orchestrator = new AuctionOrchestrator(pbjs);
    const registry = new ConfigRegistry();

    expect(() =>
      enqueueVideoSlot(registry, orchestrator, pbjs, "slot_lin_str", {
        mediaTypes: {
          video: {
            context: "instream",
            linearity: "1",
            playerSize: [640, 480],
            mimes: ["video/mp4"],
          },
        },
        bidders: [{ bidder: "pubmatic", params: { publisherId: "x", adSlot: "y" } }],
      }),
    ).not.toThrow();
    jest.runAllTimers();

    expect(getEmittedVideo(pbjs).linearity).toBe(1);
  });
});
