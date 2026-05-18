# PRD: Identity Resolver Integration + Bid-Request Enrichment

> Scope: locked via grilling session 2026-05-18. See `docs/adr/0001-identity-resolver-augment.md` for architectural rationale and `CONTEXT.md` D48–D51 for the decision log entries.

## Implementation progress

| Slice | Status | Tests | Suite total |
| --- | --- | --- | --- |
| [#0001 IdentitySignalMerger](../issues/0001-identity-signal-merger.md) | ✅ COMPLETE | 8 | 194 / 45 |
| [#0002 DependencyLoader.loadIdentityResolver](../issues/0002-dependency-loader-identity-resolver.md) | ✅ COMPLETE | 5 | 199 / 46 |
| [#0003 Bootstrap identityResolver config + parallel preload](../issues/0003-bootstrap-identity-resolver-preload.md) | ✅ COMPLETE | 6 | 205 / 47 |
| [#0004 Pre-auction merge + ortb2 push + consent gating](../issues/0004-pre-auction-merge-ortb2-push.md) | ✅ COMPLETE | 6 | 211 / 49 |
| [#0005 schain + ortb2.site passthrough](../issues/0005-schain-and-ortb2-passthrough.md) | ✅ COMPLETE | 7 | 218 / 50 |
| [#0006 Demo + docs finalize](../issues/0006-demo-and-docs-finalize.md) | ✅ COMPLETE | docs+demo | 218 / 50 |

Bundle size after slices 1–5: 10.91 KB gz (cap 30 KB, headroom 19.09 KB).

## Problem Statement

The publisher running `@nayan9229/ads` on a real-traffic page sees very low bid coverage and fill rates against PubMatic + Magnite test inventory. They want to reach a **95% fill-rate target**. The SDK currently emits OpenRTB bid requests without rich identity (`user.eids[]`, `user.buyeruid`), without a verified supply chain (`source.ext.schain`), and without first-party site context (`site.content`, `site.cat`). Each missing signal compounds: SSPs filter out impressions that look anonymous, untrusted, or content-thin before they ever reach DSPs.

The publisher already correctly identified that **identity coverage is one of the biggest levers** and pointed at [`@nayan9229/identity-resolver`](https://github.com/nayan9229/identity-resolver) — a 2.2 kB cookie-jar reader covering 15+ vendor cookies with a four-tier fallback strategy explicitly designed for ≥95% fill.

## Solution

Augment (not replace) the SDK's existing `IdentityResolver` class with a second identity path: dynamically inject the `identity-resolver` runtime, resolve OpenRTB user signals once per page session, deterministically merge the output with Prebid's userId-modules output, and push the result into Prebid's `ortb2` config before each auction. Simultaneously add two narrow first-party-data passthroughs — `schain` and `ortb2.site` — that the publisher can fill from their integration HTML without any SDK schema invention.

From the publisher's perspective, integration is config-only:

```js
window.AdWrapperOptions = {
  identity: { id5PartnerId: 1234 },          // existing — Prebid userId modules path
  identityResolver: { enabled: true },        // NEW — identity-resolver runtime path
  schain: { /* IAB SupplyChain object */ },   // NEW
  ortb2: { site: { /* first-party context */ } }, // NEW
};
```

The runtime is injected automatically with no extra `<script>` tag on the page.

## User Stories

1. As a **publisher**, I want to enable identity-resolver via a single boolean flag, so that I can A/B-test the impact on fill rate without code changes.
2. As a **publisher**, I want the identity-resolver script to inject itself automatically when enabled, so that my integration HTML stays one `<script src=…>` tag.
3. As a **publisher**, I want to keep my existing `identity:` config working unchanged, so that turning on the new path is purely additive.
4. As a **publisher**, I want to override the identity-resolver CDN URL, so that I can pin a specific build behind my own CDN or first-party domain.
5. As a **publisher**, I want a configurable timeout for the identity load, so that I can trade latency for match-rate based on my page's perf budget.
6. As a **publisher with a video-heavy page**, I want identity-resolver and IMA to preload in parallel with Prebid, so that none of these are on the critical path of the first auction.
7. As a **publisher subject to GDPR**, I want the SDK to suppress `user.eids` and `user.buyeruid` when my CMP says consent is denied, so that I stay compliant.
8. As a **publisher subject to GDPR**, I want the SDK to keep forwarding `regs.ext.gdpr` and `user.consent` strings to bidders even when identity is suppressed, so that SSPs see the denial state and behave correctly.
9. As a **publisher in California**, I want `regs.ext.us_privacy` honored the same way as GDPR, so that CCPA opt-outs propagate.
10. As a **publisher running in dev**, I want `consentDisabled: true` to bypass the CMP wait and forward all identity signals, so that I can iterate without configuring a CMP.
11. As a **publisher**, I want a single deterministic `pbjs.setConfig({ ortb2 })` call to land per auction, so that I can predict what bidders see when debugging in DevTools.
12. As a **publisher**, I want my Prebid userId modules (sharedId, ID5, UID2) to keep providing their cookie-refresh + storage hygiene, so that I don't lose IDs that expire mid-session.
13. As a **publisher**, I want identity-resolver's reads of cookies the Prebid modules don't know about (TTD UID1, Criteo, Index Exchange, Xandr, Rubicon, PubMatic, LiveRamp, pubcid, Lotame, Tapad, Adobe ECID, Amplitude, etc.) to land in the bid request as eids, so that more SSPs match my user.
14. As a **publisher**, I want resolver `eids[]` to **win** over Prebid-module `eids[]` when both emit the same `source` URI, so that the richer-cookie path is authoritative.
15. As a **publisher**, I want resolver's `user.buyeruid` to land in `ortb2.user.buyeruid`, so that buyer-side cookie-syncing is short-circuited and match rates improve.
16. As a **publisher**, I want resolver's consent reads (TCF v2 string, US Privacy string, GPC) to be **superseded** by the SDK's `ConsentManager` output, so that my CMP remains the single source of truth.
17. As a **publisher**, I want the resolver to run only **once per page session** (not per slot, not per auction), so that the same eids are reused for every retry, refresh, lazy-load slot.
18. As a **publisher**, I want identity resolution to **block the first auction up to `timeoutMs`** (default 1000 ms), so that the first impression goes out with identity attached.
19. As a **publisher**, I want subsequent auctions after the first to **never block** on identity (cached null reused), so that retry/refresh/lazy paths are zero-overhead.
20. As a **publisher**, I want a `noFill` event and `E_IDENTITY_LOAD_FAIL` error event emitted at most once if the resolver script can't load (ad blocker, network, 404), so that my analytics layer can surface the regression without log spam.
21. As a **publisher whose page has another Prebid wrapper already on it**, I want identity-resolver injection to reuse a pre-existing `window.OpenRTBIdentityResolver` global if found and emit a one-time `console.warn`, so that two wrappers don't fight.
22. As a **publisher**, I want to declare an IAB SupplyChain object (`schain`) globally for all slots, so that SSPs that require schain (TripleLift, Magnite, OpenX) stop filtering my requests.
23. As a **publisher**, I want to pass first-party site context (`site.cat`, `site.content.keywords`, `site.content.language`) through `BootstrapOptions.ortb2.site`, so that contextual demand can target my page without me adding a third runtime.
24. As a **publisher**, I want the `schain` and `ortb2.site` blocks to merge with — not clobber — what Prebid already populates, so that defaults like `site.domain` and `site.page` remain auto-derived.
25. As a **publisher**, I want config validation errors (malformed `schain`, missing `ver` or `complete`, non-string `tiers` entries) to throw a `ConfigError` at bootstrap, so that I learn at integration time rather than at first auction.
26. As a **publisher**, I want the bundle-size cap (30 KB gzipped) preserved, so that v1 SLOs (D27 / time-to-render) hold.
27. As a **publisher in a webview**, I want identity-resolver to be **skipped automatically** when `environment: "webview"` is detected, so that I get the same restriction as Prebid userId modules already follow (CONTEXT D34).
28. As a **publisher**, I want the resolver-injection mechanism to be reusable for future identity providers (LiveRamp ATS, etc.), so that I don't need a code change in the SDK to add a new provider.
29. As a **publisher who never enables identity-resolver**, I want zero bytes of the resolver runtime fetched, so that banner-only sites pay no penalty (mirrors D43 IMA conditional preload).
30. As a **publisher**, I want a `successComment`-free, integrity-controlled identity-resolver CDN URL pinned to a known version, so that I can audit what executes on my page.
31. As a **developer working on the SDK**, I want each new identity-resolver responsibility (script load, signal resolution, merge, push) testable in isolation, so that I can ship the feature under TDD with fast unit tests rather than relying on Playwright.
32. As a **developer**, I want the existing 186 Jest tests to keep passing after the integration, so that I have confidence the new path didn't regress the old one.
33. As a **developer**, I want a regression test that locks the per-mediaType floor + identity merge interaction in one Jest spec, so that future refactors don't silently break the `ortb2` shape.
34. As a **developer reviewing analytics**, I want the SDK's `AnalyticsEmitter` to attach a `tier` field (1–4 per identity-resolver's tier strategy) to every `adRenderSuccess` payload, so that I can attribute CPM lift back to identity coverage.
35. As an **SRE responding to an incident**, I want a single env var or `BootstrapOptions` flag to disable the resolver runtime without redeploy, so that I can roll back identity-side regressions inside an existing release.
36. As a **publisher**, I want the resolver's per-page output exposed on `window.AdWrapper.debug.identity` only when `debug: true`, so that I can inspect what was resolved without re-running it.
37. As a **publisher**, I want the SDK to emit a one-time `environment_detected` payload that lists which identity path is active, so that my logging can correlate user cohorts with identity coverage.
38. As a **bidder onboarding partner**, I want to point at the `imp.bidfloor` AND `user.eids[]` simultaneously in the wire payload during onboarding, so that I can validate both signals in one inspection.

## Implementation Decisions

> Reference numbering matches the grilling Q-numbers and the CONTEXT.md decision log entries D48–D51.

### Module sketch

The integration breaks into five new or modified deep modules, each with a narrow public interface:

- **`DependencyLoader.loadIdentityResolver()`** *(new method on existing module)* — injects the `identity-resolver` UMD script, returns a `Promise<IdentityResolverGlobal>`, mirrors `loadPrebid()` / `loadIMA()`. Detects pre-existing `window.OpenRTBIdentityResolver` and reuses with a one-time `console.warn`. Honors `nonce` for CSP. Timeout-rejects.
- **`IdentityResolverRuntime`** *(new module)* — wraps `window.OpenRTBIdentityResolver`, exposes `resolve()` returning a normalized `IdentitySignals` shape `{ eids, buyeruid, consent, regs }`. Single responsibility: call the library, parse output, swallow errors into a `null` result. Module-level memoized cache (per page session).
- **`IdentitySignalMerger`** *(new module — explicitly deep + testable)* — pure function `merge({ resolverSignals, prebidUserIdsConfig, consentManagerOutput }) → ortb2Patch`. Encodes the precedence rules from D49 verbatim: union-by-source eids with resolver wins, resolver-only buyeruid, CM wins on `regs.*` and `user.consent`, blocked → strip `user.eids` + `user.buyeruid` but keep `regs.*`. Zero side effects.
- **`bootstrap` orchestration** *(modified)* — adds: `BootstrapOptions.identityResolver`, `BootstrapOptions.schain`, `BootstrapOptions.ortb2`. Sniffs config; if `identityResolver.enabled === true`, starts preload in parallel with Prebid (mirrors D43 / `ensureImaPreload` pattern). Wires `ensureIdentitySignals()` memoizer.
- **`AuctionOrchestrator.flush()`** *(modified)* — awaits `ensureIdentitySignals()` once, calls `IdentitySignalMerger.merge`, pushes single `pbjs.setConfig({ ortb2: { user, regs }, schain })` before the existing `addAdUnits` → `requestBids` chain. Subsequent flushes use cached signals.

### Config schema

- `BootstrapOptions.identityResolver: IdentityResolverConfig`:
  - `enabled: boolean` — required when block is present
  - `src?: string` — overrides default `https://cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.0/dist/index.umd.js`
  - `version?: string` — used only when `src` is omitted, to construct a different `@version` pin against the default jsDelivr-GH path
  - `deviceIdCookieName?: string` — default `DEVICE_ID`
  - `tiers?: ReadonlyArray<1 | 2 | 3 | 4>` — default `[1, 2, 3, 4]`
  - `timeoutMs?: number` — default `1000`
- `BootstrapOptions.schain: SupplyChainObject | undefined` — IAB-spec SupplyChainObject. Validated at bootstrap (`ver`, `complete`, `nodes[]` shape). Forwarded verbatim via `pbjs.setConfig({ schain })`.
- `BootstrapOptions.ortb2: Partial<Ortb2Patch>` — narrow passthrough; SDK does NOT introspect. Merged with whatever the SDK / Prebid auto-populate (e.g. `site.domain`, `site.page`). Validated only at the type-shape level (object-or-undefined, no schema check on inner fields — Prebid is the canonical validator).

### Precedence + consent

Hard-coded in `IdentitySignalMerger`:

```ts
// (extracted from grilled Q8 — encoded here as a precedence table)
const merged = {
  user: consent.blocked
    ? { /* eids + buyeruid stripped */ }
    : {
        eids: unionBySource(resolver.eids, prebid.eids, /* preferResolver */),
        buyeruid: resolver.buyeruid,
      },
  regs: {
    ext: {
      gdpr: cm.tcfApplies ? 1 : 0,
      us_privacy: cm.uspString ?? resolver.regs?.ext?.us_privacy,
      // GPC + others follow the same CM-wins-with-resolver-fallback rule
    },
  },
};
```

### Failure mode

- `loadIdentityResolver()` rejects → cache `null`, emit `error` event `code: "E_IDENTITY_LOAD_FAIL"` once at bootstrap (mirrors D46 IMA-fail pattern), proceed anonymous.
- `IdentityResolverRuntime.resolve()` throws → swallowed, cached `null`, no second error event emitted (already counted at load).
- First auction blocks up to `timeoutMs`; cached null thereafter.
- `environment: "webview"` → resolver script never loads (mirrors D34 identity-suppression-in-webview).

### Ordering

- IMA preload + Prebid load + identity-resolver preload all fire in parallel from `bootstrap()`.
- Per-slot lifecycle gate already waits on Prebid (existing) + IMA (D47). Identity gate added to the same `await Promise.all(...)` pattern in `AuctionOrchestrator.flush` so its latency overlaps with the others rather than serializing.

## Testing Decisions

Tests must verify external behavior only:

- Test through the public bootstrap API (`bootstrap({...}).registerScript(scriptEl)`) and assert observable effects (`pbjs.setConfig` mock calls, emitted events, container DOM artifacts). Never inspect private fields, never poke at `imaReadyPromise` / `identityReadyPromise` / `pbjsCached` internals.
- Stub the network boundary at the loader layer via the existing `imaLoaderOverride` + new `identityResolverLoaderOverride` injection points. Do NOT stub `document.createElement("script")`.
- Use the existing `installIntersectionObserverStub` + fake timers patterns from `tests/bootstrap-ima-preload.test.ts` (Q4 of last week's grill) as the canonical shape.

### Modules to cover

- **`IdentitySignalMerger`** — pure-function unit suite (highest value, lowest setup cost). Each row of the precedence table = one test. Edge cases: empty resolver output, empty Prebid eids, blocked consent, conflicting `source` URI, missing `regs.ext` block on resolver side.
- **`DependencyLoader.loadIdentityResolver`** — reuse the `tests/dependency-loader-reuse.test.ts` pattern (Q5 of last week's grill): pre-existing global → reuse + warn, no global → inject + resolve, timeout → reject with `WrapperError`.
- **`bootstrap` integration** — new spec `tests/bootstrap-identity-resolver.test.ts`. Mirror `tests/bootstrap-ima-preload.test.ts` (D43 sniff) and `tests/bootstrap-ima-gate.test.ts` (D46/D47 per-slot gate). Cases:
  - `identityResolver.enabled === false` → loader never invoked
  - `identityResolver.enabled === true` → loader invoked once; resolved signals reach `pbjs.setConfig({ ortb2: { user: { eids } } })` exactly once before first `addAdUnits`
  - Loader rejects → `error` event `E_IDENTITY_LOAD_FAIL` emitted, auction proceeds with no `user.eids`
  - ConsentManager `blocked: true` → `user.eids` + `user.buyeruid` stripped, `regs.ext.gdpr` still emitted
  - Webview environment → loader never invoked
  - Memoization → 5 slots in 2 batches still produce 1 loader call + 1 resolve call
- **`schain` + `ortb2` passthrough** — single spec verifying `pbjs.setConfig({ schain })` is called with the exact object, and `ortb2.site` is forwarded verbatim. Failure case: malformed schain (`ver` missing) throws `ConfigError` at bootstrap, no slot is ever registered.

Prior art:
- `tests/bootstrap-prebid-config.test.ts` (forwarding pattern → use as template)
- `tests/bootstrap-debug-forward.test.ts` (BootstrapOptions → pbjs.setConfig wiring)
- `tests/bootstrap-ima-preload.test.ts` (config-sniff parallel preload)
- `tests/bootstrap-ima-gate.test.ts` (per-batch gate + fallback)
- `tests/dependency-loader-reuse.test.ts` (pre-existing global + one-time warn)

### Quantitative bar

- All net-new modules at 100% statement + branch coverage (they're small + deep).
- No regression in the existing 186-test suite.
- Bundle size cap: 30 KB gzipped. Current 9.92 KB. Headroom budget for this PRD: ≤ 4 KB gzipped on top.
- Parse-time bench: must stay within +15 % of the recorded baseline (existing CI gate).

## Out of Scope

- **Floor calibration / dynamic floors** — explicitly deferred (Q9-A from grill). The floors module is already wired (`prebidConfig.floors`); tuning the values is a publisher operation, not an SDK feature.
- **Activating additional bidders in `mixed-media.html`** — deferred. The demo's bidder coverage is a sample, not a contract.
- **Server-to-server header bidding** — explicit non-goal in CONTEXT D11.
- **LiveRamp ATS, Yahoo ConnectID, Verizon CXID** — additional identity providers; the architecture supports adding them later as siblings to `identityResolver`, but landing them is a separate PRD.
- **GAM mediation / line-item configuration** — out of v1 scope (CONTEXT D14).
- **SRI hash verification of the injected identity-resolver script** — deferred to v2 hardening per the grilling outcome. Tracked as a follow-up.
- **Per-page TTL refresh of identity signals** — deferred per Q4 outcome; revisit only if data shows mid-session cookie churn.

## Further Notes

- Sequencing: the four pieces (resolver loader, runtime wrapper, merger, bootstrap wiring + schain/ortb2 passthroughs) are vertical tracer slices. Each can ship behind the `identityResolver.enabled: false` default without breaking any existing publisher.
- The decision to **block the first auction up to `timeoutMs`** mirrors the IMA gate (D47) deliberately. Publishers already accept that pattern for video. Reusing it keeps the mental model consistent.
- The **precedence table is the contract**, not the implementation. If the merger is refactored, the table in `docs/adr/0001-identity-resolver-augment.md` is the source of truth for what tests must assert.
- Q9-B's "ship just identity-resolver" and Q9-C's "schain + ortb2.site enrichment" landed in this one PRD because they share the same pre-auction `setConfig` push point. Splitting them would have meant two PRDs touching the same module — bad surface area for review.
- A separate non-PRD follow-up should activate Magnite + the second slot in `mixed-media.html` and verify the floors-module floors reach the wire (the `10.5 / 11` discrepancy seen during the floors patch validation needs root-cause investigation; it correlated to either an OS-level network shim or a stale cached bundle).

---

## Shipped vs Planned (post-implementation delta)

All 6 slices shipped — 31 new Jest cases across 5 spec files, full suite 218/50 green, bundle 10.91 KB gz (well under 30 KB cap).

| Originally planned | Shipped as | Notes |
| --- | --- | --- |
| `mergeIdentitySignals` pure function | ✅ as planned | All 6 priority behaviors + 2 regression-lock cases. |
| `DependencyLoader.loadIdentityResolver` | ✅ as planned | Mirrors `loadIMA`. Pre-existing global reuse + warn, inject + resolve, onload-missing-global reject, timeout reject, memoization. |
| `BootstrapOptions.identityResolver` config | ✅ as planned | D34 webview suppression preserved, `error` event with `E_IDENTITY_LOAD_FAIL` once, memoized preload. |
| `IdentityResolverRuntime` separate module | **collapsed** | Runtime wrapping happens inline in `buildSignalProvider` factory in bootstrap. No standalone module — the surface is too small to deepen. |
| Pre-auction merge + `ortb2` push | ✅ as planned | `AuctionOrchestrator.SignalProvider` injection, async `runBatch` with `setConfig({ ortb2 })` before `addAdUnits`. |
| `consent.blocked` strips identity, keeps regs | ✅ as planned, with **caveat** | Tested at orchestrator-direct boundary because existing slot-lifecycle gate skips auction entirely when consent is denied. If publishers need contextual-only auctions for blocked users, a follow-up issue must relax the lifecycle gate. |
| `schain` + `ortb2.site` passthrough | ✅ as planned | Validation throws `ConfigError` at bootstrap for malformed `schain`. `ortb2` loose-typed passthrough; SDK does not introspect. |
| Demo wire-up + docs reconciliation | ✅ as planned | `test-page/mixed-media.html` enables all three new blocks; `README.md` documents Global SDK options + defaults table; `CONTEXT.md` D48–D51 verified; ADR-0001 precedence table aligned with test assertions. |

### Deferred (not blocking v1)

- **Explicit timeout/block first-auction test** for `identityResolver.timeoutMs` — implicitly verified by the loader-reject path but not pinned with a wall-clock spec.
- **`ortb2.site.domain`/`ortb2.site.page` non-clobber test** — requires real Prebid runtime to observe merge semantics; not testable in jsdom.
- **SRI integrity for the identity-resolver script** — v2 hardening per the grilling outcome.
- **"Fire-with-no-identity" auction mode** for `consent.blocked` users — would require relaxing slot-lifecycle's existing consent gate (architectural decision deferred).
- **Per-page TTL refresh** of identity signals — only revisit if mid-session cookie churn becomes a real signal.

### Code surface added

| Module | New |
| --- | --- |
| `src/core/identity-signal-merger.ts` | new file — pure-function merger + precedence types |
| `src/core/errors.ts` | `E_IDENTITY_LOAD_FAIL` error code |
| `src/core/dependency-loader.ts` | `DEFAULT_IDENTITY_RESOLVER_SRC`, `IdentityResolverGlobal`, `loadIdentityResolver()`, module-scoped reuse-warn state |
| `src/core/auction-orchestrator.ts` | `SignalProvider`, `SignalProviderOutput`, optional ctor arg, async `runBatch` |
| `src/core/bootstrap.ts` | `IdentityResolverConfig`, `SupplyChainNode`, `SupplyChainObject` types; `BootstrapOptions.{identityResolver, identityResolverLoaderOverride, schain, ortb2}`; `validateSchain`, `ensureIdentityResolverPreload`, `buildSignalProvider`, `sharedConsentManager` |
| `docs/adr/0001-identity-resolver-augment.md` | new — architectural rationale |
| `CONTEXT.md` | D48–D51 entries |

### Test surface added

| Spec file | Cases | Lines |
| --- | --- | --- |
| `tests/identity-signal-merger.test.ts` | 8 | unit-level pure-function |
| `tests/dependency-loader-identity.test.ts` | 5 | loader behavior |
| `tests/bootstrap-identity-resolver-preload.test.ts` | 6 | config-sniff + parallel preload |
| `tests/bootstrap-identity-ortb2-push.test.ts` | 3 | bootstrap-level ortb2 push |
| `tests/auction-orchestrator-ortb2.test.ts` | 3 | orchestrator-direct consent-gating cases |
| `tests/bootstrap-schain-ortb2.test.ts` | 7 | schain validation + ortb2 passthrough |
| **Total added** | **32** | net **+32** suites pass (218 total, was 186 pre-PRD) |
