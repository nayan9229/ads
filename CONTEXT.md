# CONTEXT — Prebid Wrapper SDK Design Decisions

This document captures the architectural and operational decisions for the Prebid Wrapper SDK described in [PROJECT.md](./PROJECT.md). It is the source of truth for *how* and *why* the SDK is built the way it is. Where PROJECT.md describes the goal, this document records the path chosen.

---

## 1. v1 Scope Freeze

### In-Scope

- **Integration model**: self-executing `<script>` tag drop-in. Single tag per slot. No publisher `init()` boilerplate.
- **Configuration delivery**: `window.AdWrapperConfig` global object set inline on the page above the script tag. Keyed by slot ID.
- **Distribution**: single IIFE bundle, ES2017 target, hard 30 KB gzipped cap. Hosted via GitHub Packages npm registry + jsDelivr CDN (pinned, floating-major, and latest URLs). SRI hashes published per release.
- **Ad formats**:
  - Banner (300x250, 320x50, 728x90, 970x250, responsive breakpoints).
  - Outstream video via Google IMA SDK exclusively.
  - Native HTML with publisher-defined template strings.
- **Bidders** (Prebid hosted custom-build URL): AppNexus, Rubicon, IX, OpenX, PubMatic, TripleLift.
- **Prebid modules**: `consentManagementTcf`, `consentManagementUsp`, `gdprEnforcement`, `priceFloors`, `currency`, `userId` (sharedId + id5Id + optional uid2 submodules), `dfpAdServerVideo`.
- **Identity**: sharedId + ID5 always-on, UID2 opt-in via publisher-supplied hashed email.
- **Auction mode**: client-side header bidding only. Batched multi-slot auction with 50 ms debounce after first tag execution.
- **Render**: Prebid-only direct render (no GAM/GPT). Friendly iframe (same-origin) per Prebid `pbjs.renderAd()` default.
- **Lazy loading**: IntersectionObserver with `rootMargin: "400px 0px"`. Opt-in eager mode for above-fold slots.
- **Viewability**: IAB standard (50%/1 s display, 50%/2 s video) tracked via IntersectionObserver. Emits `onViewable` callback.
- **Refresh**: opt-in per slot, time-based only, minimum 30 s interval, viewability-gated, paused when tab hidden or slot out of viewport, max 10 refreshes per slot per session.
- **No-fill handling**: 5-attempt exponential backoff (1 s, 2 s, 4 s, 8 s, 16 s), then blank reserved space. Optional house-ad fallback per slot.
- **Floor pricing**: static per-slot floor in config. Dynamic floors deferred.
- **Currency**: USD base. FX rates from Prebid hosted (`currency.prebid.org/latest.json`), refreshed every 24 h, falls back to cached or assumes USD. Price granularity = `dense`.
- **Consent**: publisher CMP required. SDK reads `__tcfapi` (TCF v2) and `__uspapi` (CCPA). EU/UK without CMP → auction blocked + `onError(E_NO_CMP)`. Outside EU/UK without CMP → proceed without consent string.
- **Analytics**: pluggable. Lifecycle callbacks + optional beacon endpoint provided by publisher (`navigator.sendBeacon`). No SDK-owned analytics backend.
- **Error handling**: typed enum codes (`E_NO_CMP`, `E_TIMEOUT`, `E_RENDER_FAIL`, `E_BIDDER_FAIL`, `E_CONFIG_INVALID`, `E_PREBID_LOAD_FAIL`, `E_IMA_LOAD_FAIL`, `E_RENDER_TIMEOUT`). Per-slot isolation. Throws on programmer error, returns Promise<Result> for runtime errors. Wraps user callbacks in try/catch.
- **Lifecycle**: explicit `AdWrapper.destroy(slotId)` and `AdWrapper.destroyAll()`. Idempotent re-init on re-mounted script tags (SPA-safe).
- **CSP**: documented minimum directives. Optional nonce support for injected dependency scripts. No `unsafe-eval` required.
- **Mobile WebView**: best-effort v1, not under SLO. Detection logs environment to analytics. Opt-in `environment: "webview"` flag disables identity + refresh and enables IMA WebView fallback.
- **Build tooling**: TypeScript + Rollup + Babel (per PROJECT.md). External source maps uploaded with bundle but access-restricted.
- **Tests**:
  - Unit (Jest, jsdom) ≥80% line coverage on `core`, `utils`, `callbacks`, `dom`.
  - Integration (Jest, jsdom) with real Prebid + mock bid adapter.
  - E2E (Playwright) covering 8 flows (banner, video, native, multi-slot, no-fill retry, lazy, refresh, consent-block).
- **CI/CD**: GitHub Actions. PR gates = lint + typecheck + unit + integration + Playwright smoke (F1+F4+F5) + bundle-size + perf bench (+15% regression block). Nightly runs full Playwright + load test. Conventional Commits + `semantic-release`. Release workflow: build → test → publish to GitHub Packages → GitHub Release with SRI hash → jsDelivr cache purge → docs rebuild → demo redeploy.
- **Canary**: pre-release `vX.Y.Z-rc.N` deploys to pinned URL only, no floating bump. 7-day soak before promotion.
- **Documentation**: README quick-start, TypeDoc-generated API reference, hand-written integration guides (`quickstart`, `configuration`, `bidder-setup`, `cmp`, `spa`, `csp`, `slo`, `migration`, `onboarding`) on Docusaurus site `docs.adwrapper.com`. Versioned per major. CHANGELOG.md required.
- **Demo page**: single page on GitHub Pages at `demo.adwrapper.com` covering all formats, scenario picker, mock-bidder adapter, debug rail with event stream + per-slot state + auction breakdown + SLO meter. `?real=1` swaps to real bidders. `?cmp=eu|us|none` simulates consent paths.
- **License**: Apache 2.0. Public repo. Public CDN. Monetization path = managed hosting + dashboards + premium support (out of repo scope).
- **Onboarding**: bring-your-own bidder seats. Manual JSON config in `window.AdWrapperConfig`. Slot IDs publisher-chosen (recommended `{section}_{size}_{position}`). No publisher dashboard in v1.

### Deferred to v2

- Rewarded video, instream video, VMAP, VPAID, ad podding.
- Floating/sticky outstream variants.
- Additional bidders: Criteo, Sovrn, 33Across, Amazon TAM.
- Additional identity: LiveRamp ATS.
- GAM/GPT integration as opt-in.
- Cross-origin iframe / full SafeFrame 1.1 rendering.
- Dynamic floors via Prebid `priceFloors` module.
- Re-auction on debounced viewport resize.
- Hybrid client-side + server-side header bidding (Prebid Server).
- Shared/master bidder seat as managed-service offering.
- Publisher dashboard SaaS.
- Native mobile SDK wrapper.
- Per-bidder timeout overrides.
- User-action refresh triggers.
- Built-in Prebid Analytics Adapter.

---

## 2. Performance SLOs

| Metric | p50 | p95 | p99 |
|---|---|---|---|
| Time-to-first-bid | 400 ms | 900 ms | 1500 ms |
| Auction completion (timeout = 1500 ms) | 1100 ms | 1500 ms | 1500 ms |
| Time-to-render (banner) | 200 ms | 600 ms | 1200 ms |
| Time-to-render (video, IMA loaded) | 800 ms | 1800 ms | 3000 ms |
| SDK parse + init (mid-tier mobile) | <100 ms | <200 ms | <400 ms |
| Memory per active slot | <2 MB | <5 MB | <10 MB |

- Bundle ≤ 30 KB gzipped (hard cap).
- JS error rate < 0.5 % of slot loads (excluding `E_NO_CMP` and `E_TIMEOUT`).
- Fill rate target ≥ 70 % on banner with locked bidder set, measured not promised.
- CI bench regression gate: parse-time delta > +15 % vs prior release blocks merge.
- WebView traffic out of SLO coverage in v1.

Timeout defaults:

| Layer | Default | Range |
|---|---|---|
| Auction (Prebid `requestBids`) | 1500 ms | 500–3000 ms |
| Per-bidder | same as auction | uniform v1 |
| Prebid.js script load | 5000 ms | hard fail |
| IMA SDK load | 5000 ms | hard fail |
| Render | 3000 ms | from winner-picked |
| Prebid failsafe | auctionTimeout + 500 ms | derived |

---

## 3. Decision Log

Each entry: decision → reason → trade-offs accepted.

1. **Integration model = self-executing tag**, not config-driven `init()` API. Trafficker pastes one tag; SDK reads context. Trade-off: less flexible than imperative API; mitigated by global config object for advanced cases.
2. **Config delivery = `window.AdWrapperConfig` global** set inline above the script tag. Trade-off: publisher must define config before tag executes; document this ordering requirement.
3. **Bidder params** live in the global config object (no JSON-in-data-attrs, no remote fetch, no bundled presets). Trade-off: publisher dev pastes per-bidder params manually; bidder onboarding doc covers shape.
4. **Multi-slot model = idempotent bootstrap + batched auction**. First tag instantiates `window.AdWrapper` singleton, later tags register slots. 50 ms debounce after first tag execution collects all eager slots into a single `pbjs.requestBids({adUnits: [...]})`. Trade-off: ~50 ms latency on first-slot fill in exchange for one HTTP request per bidder.
5. **Execution context = publisher top page**. SDK runs directly on the publisher's document, not inside an ad-server creative iframe. Trade-off: the example HTML's `meta name="ad.size"` is treated as illustrative and unused.
6. **Container placement = sibling of script tag** via `document.currentScript.parentNode`. Falls back to `document.getElementById(scriptId)` if `currentScript` is null. Trade-off: publisher must avoid `async`/`defer` on the script tag.
7. **Prebid build = hosted custom-build service** (`docs.prebid.org/download.html`). Bidder list + modules baked into URL. Trade-off: rebuilding the URL is the only way to change bidder set; version pinning relies on hosted-build version.
8. **v1 bidder set = AppNexus, Rubicon, IX, OpenX, PubMatic, TripleLift.** Modules listed above. Trade-off: excludes Criteo / Sovrn / Amazon TAM in v1.
9. **Ad server = none. Prebid-only direct render.** No GAM, no GPT, no line items. Trade-off: no unified auction with AdX or direct-sold backfill; v2 opt-in GAM adapter.
10. **No-fill behaviour = exponential-backoff retry, then blank reserved.** 5 attempts (1 s, 2 s, 4 s, 8 s, 16 s) then blank-but-reserved container. Per-slot opt-in house-ad fallback. Static per-slot floor in config. Trade-off: ~31 s retry horizon; pauses if slot leaves viewport.
11. **Retry timing = exponential backoff** as in 10. Trade-off: variable cadence vs fixed; better demand match.
12. **Lazy load default = on, `rootMargin: "400px 0px"`**. Opt-in eager via `eager: true` per slot. Trade-off: 400 px buffer balances pre-fetch vs wasted QPS.
13. **Video v1 = outstream only.** Instream / rewarded / VMAP / VPAID / podding deferred. Trade-off: smaller initial demand surface; outstream covers the majority publisher use case.
14. **Native template = HTML string with placeholders + safe escape.** Text assets injected via `textContent`, image/click URLs validated to HTTPS and routed through Prebid native click trackers. Required-asset whitelist per slot. Trade-off: no JS in templates; styling-only flexibility deemed sufficient.
15. **Consent = require publisher CMP.** SDK probes `__tcfapi` + `__uspapi`. EU/UK without CMP blocks auction; outside EU/UK proceeds without consent string. Trade-off: publisher must integrate a CMP; SDK is not in the CMP business.
16. **Analytics = pluggable, no SDK-owned backend.** Lifecycle callbacks always fire; optional beacon mode posts batched events via `sendBeacon` to a publisher-provided endpoint. Versioned event schema with sampling support. Trade-off: no built-in dashboard; matches no-infra positioning.
17. **Refresh = opt-in, time-based, viewability-gated.** Min 30 s, viewability-gated start, pauses on tab hidden / out-of-viewport, capped at 10 per slot per session. Trade-off: conservative defaults limit publisher misuse and bidder pushback.
18. **Identity = sharedId + ID5 + opt-in UID2.** First-party cookie storage, 1-year expiry, consent-gated. Trade-off: UID2 only useful for logged-in cohort; LiveRamp deferred.
19. **Build = ES2017, IIFE primary, 30 KB gz cap.** External source maps, access-restricted. ESM secondary build for npm consumers. Trade-off: no IE11.
20. **Error model = typed enum codes + per-slot isolation.** Throws on programmer error, returns Promise<Result> for runtime errors. User callbacks wrapped in try/catch. Console verbosity gated by `debug: true`. No SDK-owned error reporting service. Trade-off: publisher owns telemetry pipeline.
21. **Testing = Jest (unit + integration) + Playwright (E2E).** Mock bidder adapter with scenario toggles. CI smoke = F1/F4/F5; nightly full matrix + load test. Trade-off: nightly load not gating PRs.
22. **Distribution = GitHub Packages + jsDelivr.** Pinned, floating-major, and latest URLs. SRI hashes published per release. `npm deprecate` for rollback. Trade-off: jsDelivr availability outside our control; documented for publishers.
23. **Timeouts** as in SLO table above.
24. **Banner render = friendly iframe (same-origin).** Same-origin via Prebid default. Trade-off: requires publishers to trust bidder creatives; SDK still enforces native-template escaping + URL allowlists.
25. **Responsive sizes = viewport-filtered breakpoints + render at winning bid size, reserved space default.** Per-slot breakpoint map. Container reserved at largest size in current breakpoint; smaller winner renders centred with margin. `shrinkToAdSize: true` opt-in to collapse. Trade-off: no re-auction on viewport resize in v1.
26. **SPA cleanup = explicit API.** `AdWrapper.destroy(slotId)` and `AdWrapper.destroyAll()`. Idempotent re-init detects re-mounted slot IDs and auto-tears-down + re-inits. Trade-off: publisher must wire cleanup into framework hooks.
27. **CSP = documented requirements + optional nonce.** Minimum directives documented; `unsafe-inline` styles required; `unsafe-eval` not required. `securitypolicyviolation` listener active under `debug: true`. Trade-off: strict-CSP publishers incompatible with programmatic ads in general.
28. **SLOs** as in table above.
29. **Init order = sync execution, immediate container injection, parallel dependency load, gated auction trigger.** Auction trigger requires Prebid ready + eager-or-in-viewport + consent resolved + 50 ms debounce. Late-arriving tags (infinite scroll) join the queue. Trade-off: requires sync script tags.
30. **Mobile WebView = best-effort, no SLO.** Detection emits analytics; opt-in `environment: "webview"` disables identity + refresh and enables IMA WebView fallback. Trade-off: native bridge variability not in scope.
31. **License = Apache 2.0**, public repo, public CDN. Monetization via managed services. Trade-off: forks possible; mitigation = brand + hosted infra + bidder relationships.
32. **Demo page** as in section 1. Trade-off: GitHub Pages hosting limits dynamic features; acceptable.
33. **Header bidding = CSB only in v1.** S2S deferred to v2. Trade-off: 6 bidders client-side is the QPS budget.
34. **Currency = USD base + Prebid hosted FX, refresh 24 h.** Price granularity `dense`. Cached fallback on fetch failure. Trade-off: external FX dependency.
35. **Documentation = Docusaurus + TypeDoc + Keep-a-Changelog.** Versioned per major. Trade-off: docs maintenance burden.
36. **CI/CD = GitHub Actions, Conventional Commits, `semantic-release`.** PR gates + nightly + release workflow as listed. Canary RC tag deploys pinned-only with 7-day soak. Trade-off: release automation requires disciplined commit messages.
37. **Onboarding = bring-your-own bidder seats, manual JSON config, no dashboard v1.** Slot IDs publisher-chosen. Trade-off: slower SMB onboarding; v2 shared-seat managed service addresses this.
38. **v1 scope frozen** as in section 1.
39. **Schema mirrors Prebid's `mediaTypes` shape** — drop the `type: "banner"|"native"|"video"` discriminant; slot config carries `mediaTypes: { banner?, video?, native? }`. Mixed banner+video on the same slot is supported natively. Rendering branches on the winning bid's `mediaType` at runtime (not on a config-level discriminant). Reason: enables cross-mediaType auctions per slot; aligns with Prebid's own adUnit schema.
40. **Mixed-media reservation = banner-max only** — when a slot declares both `mediaTypes.banner` and `mediaTypes.video`, the container reserves at the largest banner size (per Issue #7 rule). Video winner renders **constrained to the reserved container** (not declared `playerSize`). Reason: zero CLS; declared `playerSize` is a bid-request hint, not a render contract. Trade-off accepted: video bidders that price on playerSize may dampen CPM when actual render < declared.
41. **Instream context = bidder signal only, render as outstream** — slots may declare `mediaTypes.video.context: "instream"` to influence bid pricing, but the SDK's `VideoRenderer` renders all video bids in its own outstream-style player (CONTEXT D13). True content-coupled instream (pre/mid/post-roll inside publisher's content player) remains v2.
42. **Slot config schema is mediaType-nested** — format-specific fields live inside `mediaTypes.<format>` (`banner.sizes`, `banner.shrinkToAdSize`, `native.template`, `native.requiredAssets`, `video.context`, `video.playerSize`, `video.mimes`, …). Cross-cutting fields (`bidders`, `eager`, `refresh`, `fallback`) live at slot root. Mirrors Prebid's own adUnit shape.
43. **IMA load is config-conditional + parallel** — refines D29. Bootstrap scans the registered config; if any slot declares `mediaTypes.video`, IMA loader fires immediately in parallel with Prebid. Banner-only sites pay zero IMA bytes.
44. **Default dependency URLs** — IMA src hardcoded to `https://imasdk.googleapis.com/js/sdkloader/ima3.js` (Google's canonical CDN; never overridden). Prebid src defaults to `prebid.js@latest` `not-for-prod` from jsDelivr with a one-time `console.warn` recommending publishers override via `window.AdWrapperOptions.prebidSrc` to point at a Prebid hosted custom build matched to their bidder set (CONTEXT D7).
45. **Reuse pre-existing globals** — bootstrap detects `window.pbjs.que` and `window.google.ima`; if present, reuses them and skips injection. Emits a one-time `console.warn` noting the SDK's required adapter list may differ from the host page's Prebid build. Avoids overwriting another wrapper's Prebid global on the same page.
46. **IMA failure → pre-auction strip** — when `loadIMA()` rejects (5 s timeout per D23 or `onerror`), bootstrap sets an `imaReady: false` flag. Orchestrator filters `mediaTypes.video` out of every queued slot before `addAdUnits`. Banner-only auction proceeds. Emits `error` event with `E_IMA_LOAD_FAIL` once at bootstrap.
47. **Per-slot IMA-readiness gate on video/mixed slots** — `SlotLifecycle.start()` for any slot declaring `mediaTypes.video` waits for the IMA load promise to settle (resolve OR reject) before transitioning to `bidding`. Banner-only slots are unaffected and auction immediately on Prebid-ready. Worst-case wait = IMA timeout (5 s).

---

## 4. Public API Surface (v1)

```js
// Per-slot configuration on publisher page (above script tag).
window.AdWrapperConfig = window.AdWrapperConfig || {};
window.AdWrapperConfig["homepage_300x250_top"] = {
  type: "banner",                    // "banner" | "video" | "native"
  sizes: [[300, 250]],               // or breakpoint map: { "0-767": [...], "768+": [...] }
  bidders: [
    { bidder: "appnexus", params: { placementId: 13144370 } },
    { bidder: "rubicon",  params: { accountId: 1001, siteId: 113932, zoneId: 535510 } },
  ],
  floor: { currency: "USD", value: 0.10 },
  eager: true,                       // skip lazy-load for above-fold
  refresh: { intervalSec: 30 },      // opt-in
  fallback: { type: "image", url: "...", clickUrl: "..." },
  nativeTemplate: "<div>{{title}}</div>",
  requiredAssets: ["title", "image"],
  timeouts: { auction: 1500 },
};

// Optional global identity / CMP overrides.
window.AdWrapperConfig.identity = { id5PartnerId: 1234, uid2: { email: "<sha256>" } };
window.AdWrapperConfig.environment = "webview";
window.AdWrapperConfig.cspNonce = "...";
window.AdWrapperConfig.analytics = {
  endpoint: "https://analytics.publisher.com/v1/events",
  sampleRate: 1.0,
};

// Lifecycle callbacks on the singleton (registered before or after tags execute).
window.AdWrapper.on("init",           () => {});
window.AdWrapper.on("ready",          () => {});
window.AdWrapper.on("bidRequested",   (e) => {});
window.AdWrapper.on("bidResponse",    (e) => {});
window.AdWrapper.on("auctionStart",   (e) => {});
window.AdWrapper.on("auctionEnd",     (e) => {});
window.AdWrapper.on("adRenderSuccess",(e) => {});
window.AdWrapper.on("adRenderFail",   (e) => {});
window.AdWrapper.on("timeout",        (e) => {});
window.AdWrapper.on("noFill",         (e) => {});
window.AdWrapper.on("viewable",       (e) => {});
window.AdWrapper.on("refresh",        (e) => {});
window.AdWrapper.on("error",          (e) => {});  // { code, message, context }
window.AdWrapper.on("destroy",        (e) => {});

// Lifecycle control.
window.AdWrapper.destroy("homepage_300x250_top");
window.AdWrapper.destroyAll();
```

Self-executing tag on the page:

```html
<script id="homepage_300x250_top" src="https://cdn.jsdelivr.net/npm/@nayan9229/ads@1/dist/sdk.js"></script>
```

---

## 5. Known Risks

- **jsDelivr availability**: third-party CDN with no SLA. Mitigation: publishers can pin to GitHub Packages URL directly or proxy through their own CDN.
- **Friendly iframe trust model** (Decision 24): bidder creatives can in principle read publisher DOM. Mitigation: document the model clearly; v2 SafeFrame-style isolation for publishers requiring stronger separation.
- **Prebid hosted build versioning**: hosted-build URL is the source of truth; if Prebid hosting changes its policy, we need a self-hosted fallback. Mitigation: keep a local Prebid build script in CI as a contingency.
- **6-bidder client-side QPS**: page-load bid request volume grows linearly with bidder count. Mitigation: SLO bench gates regression; S2S opt-in in v2.
- **Apache 2.0 + free CDN model**: business model depends on managed-service upsell. Mitigation: track adoption funnel from free CDN to managed services.
- **CMP detection in EU/UK**: heuristic based on timezone / `Accept-Language`. Mitigation: documented as best-effort; publishers in those regions are expected to deploy a CMP.

---

## 6. Reading Order for New Contributors

1. [PROJECT.md](./PROJECT.md) — what we are building.
2. This document — how we are building it and why.
3. `docs/quickstart.md` — publisher integration.
4. `docs/configuration.md` — full config schema.
5. `docs/bidder-setup.md` — adding/configuring bidders.
6. Source tree under `src/` — `index.ts` is the entry point.
