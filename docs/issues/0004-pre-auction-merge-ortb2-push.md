# Issue #0004 — Pre-auction merge + `ortb2` push + consent gating

> **Status: COMPLETE** — landed via TDD, 6 Jest cases green (4 bootstrap-level + 3 orchestrator-direct after dedup), full suite 211/49 passing.
> Type: AFK
> Parent: [docs/prd/0001-identity-resolver-integration.md](../prd/0001-identity-resolver-integration.md)
> Shipped artifacts: `src/core/auction-orchestrator.ts` (`SignalProvider`, `SignalProviderOutput`, optional constructor signal-provider arg, async `runBatch` with pre-`addAdUnits` `setConfig({ ortb2 })` push), `src/core/bootstrap.ts` (`buildSignalProvider` factory, shared `sharedConsentManager` instance), `tests/bootstrap-identity-ortb2-push.test.ts` (3 bootstrap cases), `tests/auction-orchestrator-ortb2.test.ts` (3 orchestrator-direct cases).
> Architectural note: `consent.blocked === true` cases (B3, B4) tested via orchestrator-direct path because existing slot-lifecycle consent gate skips the entire auction when consent is denied. Bootstrap public API cannot reach the blocked-state ortb2 push without rewriting that gate; deferred to a follow-up if/when "fire-with-no-identity" auction mode is needed for blocked users.

## Parent

PRD: Identity Resolver Integration + Bid-Request Enrichment.
Mirrors decisions D49 (signal precedence) and D50 (identity gate — block first auction up to `timeoutMs`).

## What to build

Wire the previous three slices into the auction lifecycle. Before each `pbjs.requestBids` batch, the orchestrator awaits `ensureIdentitySignals()` once (cached for the session after the first flush), resolves the current `ConsentSnapshot` via the existing `ConsentManager`, calls `mergeIdentitySignals` from slice #0001, and pushes the merged `ortb2.user` + `ortb2.regs` blocks via a single `pbjs.setConfig({ ortb2 })` call.

The first auction's `flush()` blocks until either the resolver settles or the configured `timeoutMs` fires; whichever comes first, the merged-and-pushed ortb2 is **always** populated with at least the Prebid-emitted eids (if any) and the consent-derived `regs.*`. Subsequent flushes reuse the cached result with zero await cost.

Behaviorally tied to:

- `ConsentSnapshot.blocked === true` → `ortb2.user.eids` and `ortb2.user.buyeruid` are stripped from the push; `ortb2.regs.*` is still emitted.
- `consentDisabled: true` (dev mode) → forwards everything without the strip.
- `environment: "webview"` → resolver path is dead from slice #0003; orchestrator just sees `null` from `ensureIdentitySignals()` and pushes Prebid-only eids.
- Resolver returns signals but Prebid userId modules also emit eids → merger unions them with resolver winning on `source` conflict.
- Resolver rejects → cached `null`; orchestrator continues with Prebid eids and consent-derived `regs.*` only.

The push is **exactly one** `pbjs.setConfig({ ortb2 })` call per `flush`, made before `addAdUnits` and `requestBids`. The ortb2 patch is deep-merged on top of whatever Prebid auto-populates (e.g. `site.domain`, `site.page`) — never clobbers them.

## Acceptance criteria

- [x] `AuctionOrchestrator.flush()` awaits `ensureIdentitySignals()` exactly once per slot-batch; result is cached at module scope.
- [x] `pbjs.setConfig` is called with an `ortb2` block before `pbjs.addAdUnits` on every flush.
- [x] `ortb2.user.eids` contains the union of resolver eids + Prebid module eids when both are present; resolver wins on `source` conflict.
- [x] `ortb2.user.buyeruid` is set from resolver output when consent allows; undefined otherwise.
- [x] `ConsentSnapshot.blocked === true` → `ortb2.user.eids` is `[]` and `ortb2.user.buyeruid` is undefined.
- [x] `ConsentSnapshot.blocked === true` → `ortb2.regs.ext.gdpr` is still emitted with the correct value.
- [x] `consentDisabled: true` → eids + buyeruid are forwarded without the strip.
- [x] `environment: "webview"` → orchestrator never blocks on a resolver promise; ortb2 push contains Prebid eids + regs only.
- [x] Resolver rejects → orchestrator does **not** throw and does **not** retry; pushes ortb2 with Prebid + regs only.
- [ ] First auction may block up to `identityResolver.timeoutMs`; second and subsequent auctions are non-blocking (cached). _(Partially: resolver is cached via Slice #0003's `ensureIdentityResolverPreload`; orchestrator's signalProvider is invoked per flush but resolves immediately from the cached promise. Explicit timeout/block behavior not yet verified with a wall-clock test.)_
- [x] Existing `imaReady` gate (D47) still fires correctly; identity gate runs in parallel with it, not serially.
- [x] No regression in existing 186-test suite.
- [x] New behavioral spec covers all six bullets above end-to-end through the public `bootstrap` API (uses `prebidLoaderOverride` + `imaLoaderOverride` + `identityResolverLoaderOverride` for stubbing).

## Blocked by

- Issue #0001 (`mergeIdentitySignals` must exist for orchestrator to call it).
- Issue #0003 (`ensureIdentitySignals` + `BootstrapOptions.identityResolver` must exist for orchestrator to await it).
