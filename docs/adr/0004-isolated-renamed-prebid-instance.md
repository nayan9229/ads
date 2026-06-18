# Always self-load an isolated, renamed-global Prebid; never reuse the host's `window.pbjs`

> **Status: partially superseded by [ADR-0005](0005-vendored-inlined-prebid-bundle.md).** The isolation decision (own renamed-global instance, never reuse host `window.pbjs`, sync-suppression) still holds. The _delivery_ mechanism described below — a separate external pinned + SRI script loaded at runtime — is replaced by vendoring + inlining the build into the shipped bundle. Read this for the _why isolation_; read ADR-0005 for _how it ships_.

## Context

The SDK reported a field bug: on a client page that **already runs Prebid.js**, auctions failed with "PubMatic and Magnite adapters cannot be found." With **no** host Prebid present, the SDK loaded its own Prebid and everything worked.

Root cause is in the dependency loader and was a deliberate, documented decision (D45):

- `DependencyLoader.loadPrebid` (`src/core/dependency-loader.ts:191`) reuses any `window.pbjs` that merely has a `que` array, and only emits a one-time `console.warn` ("confirm the host page's Prebid build includes the bidders + modules this SDK expects"). It warns, then does nothing.
- Prebid bidder adapters are **compile-time bundled**. A host's custom Prebid build bundles only the adapters that host configured. PubMatic (`pubmatic`) and Magnite (`rubicon`) — both in the SDK's bidder rules (`src/core/bidder-param-resolver.ts`) and the v1 bidder set (D8) — are absent from a typical host build, so Prebid drops those bids at `requestBids`.
- Standalone worked only by accident: the SDK's default `prebidSrc` (`index.ts:14`, `prebid.js@latest/dist/not-for-prod/prebid.js`, D44) is a full build that bundles every adapter.

A key constraint shaped the fix: **Prebid exposes no public runtime adapter-registration API.** Each adapter registers itself at bundle-eval time via the internal `registerBidder()` from `bidderFactory`, closing over _that build's_ `adapterManager`. `window.pbjs` exposes no `registerBidder`/`registerBidAdapter`; `pbjs.aliasBidder` only aliases an already-installed adapter. So "inject the missing adapters into the host's Prebid at runtime" is not achievable — the only correct way to get PubMatic/Magnite code running with a guaranteed adapter set is a **separate Prebid instance the SDK controls**.

A second fact made isolation tractable: the SDK never operates through the `window.pbjs` global. It holds a private handle (`pbjsCached`, `bootstrap.ts:190`) and injects it into the orchestrator and renderers. All auction/render/setConfig calls go through that reference.

## Decision

**The SDK always loads its own pinned, renamed-global Prebid instance and drives auctions through its private handle. It never reuses — or writes — the host page's `window.pbjs`.**

1. **Renamed global.** Build Prebid with a custom global var name (set `globalVarName: "_adwPbjs"` in Prebid's `package.json` — Prebid 9 has no `--prebidGlobalVarName` CLI flag — then `gulp build`), v1 bidder set + modules baked in. On load the bundle writes `window._adwPbjs`, never `window.pbjs`. `loadPrebid` reads the configurable global name back (not `window.pbjs`) and drops the host-`pbjs` reuse branch.
2. **Pinned + self-hosted + SRI.** Pin an exact Prebid version (no `@latest`), host on the SDK's release CDN, publish an SRI hash (reuse `scripts/compute-sri.mjs`). Version tracked in CHANGELOG/release. Revises D7 (was hosted custom-build service) and D44 (was `@latest`).
3. **Sync isolation.** The global rename isolates the JS API surface but **not** network/cookie side effects — with two live cores, both would fire `userSync`/cookie-syncs/CMP round-trips. So when a host `window.pbjs` is detected at `getPbjs()` config time, the SDK's instance sets `userSync.syncEnabled:false` and defers identity to the host. Detection is best-effort off the synchronous host `pbjs` stub (`que` array), which the standard Prebid snippet creates at page top before the SDK's async bundle resolves.
4. **Prebid-only carve-out of D45.** IMA (`window.google.ima`) and identity-resolver (`window.OpenRTBIdentityResolver`) reuse is unchanged — those are genuinely shared single-instance globals where double-load wastes bytes or (IMA) can break a player. Only Prebid stops being reused.

## Considered alternatives

- **Inject the missing adapters into the host's `window.pbjs`** (the initial instinct) — rejected: impossible via public API. Adapters are compile-time-bundled and register against their own build's `adapterManager`; `pbjs` exposes no runtime `registerBidder`, and `aliasBidder` needs the base adapter already installed.
- **Drop missing bidders, run only those present** (per-slot graceful degradation via `pbjs.installedModules`) — rejected: silently under-monetizes; PubMatic/Magnite are core v1 demand, and a host build rarely includes them, so this degrades to "run almost nothing."
- **Hard-fail the auction when an adapter is absent** — rejected: surfaces the misconfig but leaves the publisher with no working auction; the SDK can fix this itself by owning its Prebid.
- **Reuse host `window.pbjs` and tell the publisher to rebuild their Prebid URL** (status quo D45 + docs) — rejected: that's the current behavior that produced the bug; relies on every host matching the SDK's bidder set, which they don't control or know.
- **Load own full build under the shared `window.pbjs` global (let Prebid merge `que`)** — rejected: two cores fighting one global _is_ impacting the host, contradicting the zero-host-impact requirement.

## Consequences

- The SDK now owns a Prebid **build + hosting pipeline** (pin, rename, SRI, release) — a structural, hard-to-reverse commitment that replaces the hosted-custom-build-URL model (D7).
- **Always ships a full Prebid**, even on pages that already have one — extra bytes against the 30 KB SDK cap (note: the Prebid bundle is loaded separately, not part of the 30 KB SDK core).
- **Two live Prebid cores** on host pages. Render stays clean (Prebid-only, no GAM — D9). The SDK's syncs are suppressed when a host Prebid is present, which may cost match rate for SDK-only bidders (PubMatic/Magnite) when the host's syncs don't cover them — accepted trade-off vs. duplicate sync pixels + a second CMP call.
- Sync-suppression detection is best-effort: a fully-async host Prebid with no early `pbjs` stub is a small false-negative window where the SDK runs its own syncs.
- Reverses D45 for Prebid; amends D7 and D44. `pbjs.installedModules` is no longer needed for adapter detection (the SDK guarantees its own set), though it remains a useful diagnostic.
