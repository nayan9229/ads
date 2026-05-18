import { ValidatedSlotConfig } from "./config-registry";
import { SlotLifecycle } from "./slot-lifecycle";
import { resolveSizesForViewport } from "./resolve-sizes";
import {
  mergeIdentitySignals,
  ResolverSignals,
  ConsentSnapshot,
  Ortb2Patch,
  Eid,
} from "./identity-signal-merger";

export interface PrebidAuctionApi {
  addAdUnits(adUnits: ReadonlyArray<unknown>): void;
  removeAdUnit?(adUnitCode: string): void;
  setConfig?(config: Record<string, unknown>): void;
  requestBids(args: { adUnitCodes: string[]; bidsBackHandler: (bids: unknown) => void }): void;
  getHighestCpmBids(adUnitCode: string): ReadonlyArray<{
    adId: string;
    width: number;
    height: number;
  }>;
}

export interface SignalProviderOutput {
  readonly resolverSignals: ResolverSignals | null;
  readonly prebidEids: ReadonlyArray<Eid>;
  readonly consent: ConsentSnapshot;
}

export type SignalProvider = () => Promise<SignalProviderOutput>;

export interface PendingSlot {
  readonly slotId: string;
  readonly config: ValidatedSlotConfig;
  readonly lifecycle: SlotLifecycle;
}

const DEBOUNCE_MS = 50;

export class AuctionOrchestrator {
  private queue: PendingSlot[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly pbjs: PrebidAuctionApi,
    private readonly signalProvider?: SignalProvider,
  ) {}

  enqueue(slot: PendingSlot): void {
    this.queue.push(slot);
    if (this.timer !== null) return;
    this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
  }

  flushNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  private flush(): void {
    this.timer = null;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];

    if (this.signalProvider) {
      void this.signalProvider().then((signals) => this.runBatch(batch, signals));
    } else {
      this.runBatch(batch, null);
    }
  }

  private runBatch(batch: PendingSlot[], signals: SignalProviderOutput | null): void {
    if (signals && typeof this.pbjs.setConfig === "function") {
      const patch: Ortb2Patch = mergeIdentitySignals({
        resolver: signals.resolverSignals,
        prebidEids: signals.prebidEids,
        consent: signals.consent,
      });
      this.pbjs.setConfig({ ortb2: patch });
    }

    const adUnits = batch.map((s) => {
      const bids = s.config.bidders.map((b) => ({
        bidder: b.bidder,
        params: { ...b.params },
      }));
      const mediaTypes: Record<string, unknown> = {};
      const effectiveMt = s.lifecycle.getEffectiveMediaTypes();

      if (effectiveMt.banner) {
        const innerWidth =
          typeof window !== "undefined" && typeof window.innerWidth === "number"
            ? window.innerWidth
            : 0;
        const resolved = resolveSizesForViewport(effectiveMt.banner.sizes, innerWidth);
        s.lifecycle.setResolvedSizes(resolved);
        mediaTypes["banner"] = { sizes: resolved.map((sz) => [...sz]) };
      }

      if (effectiveMt.native) {
        mediaTypes["native"] = {};
      }

      if (effectiveMt.video) {
        const v = effectiveMt.video;
        mediaTypes["video"] = {
          context: v.context ?? "outstream",
          ...(v.playerSize ? { playerSize: [...v.playerSize] } : { playerSize: [640, 360] }),
          ...(v.mimes ? { mimes: [...v.mimes] } : {}),
          ...(v.protocols ? { protocols: [...v.protocols] } : {}),
          ...(v.api ? { api: [...v.api] } : {}),
          ...(v.playbackmethod ? { playbackmethod: [...v.playbackmethod] } : {}),
          ...(typeof v.skip === "number" ? { skip: v.skip } : {}),
          ...(v.delivery ? { delivery: [...v.delivery] } : {}),
          ...(typeof v.linearity === "number" ? { linearity: v.linearity } : {}),
        };
      }

      return {
        code: s.slotId,
        mediaTypes,
        bids,
      };
    });
    if (typeof this.pbjs.removeAdUnit === "function") {
      for (const s of batch) this.pbjs.removeAdUnit(s.slotId);
    }
    this.pbjs.addAdUnits(adUnits);
    for (const s of batch) s.lifecycle.enterBidding();

    this.pbjs.requestBids({
      adUnitCodes: batch.map((s) => s.slotId),
      bidsBackHandler: () => {
        for (const s of batch) {
          const winners = this.pbjs.getHighestCpmBids(s.slotId);
          const top = winners[0];
          if (top) {
            s.lifecycle.onAuctionWon(top);
          } else {
            s.lifecycle.onAuctionNoFill();
          }
        }
      },
    });
  }
}
