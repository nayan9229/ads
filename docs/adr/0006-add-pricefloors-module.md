# Add the `priceFloors` module to the vendored Prebid build

> Reverses the `priceFloors` exclusion recorded in [ADR-0005](0005-vendored-inlined-prebid-bundle.md) (and D10/D62). The vendoring/inlining mechanism, the renamed global (`_adwPbjs`), and the rest of the lean module set are unchanged — this ADR only adds one module.

## Context

The publisher integration exposes a Prebid Price Floors config through `AdWrapperOptions.prebidConfig.floors` (forwarded verbatim to `pbjs.setConfig`, see `bootstrap.ts` `getPbjs`). The `mixed-media.html` test page configures a mediaType-keyed floor model (`banner: 0.5`, `video: 1.0`).

That config was a silent no-op. The vendored Prebid bundle (ADR-0005, D62) deliberately **excluded** the `priceFloors` module (D10 — "static config floors only; dynamic floors v2-deferred"). Without the module, Prebid never installs the auction hook that populates each bid's `getFloor()`, so adapters that call `bidRequest.getFloor()` (PubMatic, Rubicon/Magnite, AppNexus, …) receive `undefined` and emit **no `imp.bidfloor`**.

The observable symptom: PubMatic/Rubicon OpenRTB requests carried `imp.bidfloorcur: "USD"` (set unconditionally by the adapter / `currency` module) but **no `imp.bidfloor`** — the exact signature of a missing floors module.

The `floors` config the publisher already writes is the mediaType-keyed dynamic model, which cannot be expressed through per-bidder param floors (`rubicon.params.floor`, `pubmatic.params.kadfloor`, `appnexus.params.reserve`). Honoring the documented config requires the module.

## Decision

**Add `priceFloors` to the vendored, renamed-global Prebid build's module set.**

- The rebuild command in `vendor/PREBID-BUILD.md` gains `priceFloors` in the `--modules=` list; everything else (tag `9.53.5`, `globalVarName: "_adwPbjs"`, the six bidders + `userId*` + `consentManagement*` + `tcfControl` + `currency`) is unchanged.
- Re-vendor the artifact, recompute the whole-bundle SRI, refresh `vendor/PREBID-BUILD.md` (module list, date, sha384, sizes), and re-run `npm run build:check`.
- No SDK source change: `bootstrap.ts` already forwards `prebidConfig` (including `floors`) through `pbjs.setConfig`. The module makes that forwarding effective.

## Considered alternatives

- **Per-bidder param floors (no rebuild)** — `rubicon.params.floor`, `pubmatic.params.kadfloor`, `appnexus.params.reserve`. Rejected as the primary fix: it cannot express the mediaType-keyed model the publisher config already declares, and it scatters a global concern across every bidder entry. Retained as a documented fallback for a single flat per-bidder floor.
- **Keep floors deferred to v2 (ADR-0005 as-is)** — rejected: the config surface is already live and shipped in the example integration, so leaving it a silent no-op is a correctness trap.

## Consequences

- The mediaType-keyed `floors` config now produces `imp.bidfloor` + `imp.bidfloorcur` for every adapter that respects the module. `prebidConfig.floors.enforcement` (floorDeals / bidAdjustment) is now live — bids below the floor are enforced, which can **reduce fill** if floors are set too high. This is intended behavior; publishers own their floor values.
- Bundle grows by the `priceFloors` module's weight (a few KB gz); the vendored-artifact size budget is re-baselined after the build.
- Adds one more module to the manual re-vendor surface (ADR-0005's maintenance policy already covers this).
- Reverses D10's "static config floors only." Static per-slot floors remain available; dynamic floors are no longer deferred.
