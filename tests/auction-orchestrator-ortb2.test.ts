import {
  AuctionOrchestrator,
  PrebidAuctionApi,
  SignalProvider,
} from "../src/core/auction-orchestrator";
import { SlotLifecycle } from "../src/core/slot-lifecycle";
import { ConfigRegistry } from "../src/core/config-registry";
import { CallbackRegistry } from "../src/core/callback-registry";
import { ErrorRegistry } from "../src/core/error-registry";
import { BannerRenderer } from "../src/renderers/banner-renderer";
import { ConsentSnapshot, ResolverSignals } from "../src/core/identity-signal-merger";

function makeStubPbjs(): PrebidAuctionApi & {
  addAdUnits: jest.Mock;
  setConfig: jest.Mock;
  requestBids: jest.Mock;
  getHighestCpmBids: jest.Mock;
  renderAd: jest.Mock;
  removeAdUnit: jest.Mock;
} {
  return {
    setConfig: jest.fn(),
    addAdUnits: jest.fn(),
    removeAdUnit: jest.fn(),
    requestBids: jest.fn(({ bidsBackHandler }) => bidsBackHandler()),
    getHighestCpmBids: jest.fn(() => []),
    renderAd: jest.fn(),
  };
}

function enqueueBannerSlot(
  registry: ConfigRegistry,
  orchestrator: AuctionOrchestrator,
  pbjs: PrebidAuctionApi & { renderAd: (doc: Document, adId: string) => void },
  slotId: string,
): void {
  const config = registry.register(slotId, {
    mediaTypes: { banner: { sizes: [[300, 250]] } },
    bidders: [{ bidder: "pubmatic", params: {} }],
  });
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

function findOrtb2(pbjs: { setConfig: jest.Mock }): { user?: any; regs?: any } | undefined {
  const calls = pbjs.setConfig.mock.calls.map((c) => c[0] as Record<string, unknown>);
  const ortb2Call = calls.find((c) => "ortb2" in c);
  return ortb2Call?.ortb2 as { user?: any; regs?: any } | undefined;
}

async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("AuctionOrchestrator — pre-auction ortb2 push with consent gating", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("invokes signalProvider once per flush — multi-batch enqueue still pushes ortb2 each batch from a memoized identity", async () => {
    const pbjs = makeStubPbjs();
    const signalProvider = jest.fn<
      Promise<{ resolverSignals: ResolverSignals | null; prebidEids: never[]; consent: ConsentSnapshot }>,
      []
    >().mockResolvedValue({
      resolverSignals: { eids: [{ source: "id5-sync.com", uids: [{ id: "id5-abc" }] }] },
      prebidEids: [],
      consent: { blocked: false, tcfApplies: false },
    });
    const orchestrator = new AuctionOrchestrator(pbjs, signalProvider as unknown as SignalProvider);

    // batch 1
    enqueueBannerSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_a");
    jest.runAllTimers();
    await drainMicrotasks();
    // batch 2 (separate flush)
    enqueueBannerSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_b");
    jest.runAllTimers();
    await drainMicrotasks();

    expect(pbjs.addAdUnits).toHaveBeenCalledTimes(2);
    // Signal provider is invoked per flush (call site is per-batch). Memoization of the
    // resolver itself lives one level up in `ensureIdentityResolverPreload` (Slice #0003).
    expect(signalProvider).toHaveBeenCalledTimes(2);
    const setConfigCalls = pbjs.setConfig.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const ortb2Pushes = setConfigCalls.filter((c) => "ortb2" in c);
    expect(ortb2Pushes).toHaveLength(2);
  });

  it("still emits regs.ext.gdpr when consent.blocked === true", async () => {
    const pbjs = makeStubPbjs();
    const blockedConsent: ConsentSnapshot = { blocked: true, tcfApplies: true };
    const signalProvider: SignalProvider = () =>
      Promise.resolve({ resolverSignals: null, prebidEids: [], consent: blockedConsent });
    const orchestrator = new AuctionOrchestrator(pbjs, signalProvider);

    enqueueBannerSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_regs");
    jest.runAllTimers();
    await drainMicrotasks();

    const ortb2 = findOrtb2(pbjs);
    expect(ortb2).toBeDefined();
    expect(ortb2!.regs?.ext?.gdpr).toBe(1);
  });

  it("strips user.eids and user.buyeruid when consent.blocked === true (via signal provider)", async () => {
    const pbjs = makeStubPbjs();
    const blockedConsent: ConsentSnapshot = { blocked: true, tcfApplies: true };
    const resolverSignals: ResolverSignals = {
      eids: [{ source: "id5-sync.com", uids: [{ id: "id5-abc" }] }],
      buyeruid: "should-be-stripped",
    };
    const signalProvider: SignalProvider = () =>
      Promise.resolve({ resolverSignals, prebidEids: [], consent: blockedConsent });
    const orchestrator = new AuctionOrchestrator(pbjs, signalProvider);

    enqueueBannerSlot(new ConfigRegistry(), orchestrator, pbjs, "slot_blocked");
    jest.runAllTimers();
    await drainMicrotasks();

    const ortb2 = findOrtb2(pbjs);
    expect(ortb2).toBeDefined();
    expect(ortb2!.user?.eids ?? []).toEqual([]);
    expect(ortb2!.user?.buyeruid).toBeUndefined();
  });
});
