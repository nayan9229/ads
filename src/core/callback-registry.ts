import { ErrorRegistry } from "./error-registry";

export type LifecycleEvent =
  | "init"
  | "ready"
  | "bidRequested"
  | "bidResponse"
  | "auctionStart"
  | "auctionEnd"
  | "adRenderSuccess"
  | "adRenderFail"
  | "timeout"
  | "noFill"
  | "viewable"
  | "refresh"
  | "refresh_cap_reached"
  | "environment_detected"
  | "bidder_config"
  | "adComplete"
  | "error"
  | "destroy";

export type Unsubscribe = () => void;

type Handler = (payload: unknown) => void;

export class CallbackRegistry {
  private readonly handlers = new Map<LifecycleEvent, Set<Handler>>();

  constructor(private readonly errors: ErrorRegistry) {}

  on(event: LifecycleEvent, fn: Handler): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }

  emit(event: LifecycleEvent, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      this.errors.wrap(fn)(payload);
    }
  }
}
