# Attach an inert `adUnit.renderer` stub to every video adUnit — never a real render path

## Context

An SSP-integration bug report (`nayan-sdk-outstream-renderer-request.md`) found that outstream video bids were being dropped for most bidders: Prebid.js requires either a bidder-specific escape hatch (PubMatic's `params.outstreamAU`) or an ad-unit-level `renderer` object to be present at auction time, or it strips `mediaTypes.video` before `requestBids` and the bidder falls back to banner-only. The SDK's adUnit builder (`auction-orchestrator.ts:97-146`) never forwarded any `renderer` field, so only PubMatic (via our existing `outstreamAU` param injection) could serve outstream video — Rubicon and every other v1 bidder (D8) could not.

We confirmed two things by grepping the vendored Prebid bundle (`vendor/prebid-adw-9.53.5.js`, D62):

1. The renderer-presence check is a Prebid-core-level gate (not just a PubMatic adapter quirk) — it inspects `adUnit.renderer` / `mediaTypes.video.renderer` / bid-level `renderer` generically for any outstream context.
2. `.renderer.render(` has **zero call sites** anywhere in the bundle. Prebid never invokes a renderer's `render()` itself; that only happens if publisher code calls `pbjs.renderAd()` or `bid.renderer.render(bid)` explicitly — neither of which this SDK does.

This SDK already renders 100% of video bids itself: `SlotLifecycle.onAuctionWon` (`slot-lifecycle.ts:315-335`) reads `bid.vastUrl`/`bid.vastXml` directly off the winning bid and drives its own IMA-based `VideoRenderer` (`video-renderer.ts`), independent of which bidder won — this is CONTEXT D41 ("SDK's `VideoRenderer` renders all video bids in its own outstream-style player") and D1 (IMA exclusively, no other outstream renderer library). So a `renderer.render()` callback installed on the adUnit would never execute in this codebase; its only job is to make Prebid's presence check pass.

## Decision

**Attach a single, module-level, inert stub object as `adUnit.renderer` to every adUnit that declares `mediaTypes.video` — unconditionally, regardless of declared `context` (D41: instream-declared video still renders as outstream) — and never let its `render()` fire.**

- Lives in a new dedicated file, `src/core/prebid-outstream-stub.ts` — deliberately _not_ under `src/renderers/`, since it is not an instance of the SDK's own `.render(args)` renderer abstraction (no `CallbackRegistry` wiring, no DOM work); it exists solely to satisfy a Prebid-core auction-time check.
- `renderer.render` is a no-op function. `url` is omitted — it is never fetched, since Prebid only loads a renderer's `url` from inside `Renderer.render()`, which this SDK never calls.
- One shared constant, reused across every adUnit/slot in a batch. `Renderer.install()` (invoked internally by Prebid core per adUnit) only reads from the supplied object at install time and constructs a new instance from it — it does not mutate the source object — so sharing one instance across adUnits/auctions is safe.
- Wired into `auction-orchestrator.ts`'s adUnit-builder (alongside `code`/`mediaTypes`/`bids`), not nested under `mediaTypes.video.renderer` — matches Prebid's own canonical (top-level) placement.
- No config surface: this is not exposed as an `AdWrapperConfig[slotId]` field (rejects the feature request's "Option A" — forward a config-supplied renderer). Every SSP's outstream demand is unblocked identically; there is nothing for a publisher to misconfigure, and no external renderer script (e.g. AppNexus's `ANOutstreamVideo.js`, as referenced in the original request) is ever loaded.

## Considered alternatives

- **Forward a publisher-supplied `renderer` from slot config (request's Option A)** — rejected. Since the object's `render()` never executes, exposing it as configurable adds a config-surface + validation burden for zero behavioral benefit; every real outstream renderer path stays SDK-owned regardless of what a publisher would supply.
- **Ship the reference renderer verbatim (AppNexus's `ANOutstreamVideo.js`)** — rejected. Loading a third-party CDN script that is provably never invoked (zero `.renderer.render(` call sites in the vendored bundle) would add an unused external dependency and CSP surface for no reason, and would contradict D1 (IMA-exclusive outstream) if it were ever accidentally triggered.
- **Do nothing / rely on PubMatic's `outstreamAU` workaround only** — rejected (status quo); this is exactly the limitation the bug report flagged: PubMatic-only, and requires a provisioned per-publisher AU to serve real (non-test) ads.

## Consequences

- The stub is intentionally dead-looking code: nothing in this SDK ever calls its `render()`. A future contributor may see it as unused and be tempted to delete it — doing so silently reverts every non-PubMatic bidder to banner-only for outstream slots, with no compile-time signal (only the auction-orchestrator unit test and the real-Prebid integration test catch it). This ADR exists specifically so that risk is documented.
- No new `AdWrapperConfig` field, no new validation in `config-registry.ts`.
- Does not address the `plcmt`/`maxduration` OpenRTB video fields also missing from `VideoMediaType` (`config-registry.ts:39-52`) — found incidentally while reading the same code path but tracked as a separate follow-up, unrelated root cause (schema omission vs. forwarding omission).
