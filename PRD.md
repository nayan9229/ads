# PRD — Prebid Wrapper SDK v1

> Source-of-truth design decisions live in [CONTEXT.md](./CONTEXT.md). Decision IDs (D1–D38) below refer to that document's decision log.

## Problem Statement

Publishers who want Prebid.js-based programmatic monetization face high integration cost. Each ad slot requires hand-written glue code to load Prebid.js, configure bidder adapters, wire consent (TCF v2, CCPA) and identity (sharedId, ID5, UID2), gate lazy loading, track viewability, schedule no-fill retries and viewability-gated refreshes, render banner / outstream video / native ads, isolate per-slot failures, expose telemetry, and clean up on SPA route changes. Mistakes in any step silently degrade revenue or violate consent obligations. The current path forces every publisher to re-solve the same problem.

Trafficking teams need a way to ship a new ad slot without engineering involvement. Publisher engineers need a way to integrate Prebid without owning the Prebid lifecycle. Bidder partners need a stable, trusted integration surface. SREs need bounded performance and clear error semantics.

## Solution

A drop-in JavaScript SDK distributed as a single IIFE bundle (≤ 30 KB gzipped, ES2017) via GitHub Packages and jsDelivr. Publishers integrate one ad slot by:

1. Defining a per-slot config entry on `window.AdWrapperConfig` keyed by slot ID.
2. Pasting a single `<script id="{slot_id}" src="https://cdn.jsdelivr.net/npm/@nayan9229/ads@1/dist/pubads.mini.js"></script>` tag where the ad should appear.

The SDK auto-detects the script tag (`document.currentScript`), injects a sibling container at the reserved size, loads Prebid.js (hosted custom-build with locked bidder set: AppNexus, Rubicon, IX, OpenX, PubMatic, TripleLift) and Google IMA SDK in parallel, resolves consent via publisher-supplied CMP, runs a batched multi-slot auction with 50 ms debounce, selects the highest-CPM winner, and renders the creative format-appropriately. Lazy loading, viewability tracking, exponential-backoff retry on no-fill, viewability-gated time-based refresh, identity propagation, and SPA-aware destroy/re-init are built in. Lifecycle callbacks plus an optional `sendBeacon` analytics endpoint expose telemetry. No GAM, no ad-server line items, no S2S, no SDK-owned backend. Apache 2.0.

## User Stories

1. As a trafficker, I want to add a new ad slot by pasting one `<script>` tag, so that I can ship slots without engineering involvement.
2. As a trafficker, I want to choose a slot ID that follows our internal naming convention, so that reporting is consistent.
3. As a publisher engineer, I want to declare bidder params and floor pricing in a single JSON-like object on `window`, so that the configuration is easy to review.
4. As a publisher engineer, I want the SDK to fail fast on invalid config shapes with a typed error code, so that I catch mistakes during development.
5. As a publisher engineer, I want to call `AdWrapper.destroy(slotId)` from my React/Vue/Next.js route-change hook, so that single-page-app navigation does not leak ad state.
6. As a publisher engineer, I want re-mounted script tags with the same slot ID to auto-tear-down the previous instance, so that hot-reloaded components do not stack duplicate ads.
7. As a publisher engineer, I want lifecycle callbacks (`bidRequested`, `auctionEnd`, `adRenderSuccess`, `noFill`, `viewable`, `error`, etc.) to fire deterministically, so that I can pipe events into our existing analytics.
8. As a publisher engineer, I want to optionally configure a `sendBeacon` endpoint with a sample rate, so that I get RUM without writing transport code.
9. As a publisher engineer, I want errors in my callback functions to be caught and isolated, so that a bug in my handler does not crash the SDK.
10. As a publisher engineer, I want a documented set of typed error codes, so that I can write conditional recovery logic.
11. As a publisher engineer in EU/UK traffic, I want the SDK to refuse to run an auction without a CMP-resolved consent string, so that I do not violate TCF v2.
12. As a publisher engineer outside EU/UK, I want auctions to proceed even without a CMP, so that I do not lose revenue on uncontrolled regions.
13. As a publisher engineer with logged-in users, I want to pass a SHA-256-hashed email for UID2 identity, so that bidders see higher-value matched traffic.
14. As an end user, I want my browser to load the SDK from a fast CDN with long cache TTL, so that page navigation is not blocked by ad code.
15. As an end user, I want above-the-fold ads to render quickly and below-the-fold ads to lazy load, so that I do not pay for ads I never see.
16. As an end user, I want the slot to reserve its size before the creative arrives, so that the page layout does not jump (CLS).
17. As an end user, I want refreshing ads to pause when I switch tabs, so that the page is not abusing my mobile data and battery.
18. As an end user, I want video ads to start muted and only play when in view, so that they do not interrupt my reading.
19. As an end user, I want a clearly visible mute/unmute control on outstream video ads, so that I can take control.
20. As a bidder partner (Magnite, Index, etc.), I want a single Prebid `requestBids` call per page covering all slots, so that I am not hit with N independent requests.
21. As a bidder partner, I want consent strings (TCF + USP) and identity IDs propagated standardly, so that bids carry valid user signal.
22. As a bidder partner, I want the SDK to enforce viewability before counting refresh impressions, so that I am not paying for invisible ads.
23. As a bidder partner, I want price floors honoured and `bidWon` events fired correctly, so that my analytics match the publisher's.
24. As a bidder partner integrating a new adapter, I want a documented bidder-onboarding guide and a mock-bidder test harness, so that I can validate the integration before production.
25. As an SRE, I want a hard bundle-size cap enforced in CI, so that the SDK does not bloat over time.
26. As an SRE, I want documented SLOs for auction completion, time-to-render, and parse time, so that I can alert on regressions.
27. As an SRE, I want a perf regression bench that fails CI on +15 % parse-time delta, so that no one ships a slow release accidentally.
28. As an SRE, I want canary releases pinned to immutable URLs with a 7-day soak before the floating tag is bumped, so that bad releases do not auto-distribute.
29. As a publisher engineer with a designed page layout, I want to specify an existing `<div>` element as the ad container, so that the SDK renders inside my pre-positioned element instead of injecting a sibling div that disrupts my layout. If the element ID cannot be resolved, I want a typed `E_CONFIG_INVALID` error emitted and the slot to fall back gracefully to the default sibling-injection path.
29. As an SRE, I want SRI hashes published per release, so that publishers who require integrity verification can pin them.
30. As an SRE, I want explicit rollback semantics (deprecate on npm, no pinned-URL mutation), so that incident response is unambiguous.
31. As a contributor, I want a public Apache 2.0 repo with conventional-commits enforcement and `semantic-release`, so that contributions flow without manual versioning.
32. As a contributor, I want a Docusaurus docs site versioned per major release, so that I can write or update documentation alongside code changes.
33. As a contributor, I want a demo page with a scenario picker driving a mock bid adapter, so that I can reproduce edge cases locally without bidder credentials.
34. As a contributor, I want a `?real=1` query param to flip the demo to real bidders for credentialed integration testing, so that I can verify against live demand before release.
35. As a contributor, I want a `?cmp=eu|us|none` simulator on the demo page, so that I can exercise consent paths without setting up a real CMP.
36. As a banner publisher, I want responsive breakpoint maps (`0-767`, `768-1199`, `1200+`) for size selection, so that mobile and desktop slots are filled by appropriately sized creatives.
37. As a banner publisher, I want the container to reserve the largest size in the current breakpoint and centre the winning creative, so that there is no CLS but creatives below the max size still fit.
38. As a banner publisher, I want optional shrink-to-ad-size behaviour, so that I can collapse over-reserved space after render.
39. As an outstream video publisher, I want IMA SDK quartile events (start, first-quartile, midpoint, third-quartile, complete) bridged to lifecycle callbacks, so that I can measure completion rate.
40. As an outstream video publisher, I want autoplay-muted with click-to-unmute and scroll-out-of-viewport pause behaviour, so that the experience aligns with Chrome and Safari autoplay policies.
41. As a native ad publisher, I want to pass an HTML template string with `{{title}}`, `{{image}}`, `{{cta}}`, `{{body}}`, `{{sponsoredBy}}`, `{{icon}}` placeholders, so that I can match my site's visual style.
42. As a native ad publisher, I want SDK to refuse to render bids missing my declared `requiredAssets`, so that broken creatives never show.
43. As a native ad publisher, I want all text assets escaped via `textContent` and all URLs HTTPS-validated, so that ad-borne XSS is impossible from my SDK integration.
44. As a publisher with no-fill, I want the SDK to retry 5 times with exponential backoff (1, 2, 4, 8, 16 s) and then leave a blank reserved container, so that fill rate is maximised without infinite QPS draw.
45. As a publisher with no-fill, I want retries to pause if the slot leaves the viewport and resume when it returns, so that bidder QPS budget is preserved.
46. As a publisher with no-fill, I want an optional house-ad fallback per slot, so that I can monetise no-fill traffic.
47. As a publisher running refresh, I want a minimum 30 s interval enforced and refresh to start only after the previous impression was IAB-viewable, so that I respect industry standards.
48. As a publisher running refresh, I want a session cap of 10 refreshes per slot, so that I cannot accidentally flood a single user with impressions.
49. As a mobile WebView host, I want an `environment: "webview"` config flag that disables refresh and identity, so that the SDK does the right thing in app-embedded webviews.
50. As a mobile WebView host, I want SDK to emit a `{environment: "webview"}` analytics dimension, so that I can segment performance data.
51. As a multi-slot publisher, I want all eager slots batched into a single Prebid `requestBids` call, so that I make one HTTP request per bidder per page rather than N.
52. As a multi-slot publisher, I want lazy slots to debounce among themselves (50 ms) as they enter the viewport, so that nearby lazy slots also batch.
53. As a multi-slot publisher, I want infinite-scroll-injected new slots to join the running queue via the same bootstrap singleton, so that I do not need a different code path for them.
54. As a privacy-conscious publisher, I want SDK to honour CMP-revoked consent mid-session by stopping refresh and not loading identity, so that consent state changes propagate.
55. As a publisher debugging an integration, I want a `debug: true` mode that prints lifecycle events to the console, so that I can troubleshoot without a beacon endpoint.
56. As a publisher debugging an integration, I want `securitypolicyviolation` events logged in debug mode, so that I can find missing CSP directives quickly.
57. As a publisher debugging an integration, I want SDK to never call `eval` or `Function`, so that I do not need `unsafe-eval` in my CSP.
58. As a publisher with multi-currency demand, I want bids in non-USD currencies converted to USD for highest-CPM comparison, so that auctions are fair.
59. As a publisher with multi-currency demand, I want analytics events to carry both raw bid and USD-converted amounts, so that my dashboard can display either.
60. As an integrator with bidder accounts, I want a per-bidder documented param list (`bidder-setup.md`), so that I know exactly what to put in the config.
61. As a security reviewer, I want a documented list of required CSP directives and an explicit statement that `unsafe-eval` is not needed, so that I can sign off on the integration.
62. As a security reviewer, I want SRI hashes published per release and pinned URLs that are immutable, so that I can detect tampering.

## Implementation Decisions

### Module Plan

The SDK is composed of 17 modules organised into five clusters. Each module exposes a small, stable interface. Cross-cutting modules (consent, analytics, errors, callbacks) are dependencies of the orchestration cluster, not the reverse.

**Bootstrap & Config**

- **BootstrapSingleton**: manages `window.AdWrapper`. On first script-tag execution, instantiates the singleton, kicks off DependencyLoader, and registers the first slot. Subsequent tags detect the singleton and register without re-instantiating. Exposes the public API (`destroy`, `destroyAll`, callback `on`). Idempotent re-init when a slot ID is re-mounted.
- **ConfigRegistry**: reads `window.AdWrapperConfig`, validates per-slot config shape, freezes the validated object, throws typed `E_CONFIG_INVALID` on bad shape. Provides typed accessors for downstream modules. Validation runs synchronously at slot registration time.
- **DependencyLoader**: async loads Prebid.js (hosted custom-build URL — see D7) and IMA SDK (video slots only) via injected `<script>` tags. Deduplicates concurrent requests. Hard timeouts: 5 s each. On failure, emits `E_PREBID_LOAD_FAIL` or `E_IMA_LOAD_FAIL`. Returns ready promises that orchestration awaits.

**Orchestration**

- **AuctionOrchestrator**: maintains a queue of registered slots. On first registration, starts a 50 ms debounce timer; on expiry, fires a single `pbjs.requestBids({adUnits})` for all eager slots. Lazy slots batch independently as they enter their `rootMargin`. Dispatches winners to per-slot renderers via `SlotLifecycle`.
- **SlotLifecycle**: per-slot state machine. States: `pending` → `gated` (waiting on lazy / consent / dependencies) → `bidding` → `won` | `noFill` | `timeout` → `rendering` → `rendered` → `viewable` → `refreshing` (loops) → `destroyed`. Error states branch off each. State transitions emit lifecycle callbacks. Holds references to all timers and observers so `destroy(slotId)` can tear them down cleanly.

**Gates & Timing**

- **LazyLoadGate**: wraps `IntersectionObserver` with `rootMargin: "400px 0px"` and threshold 0. Returns a one-shot promise resolving when the slot first enters the buffer zone. Disconnects after firing.
- **ViewabilityTracker**: separate `IntersectionObserver` at threshold 0.5 with a timer enforcing 1 s continuous (display) or 2 s continuous (video). Emits `onViewable` once per impression cycle. Resets on refresh.
- **RetryScheduler**: schedules up to 5 callbacks with delays `[1000, 2000, 4000, 8000, 16000]` ms. Pauses if slot leaves viewport (queried via injected predicate), resumes on re-entry. Cancellable. Used for no-fill / timeout retry.
- **RefreshScheduler**: time-based scheduler with min 30 s interval. Starts only after `viewable` event fires for the prior impression. Pauses on `document.visibilityState === "hidden"` and on slot out-of-viewport. Enforces session-cap of 10. Cancellable.

**Renderers**

- **BannerRenderer**: chooses container size from breakpoint map and current `innerWidth`, reserves space, calls `pbjs.renderAd(iframe, bidId)` inside a friendly same-origin iframe (D24). Implements optional `shrinkToAdSize` post-render layout adjust.
- **VideoRenderer**: creates a `<video>` element inside the container, instantiates IMA `AdsLoader` and `AdsManager`, hands the Prebid-returned `vastXml` or `vastUrl`, wires autoplay-muted, scroll-to-pause (IntersectionObserver), unmute-on-click, and quartile-event bridging to lifecycle callbacks. Disposes AdsManager on `destroy`.
- **NativeRenderer**: parses the publisher's HTML template, substitutes `{{asset}}` placeholders using safe DOM operations (text via `textContent`, images via `Image` element with URL validation, URLs allowlisted to HTTPS). Rejects bids missing `requiredAssets`. Wires Prebid `clickTrackers` into anchor `onclick` handlers and impression trackers via 1×1 pixels.

**Cross-cutting**

- **ConsentManager**: probes `window.__tcfapi` (TCF v2) and `window.__uspapi` (CCPA) with a 1 s timeout. Returns resolved consent state. Applies EU/UK heuristic (timezone + `Accept-Language`) to decide whether to block on missing CMP. Re-queries on `tcloaded` / `useractioncomplete` events to honour mid-session consent changes.
- **AnalyticsEmitter**: pluggable transport. Always invokes registered lifecycle callbacks (`CallbackRegistry`). Optionally `sendBeacon`s versioned event payload (`{v: 1, type, slotId, ts, ...}`) to publisher endpoint, with config-driven sample rate (default 1.0). Buffers events when offline; flushes on `pagehide`.
- **ErrorRegistry**: holds typed error code enum. Provides `wrap(fn)` for user-supplied callbacks (try/catch + log). Provides `fail(code, context)` that emits `onError` and updates slot state. Maps Prebid internal errors to wrapper codes.
- **CallbackRegistry**: simple event emitter for lifecycle events. Dispatch is isolated per handler (one bad handler does not block others) via `ErrorRegistry.wrap`.
- **DomInjector**: locates the script tag via `document.currentScript` with `document.getElementById(scriptId)` fallback. Inserts a sibling `<div>` reserved at the largest size in the current breakpoint. Sets `display: inline-block; vertical-align: top` to avoid layout regressions on mid-flow injection. Exposes a method for renderers to size-adjust the container.

### Key Interfaces (shape-only)

```ts
// ConfigRegistry
register(slotId: string, raw: unknown): ValidatedSlotConfig          // throws E_CONFIG_INVALID
get(slotId: string): ValidatedSlotConfig | undefined

// BootstrapSingleton (window.AdWrapper)
on(event: LifecycleEvent, fn: (e: EventPayload) => void): Unsubscribe
destroy(slotId: string): void
destroyAll(): void

// DependencyLoader
loadPrebid(): Promise<typeof pbjs>                                   // 5 s timeout
loadIMA(): Promise<typeof google.ima>                                // 5 s timeout

// AuctionOrchestrator
enqueue(slot: SlotLifecycle): void                                   // joins current batch or starts one
flushNow(): void                                                     // used by tests

// SlotLifecycle
start(): void
destroy(): void
state(): SlotState

// ConsentManager
resolve(): Promise<ConsentState>                                     // { tcString?, uspString?, blocked: boolean }

// LazyLoadGate
gate(element: HTMLElement): Promise<void>                            // resolves on first intersection

// ViewabilityTracker
track(element: HTMLElement, opts: {threshold, durationMs}): Promise<void>

// RetryScheduler
start(attempt: () => Promise<boolean>, opts: {maxAttempts, delaysMs, isInView}): CancelFn

// RefreshScheduler
start(opts: {intervalSec, sessionCapRemaining, isInView, onRefresh}): CancelFn

// Renderers (all share shape)
render(container: HTMLElement, bid: PrebidBid): Promise<void>        // resolves on visible / fails to E_RENDER_*

// AnalyticsEmitter
emit(type: EventType, payload: EventPayload): void

// ErrorRegistry
wrap<T extends (...a: any[]) => any>(fn: T): T
fail(code: ErrorCode, context: Record<string, unknown>): void
```

### Architectural Decisions (cross-reference)

- Self-executing script tag + `window.AdWrapperConfig` global as the only public ingress (D1, D2, D3).
- Idempotent multi-tag bootstrap with batched auction at 50 ms debounce (D4).
- SDK runs on publisher top page; not inside a creative iframe (D5).
- Container injected as a sibling of the script tag (D6).
- Prebid hosted custom-build URL with locked bidder set + module set (D7, D8).
- Direct render of Prebid winner; no GAM / GPT (D9).
- No-fill retry with exponential backoff, then blank reserved (D10, D11).
- Lazy load with 400 px `rootMargin`; opt-in eager (D12).
- Outstream video only in v1, IMA SDK exclusively (D13).
- Native template with safe escape + URL allowlist (D14).
- Publisher CMP required for EU/UK; consent gating with 1 s probe (D15).
- Pluggable analytics; no SDK-owned backend (D16).
- Refresh: time-based, viewability-gated, capped, conservative defaults (D17).
- Identity: sharedId + ID5 always-on, UID2 opt-in (D18).
- ES2017, IIFE, 30 KB gzipped (D19).
- Typed error codes + per-slot isolation + Promise<Result> for runtime errors (D20).
- Friendly same-origin iframe for banner; Prebid `renderAd` default (D24).
- Responsive sizes via breakpoint map (D25).
- SPA cleanup via explicit `destroy` API + idempotent re-init (D26).
- CSP documented; nonce supported; no `unsafe-eval` (D27).
- Init order: sync script execution, immediate injection, parallel dep load, gated auction (D29).
- Mobile WebView: opt-in `environment: "webview"` flag (D30).
- Apache 2.0 (D31).
- Distribution: GitHub Packages + jsDelivr; pinned + floating-major + latest URLs; SRI hashes (D22-revised).
- Currency: USD base, Prebid hosted FX, `dense` granularity (D34).
- BYO bidder seats; manual JSON config; no dashboard v1 (D37).

## Testing Decisions

Tests assert external behaviour only — public method outputs, emitted events, state transitions, DOM observable side-effects. Tests do not assert on internal calls between modules. Each module under test is wired with stubs for its collaborators (no spying on private methods).

Test stack:

- Unit & integration: Jest + jsdom.
- E2E: Playwright against the demo page with mock bid adapter.

### Modules with Unit Tests (v1)

- **ConfigRegistry** — validate happy-path schemas, reject malformed configs with the right `E_CONFIG_INVALID` payload, handle missing optional fields, freeze the returned object.
- **SlotLifecycle** — assert each state transition fires the expected callbacks, no-fill triggers RetryScheduler, viewable triggers RefreshScheduler when enabled, `destroy` tears down all observers and timers regardless of current state, error states halt further transitions.
- **RetryScheduler** — exact delay sequence, viewport-aware pause/resume, max-attempts enforcement, cancellation idempotency, no-leak when cancelled mid-delay (use fake timers).
- **RefreshScheduler** — refresh only fires after viewable event, pauses on `visibilitychange`, pauses on viewport exit, respects session cap, min-interval rejection of bad config.
- **ConsentManager** — TCF resolved-state path, TCF timeout path, USP-only path, no-CMP + EU heuristic blocks, no-CMP + non-EU heuristic proceeds, mid-session consent revocation re-emits state.
- **NativeRenderer** — text assets injected via `textContent` (assert raw HTML in asset does not become DOM), bad image URL rejected, required-asset missing rejects bid, click trackers fire on synthetic click, no template placeholders left unsubstituted on output.
- **AnalyticsEmitter** — callback transport always fires, beacon transport calls `navigator.sendBeacon` with versioned schema, sampling rate filters events correctly (use deterministic RNG stub), `pagehide` flushes buffered events.
- **ViewabilityTracker** — IAB display threshold (50%/1 s) — synthetic IntersectionObserver entries, leaves before 1 s do not count, exact-1 s counts, video threshold (50%/2 s).

### Modules Covered by Integration / E2E Only

Thin modules (`CallbackRegistry`, `ErrorRegistry`, `DomInjector`) are exercised in integration tests via the public SDK API. Renderers other than `NativeRenderer` (`BannerRenderer`, `VideoRenderer`) are E2E-tested against Prebid's `renderAd` and Google IMA SDK; mocking either at the unit level produces low-confidence tests. `DependencyLoader` is integration-tested with stubbed CDN endpoints. `BootstrapSingleton` and `AuctionOrchestrator` are integration-tested with real Prebid + the mock bid adapter.

### Playwright E2E Flows (CI smoke = F1, F4, F5)

- F1 Single banner happy path — mock bidder wins → container rendered at correct size → `adRenderSuccess` fired.
- F2 Outstream video happy path — IMA loads, VAST plays, quartile events fire.
- F3 Native ad happy path — template fields substituted, click tracker fires, no XSS via malicious asset.
- F4 Multi-slot batched auction — three eager slots all fill, one `requestBids` call observed.
- F5 No-fill exponential retry — bidder returns no-bid; 5 attempts at exponential delays; final state = blank reserved + `noFill` emitted.
- F6 Lazy load — slot below fold; no auction until scroll within `rootMargin`.
- F7 Refresh — viewability-gated; refresh fires after 30 s of being in-view; pauses on tab hidden.
- F8 GDPR no-CMP — EU geo simulated; auction blocked; `onError(E_NO_CMP)` emitted.

### Test Conventions

- No HTTP fixtures committed. Mock bid adapter (`test-page/mock-adapter.js`) drives scenarios via `window.MOCK_BIDDER_SCENARIO`.
- Fake timers (Jest `useFakeTimers`) for scheduler tests; assertions on tick-by-tick effect.
- Real `IntersectionObserver` polyfill in jsdom; assertions driven by polyfill's manual trigger API.
- One assertion per behaviour where practical; avoid multi-step setups that test more than one thing per case.

### Prior Art

This is a greenfield repository. No existing test patterns to extend. The conventions above are the seed; subsequent contributors follow.

## Out of Scope

The following are explicitly deferred to v2 (see [CONTEXT.md §1](./CONTEXT.md)):

- Rewarded video, instream video, VMAP, VPAID, ad podding.
- Floating / sticky outstream variants.
- Additional bidders (Criteo, Sovrn, 33Across, Amazon TAM).
- LiveRamp ATS identity.
- GAM / GPT integration.
- Cross-origin iframe / SafeFrame 1.1 rendering.
- Dynamic floors via `priceFloors` module.
- Re-auction on viewport resize.
- Hybrid client-side + server-side header bidding (Prebid Server).
- Shared / master bidder seat as managed service.
- Publisher dashboard SaaS.
- Native mobile SDK wrapper (iOS / Android).
- Per-bidder timeout overrides.
- User-action refresh triggers.
- Built-in Prebid Analytics Adapter.

The following are explicitly never in scope for this SDK:

- A built-in CMP. Publishers integrate their own (D15).
- A wrapper-owned analytics backend (D16).
- A wrapper-owned shared bidder seat in v1 (D37).
- IE11 / pre-2017 browser support (D19).
- `unsafe-eval` in publisher CSP (D27).

## Further Notes

### Open Items at Time of PRD

- **Issue tracker not configured for this repository.** This PRD lives at `PRD.md`. When the team picks a tracker, port the PRD into it with the `ready-for-agent` triage label and link back to this file.
- **GitHub repository not initialised.** First implementation task includes `git init`, branch protection rules, and the GitHub Actions workflows referenced in D36.
- **CDN sub-domains** (`docs.adwrapper.com`, `demo.adwrapper.com`) are placeholders. Confirm or rename before docs hosting setup. SDK CDN itself goes through `cdn.jsdelivr.net` (D22-revised) — no sub-domain ownership needed.
- **Bidder credentials for the demo's `?real=1` mode** require environment-variable provisioning in CI. Plan onboarding with the six locked bidder partners (D8) before the first stable release.
- **CMP for the demo page** — pick one IAB-compliant CMP (e.g. Quantcast Choice, Sourcepoint) for staging traffic, separate from the simulator query-param paths in the demo (D32, D15).

### Sequencing Guidance for Implementation

A reasonable v1 build order (not prescriptive):

1. Project scaffolding — TypeScript, Rollup, Babel, ESLint, Prettier, Jest, Playwright, GitHub Actions workflows, `semantic-release`.
2. `ConfigRegistry` + `ErrorRegistry` + `CallbackRegistry` — foundation that everything else depends on.
3. `DomInjector` + `DependencyLoader` — bootstrap path.
4. `ConsentManager` — gate that auction depends on.
5. `LazyLoadGate` + `ViewabilityTracker` + `RetryScheduler` + `RefreshScheduler` — timing primitives.
6. `BootstrapSingleton` + `AuctionOrchestrator` + `SlotLifecycle` — orchestration core.
7. `BannerRenderer` first (simplest format), then `NativeRenderer`, then `VideoRenderer`.
8. `AnalyticsEmitter` with callback transport first, then beacon transport.
9. Mock bid adapter + demo page.
10. Docs site + onboarding guide.
11. Canary release `1.0.0-rc.1` → 7-day soak → `1.0.0` stable.

### Notes on Prior Art Consumed

- Prebid.js core architecture and `pbjs.que` patterns guide module boundaries.
- Google IMA SDK documented integration patterns drive `VideoRenderer`'s shape.
- IAB SafeFrame 1.1 considered and deferred (D24); revisit in v2.
- IAB TCF v2 specification is the authority for `ConsentManager`.
- `keep-a-changelog`, Conventional Commits, and `semantic-release` are off-the-shelf; no inventive process here.
