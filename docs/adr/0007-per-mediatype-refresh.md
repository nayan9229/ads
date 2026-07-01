# Move refresh config from slot-root to per-mediaType

> Relocates the `refresh` field introduced in D17 and placed at slot root by D42. The refresh mechanics (viewability-gated start, min-interval floor, session cap, tab/viewport pausing) are unchanged; only *where the config lives* and *which config a given impression uses* change.

## Context

`refresh` was a slot-level field (`ValidatedSlotConfig.refresh`): one interval per slot, applied regardless of which mediaType rendered. But a mixed slot (banner + video) renders **one** winning creative at a time — the highest CPM across formats — and the right refresh cadence differs by format: a banner can rotate every 10 s, while an instream video should not be interrupted until well after it finishes. A single slot-level interval cannot express that.

## Decision

**Move `refresh` into each `mediaTypes.<format>` and drive the cadence from the mediaType that actually rendered, re-evaluated every impression.**

- **Schema.** `refresh?: RefreshConfig` moves onto `BannerMediaType`, `VideoMediaType`, and `NativeMediaType`; it is removed from `ValidatedSlotConfig`. Validation is unchanged (`intervalSec` ≥ `minRefreshIntervalSec` floor, default 30 s; optional `sessionCap` ≥ 1) but runs per-mediaType, with error fields like `mediaTypes.banner.refresh.intervalSec`.
- **Rendered mediaType wins.** `SlotLifecycle.onAuctionWon` records the winning bid's mediaType. Both the refresh scheduler and the adComplete gate read `mediaTypes[renderedMediaType].refresh`. Banner rendered → banner's refresh; video rendered → video's refresh.
- **Re-evaluated each impression.** A refreshed auction can hand a *different* format the win, so the cadence is retuned per impression. The scheduler gained `updateInterval(ms)`: it resets the countdown to the new interval measured from now (a fresh creative just rendered) while **preserving the session-cap fire count** — a format switch changes the rate but never resets the cap.
- **No-refresh format pauses the slot.** If the rendered mediaType has no `refresh`, a running scheduler is cancelled: the slot does not refresh while that creative is shown. (If it never yields to a refresh-enabled format again, it stays put — acceptable, since with no refresh nothing re-auctions.)

## Considered alternatives

- **Keep `refresh` at slot root (status quo, D42).** Rejected: cannot give banner and video different cadences in one slot, which is the whole motivation.
- **Min interval across all mediaTypes' refresh.** Rejected: a single fixed cadence ignores what's on screen — it would interrupt a playing video on the banner's short interval.
- **Only refresh when the rendered mediaType defines refresh, no dynamic retune.** Simpler, but a slot that switches banner↔video across refreshes would keep the first impression's interval forever. Rejected in favour of per-impression re-evaluation.

## Consequences

- A mixed-format slot can change its refresh rate between impressions, and can go dormant if a no-refresh format wins. This is intended: cadence is a property of the creative currently displayed, not of the slot.
- `RefreshScheduler.intervalMs` is now mutable (via `updateInterval`); `start`/`scheduleNext`/`clearTimer` read the mutable field. Session-cap semantics are unchanged.
- Publisher migration: move `refresh: {…}` from the slot object into `mediaTypes.<format>.refresh`. There is no slot-root fallback — a stray slot-root `refresh` is silently ignored (it is not a recognised slot field).
- `adComplete` for banner now keys its "wait for last refresh cycle" behaviour off the rendered mediaType's refresh (D58 updated).
