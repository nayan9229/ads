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
- **Prebid modules** (original v1 intent — the *built* set is narrower, see **D62**): `consentManagementTcf`, `consentManagementUsp`, `gdprEnforcement` (→ `tcfControl` in Prebid 9), `priceFloors` (~~dropped — static config floors, D10~~ → **re-added by D63**: enables the `prebidConfig.floors` config to emit `imp.bidfloor`), `currency`, `userId` (sharedId + id5Id + optional uid2 submodules), ~~`dfpAdServerVideo`~~ (dropped — no GAM, D9).
- **Identity**: sharedId + ID5 always-on, UID2 opt-in via publisher-supplied hashed email.
- **Auction mode**: client-side header bidding only. Batched multi-slot auction with 50 ms debounce after first tag execution.
- **Render**: Prebid-only direct render (no GAM/GPT). Friendly iframe (same-origin) per Prebid `pbjs.renderAd()` default.
- **Lazy loading**: IntersectionObserver with `rootMargin: "400px 0px"`. Opt-in eager mode for above-fold slots.
- **Viewability**: IAB standard (50%/1 s display, 50%/2 s video) tracked via IntersectionObserver. Emits `onViewable` callback.
- **Refresh**: opt-in **per mediaType** (D64 — config lives in `mediaTypes.<format>.refresh`; the rendered format drives the cadence, re-evaluated each impression), time-based only, minimum 30 s interval, viewability-gated, paused when tab hidden or slot out of viewport, max 10 refreshes per slot per session.
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
- ~~Dynamic floors via Prebid `priceFloors` module.~~ → **shipped (D63)**: `priceFloors` is now in the vendored build; `prebidConfig.floors` is live.
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
7. **Prebid build = SDK-owned, self-built, renamed-global bundle, VENDORED + INLINED.** ~~hosted custom-build service~~ → ~~external pinned + SRI script (D61)~~ → **superseded by D62**: the renamed-global build is now concatenated *into* the SDK's shipped bundle, not loaded as a separate external script. Still pinned (latest stable Prebid tag, no `@latest`), built with Prebid's `package.json` `globalVarName` set to `_adwPbjs` (Prebid 9 has **no** `--prebidGlobalVarName` CLI flag — the name comes from package.json) + `gulp build --modules=<lean-correct set>`, so it writes `window._adwPbjs` and never touches the host's `window.pbjs`. The built artifact is **vendored** (committed, provenance recorded) and concatenated ahead of the SDK IIFE at build time. Trade-off: SDK owns a Prebid build pipeline + a large inlined payload; no second network fetch, single SRI over the whole bundle.
8. **v1 bidder set = AppNexus, Rubicon, IX, OpenX, PubMatic, TripleLift.** Modules listed above. Trade-off: excludes Criteo / Sovrn / Amazon TAM in v1.
9. **Ad server = none. Prebid-only direct render.** No GAM, no GPT, no line items. Trade-off: no unified auction with AdX or direct-sold backfill; v2 opt-in GAM adapter.
10. **No-fill behaviour = exponential-backoff retry, then blank reserved.** 5 attempts (1 s, 2 s, 4 s, 8 s, 16 s) then blank-but-reserved container. Per-slot opt-in house-ad fallback. Static per-slot floor in config (dynamic mediaType/size floors added later — see D63). Trade-off: ~31 s retry horizon; pauses if slot leaves viewport.
11. **Retry timing = exponential backoff** as in 10. Trade-off: variable cadence vs fixed; better demand match.
12. **Lazy load default = on, `rootMargin: "400px 0px"`**. Opt-in eager via `eager: true` per slot. Trade-off: 400 px buffer balances pre-fetch vs wasted QPS.
13. **Video v1 = outstream only.** Instream / rewarded / VMAP / VPAID / podding deferred. Trade-off: smaller initial demand surface; outstream covers the majority publisher use case.
14. **Native template = HTML string with placeholders + safe escape.** Text assets injected via `textContent`, image/click URLs validated to HTTPS and routed through Prebid native click trackers. Required-asset whitelist per slot. Trade-off: no JS in templates; styling-only flexibility deemed sufficient.
15. **Consent = require publisher CMP.** SDK probes `__tcfapi` + `__uspapi`. EU/UK without CMP blocks auction; outside EU/UK proceeds without consent string. Trade-off: publisher must integrate a CMP; SDK is not in the CMP business.
16. **Analytics = pluggable, no SDK-owned backend.** Lifecycle callbacks always fire; optional beacon mode posts batched events via `sendBeacon` to a publisher-provided endpoint. Versioned event schema with sampling support. Trade-off: no built-in dashboard; matches no-infra positioning.
17. **Refresh = opt-in, time-based, viewability-gated.** Min 30 s, viewability-gated start, pauses on tab hidden / out-of-viewport, capped at 10 per slot per session. Trade-off: conservative defaults limit publisher misuse and bidder pushback. **Config location moved to per-mediaType by D64** (`mediaTypes.<format>.refresh` — the rendered format's config drives the cadence, re-evaluated each impression).
18. **Identity = sharedId + ID5 + opt-in UID2.** First-party cookie storage, 1-year expiry, consent-gated. Trade-off: UID2 only useful for logged-in cohort; LiveRamp deferred.
19. **Build = ES2017, IIFE primary, SPLIT size budget.** ~~single 30 KB gz cap~~ — amended by D62 once Prebid is inlined. Two separate budgets gated on the *pre-concat* inputs: **SDK core ≤ 30 KB gz** (`dist/pubads.core.js`, enforced by `check-bundle-size.mjs`) + a **separate Prebid-artifact budget** (the vendored renamed-global bundle, set empirically after first build). The shipped files (`dist/pubads.mini.js` IIFE + `dist/pubads.mini.esm.js` ESM) are the concatenation of both and carry a whole-bundle SRI. External source maps. Trade-off: no IE11; shipped bundle is now Prebid-sized (~10× the SDK core), justified by single-artifact delivery + no external Prebid fetch.
20. **Error model = typed enum codes + per-slot isolation.** Throws on programmer error, returns Promise<Result> for runtime errors. User callbacks wrapped in try/catch. Console verbosity gated by `debug: true`. No SDK-owned error reporting service. Trade-off: publisher owns telemetry pipeline.
21. **Testing = Jest (unit + integration) + Playwright (E2E).** Mock bidder adapter with scenario toggles. CI smoke = F1/F4/F5; nightly full matrix + load test. Trade-off: nightly load not gating PRs.
22. **Distribution = GitHub Packages + jsDelivr.** Pinned, floating-major, and latest URLs. SRI hashes published per release. `npm deprecate` for rollback. Trade-off: jsDelivr availability outside our control; documented for publishers.
23. **Timeouts** as in SLO table above.
24. **Banner render = friendly iframe (same-origin).** Same-origin via Prebid default. Trade-off: requires publishers to trust bidder creatives; SDK still enforces native-template escaping + URL allowlists.
25. **Responsive sizes = viewport-filtered breakpoints + render at winning bid size, reserved space default.** Per-slot breakpoint map. Container reserved at largest size in current breakpoint; smaller winner renders centred with margin. `shrinkToAdSize: true` opt-in to collapse. Trade-off: no re-auction on viewport resize in v1.
26. **SPA cleanup = explicit API.** `AdWrapper.destroy(slotId)` and `AdWrapper.destroyAll()`. Idempotent re-init detects re-mounted slot IDs and auto-tears-down + re-inits. Trade-off: publisher must wire cleanup into framework hooks.
27. **CSP = documented requirements + optional nonce.** Minimum directives documented; `unsafe-inline` styles required; `unsafe-eval` not required. `securitypolicyviolation` listener active under `debug: true`. Trade-off: strict-CSP publishers incompatible with programmatic ads in general.
28. **SLOs** as in table above.
29. **Init order = sync execution, immediate container injection, parallel dependency load, gated auction trigger.** Auction trigger requires Prebid ready + eager-or-in-viewport + consent resolved + 50 ms debounce. Late-arriving tags (infinite scroll) join the queue. Trade-off: requires sync script tags. **Amended by D62:** Prebid is no longer async-loaded in parallel — it is inlined and self-executes synchronously up front (its IIFE runs before our `init()`), so `window._adwPbjs` is ready immediately. IMA + identity-resolver remain external + parallel.
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
42. **Slot config schema is mediaType-nested** — format-specific fields live inside `mediaTypes.<format>` (`banner.sizes`, `banner.shrinkToAdSize`, `banner.refresh`, `native.template`, `native.requiredAssets`, `video.context`, `video.playerSize`, `video.mimes`, `video.refresh`, …). Cross-cutting fields (`bidders`, `eager`, `fallback`) live at slot root. `refresh` moved from slot root to per-mediaType by **D64**. Mirrors Prebid's own adUnit shape.
43. **IMA load is config-conditional + parallel** — refines D29. Bootstrap scans the registered config; if any slot declares `mediaTypes.video`, IMA loader fires immediately in parallel with Prebid. Banner-only sites pay zero IMA bytes.
44. **Default dependency URLs** — IMA src hardcoded to `https://imasdk.googleapis.com/js/sdkloader/ima3.js` (Google's canonical CDN; never overridden). Prebid src — **superseded by D62**: there is no default Prebid URL anymore. Prebid is inlined (D7/D62), so `prebidSrc` becomes **optional and override-only** — when omitted, `loadPrebid` resolves the already-present inlined `window._adwPbjs`; when supplied, it falls back to the legacy inject/onload/timeout path (escape hatch for publishers pointing at their own renamed-global build).
45. **Reuse pre-existing globals** — **amended by D61 (Prebid carve-out).** Bootstrap still detects and reuses `window.google.ima` and `window.OpenRTBIdentityResolver` (genuinely shared single-instance globals). It **no longer reuses `window.pbjs`**: reusing the host's Prebid meant the host's custom build often lacked the SDK's required adapters (PubMatic, Magnite/`rubicon`) → "adapter not found" at auction. The SDK now always self-loads its own renamed-global Prebid (D7/D61), so it never overwrites *or depends on* the host `window.pbjs`.
46. **IMA failure → pre-auction strip** — when `loadIMA()` rejects (5 s timeout per D23 or `onerror`), bootstrap sets an `imaReady: false` flag. Orchestrator filters `mediaTypes.video` out of every queued slot before `addAdUnits`. Banner-only auction proceeds. Emits `error` event with `E_IMA_LOAD_FAIL` once at bootstrap.
47. **Per-slot IMA-readiness gate on video/mixed slots** — `SlotLifecycle.start()` for any slot declaring `mediaTypes.video` waits for the IMA load promise to settle (resolve OR reject) before transitioning to `bidding`. Banner-only slots are unaffected and auction immediately on Prebid-ready. Worst-case wait = IMA timeout (5 s).
48. **Identity = augment, not replace** — refines D18. SDK keeps its existing `IdentityResolver` class (Prebid `userSync.userIds[]` path: sharedId/ID5/UID2 with scheduled refresh) AND adds an `identity-resolver` runtime path (cookie-jar reader emitting OpenRTB `user.eids[]` + `user.buyeruid`, four-tier fallback). Both paths run in parallel; SDK merges their output in-memory before a single `pbjs.setConfig({ ortb2 })` push pre-auction. See `docs/adr/0001-identity-resolver-augment.md`. Trade-off: two code paths and one extra runtime dep, in exchange for ~15+ vendor cookies covered (vs SDK-native 3) without losing Prebid's storage hygiene.
49. **Identity signal precedence** — when both identity paths emit conflicting values: (a) `user.eids[]` is unioned by `source` URI with the resolver value winning; (b) `user.buyeruid` is resolver-only; (c) `regs.ext.gdpr` / `regs.ext.us_privacy` / `user.consent` come from `ConsentManager` (canonical CMP), with resolver's reads used only as fallback when `ConsentManager` is disabled. ConsentManager `blocked: true` strips `eids` + `buyeruid` from the push but always forwards `regs.*` consent flags so bidders see the denial state.
50. **Identity gate = block first auction up to timeoutMs, anonymous fallback** — bootstrap preloads the identity-resolver runtime when `identityResolver.enabled === true`, in parallel with Prebid (mirrors D43). Orchestrator's first `flush()` awaits the resolver promise up to `identityResolver.timeoutMs` (default 1000 ms); on resolve, signals are cached for the session; on reject/timeout, SDK proceeds anonymous, emits `error` event `E_IDENTITY_LOAD_FAIL` once, and subsequent auctions reuse the cached `null` (no per-batch retry mid-session).
51. **Identity provider config = dedicated top-level block** — refines D18. `BootstrapOptions.identity` (Prebid userId modules: `id5PartnerId`, `uid2.email`) remains unchanged. New sibling `BootstrapOptions.identityResolver: { enabled, src?, version?, deviceIdCookieName?, tiers?, timeoutMs? }` controls the identity-resolver runtime. Default `src` is `https://cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.0/dist/index.umd.js`. No SRI verification in v1; tracked as v2 hardening.
52. **First-party data passthrough = `schain` + `ortb2`** — refines D7/D8. `BootstrapOptions.schain` accepts an IAB SupplyChain object (`ver: "1.0"`, `complete: 0|1`, non-empty `nodes[]` with `asi`/`sid`/`hp`) validated at bootstrap and forwarded verbatim via `pbjs.setConfig({ schain })`. `BootstrapOptions.ortb2` is a loose `Record<string, unknown>` passthrough forwarded once after Prebid load via `pbjs.setConfig({ ortb2 })`. SDK does NOT introspect `ortb2`; Prebid auto-derived `site.domain` + `site.page` survive (do not override). Trade-off: many SSPs (TripleLift, Magnite, OpenX) filter untrusted supply without `schain`; first-party site context lifts contextual demand match rates.
53. **Explicit container = opt-in per-slot, publisher owns sizing** — refines D6. Per-slot config accepts an optional `container` string (element ID). When present, `DomInjector` uses `document.getElementById(container)` as the ad surface directly — no sibling div is injected, no inline `width`/`height`/`display` styles are applied, and `data-adwrapper-slot` is set on the provided element for internal tracking. If the ID does not resolve to a DOM element, the SDK emits `error` (`E_CONFIG_INVALID`) and falls back to the default sibling-div path. On `destroy()`, the SDK clears the provided div's contents (it does not `remove()` an element it did not create). Default sibling-injection path (D6) is unchanged for slots that omit `container`.
54. **New Relic Browser sink = publisher-config, no shipped NR SDK bytes** — extends D16/D20. New optional `BootstrapOptions.newrelic = { licenseKey, applicationID, accountID?, beacon?, errorBeacon?, agentSrc?, sampleRate?, enabled? }`. When set, SDK subscribes to the same `FORWARDED_EVENTS` (+ the `error` event) that already feed the `analytics.endpoint` beacon. SDK does NOT ship the New Relic Browser agent — it either reuses an existing `window.newrelic` (publisher installed NR snippet in `<head>`) or, as a fallback, sets `window.NREUM = { loader_config, info, init }` from the supplied config and async-injects the NR loader (default `https://js-agent.newrelic.com/nr-loader-spa-current.min.js`). Events fired before the agent loads are queued in a 50-entry FIFO; on load the queue flushes; on load failure the queue is silently dropped (publisher's analytics beacon still runs). License key is never embedded in SDK source — publisher passes it in `init()`. OpenTelemetry browser SDK was rejected: ~25–40 KB gz vs 30 KB total cap. See `docs/adr/0002-newrelic-browser-sink.md`.
55. **NR sink = ad-lifecycle PageActions only, no page-level NR data** — refines D54. When the SDK injects the NR loader, the seeded `NREUM.init` block disables every NR auto-feature: `ajax`, `jserrors`, `metrics`, `page_view_event`, `page_view_timing`, `session_replay`, `session_trace`, `spa`, `distributed_tracing` are all `enabled: false`; only `page_action` remains on. The agent forwards only `adwrapper_*` PageActions emitted by the sink and never reports the publisher's page views, fetch/XHR calls, uncaught JS errors, web-vitals, or session traces. The sink itself routes 100 % of its output through `newrelic.addPageAction("adwrapper_" + event, attrs)` — including SDK error events as `adwrapper_error` PageActions (`{ code, message, slotId?, sessionId }`) — so the NR Browser agent's `jserrors` feature can stay disabled without losing SDK error visibility. NRQL queries against `adwrapper_*` actions are the canonical view; the NR Errors UI is intentionally unused. Note: if a publisher's own NR snippet is already present in `<head>` (sink reuses it instead of injecting), this lockdown does NOT apply — publisher's pre-existing NR config governs everything except the SDK's own emissions.
56. **NR sink attribute allowlist + cpm bucketing** — refines D54. NR forwarder enforces a hard-coded per-event attribute allowlist before emission; identifier-class fields (`eids`, `deviceId`, `userId`) and any unlisted attributes are dropped. `cpm` numeric values are bucketed to `Math.floor(cpm * 4) / 4` (0.25 increments) and emitted as `cpm_bucket` — never raw — to limit cardinality and avoid leaking exact prices into a third-party telemetry vendor. Error events bypass `sampleRate` (always 100 %); all other events share one session-coherent sample decision (same RNG/sessionId pattern as `AnalyticsEmitter`) so a session is either fully sampled-in or fully sampled-out across the page. All forwarded events map to `newrelic.addPageAction("adwrapper_" + event, attrs)`; missing `addPageAction` on the active NR agent (e.g. `lite` agent without PageActions) is a silent skip.
59. **`adSkipped` event = user-initiated skip signal, video-only** — new `LifecycleEvent` on `CallbackRegistry`. Emitted when the IMA SDK fires `SKIPPED` (user clicks the skip button). Payload: `{ slotId, mediaType: "video" }`. Does NOT fire `viewable` or `adComplete` — skip is early termination, not completion or IAB-viewable engagement; conflating the two would incorrectly trigger viewability-gated refresh. Added to `FORWARDED_EVENTS` (analytics beacon + NR sink). Named `adSkipped` (not `skip`) to stay consistent with the `adRenderSuccess`/`adRenderFail`/`adComplete` prefix pattern for format-level ad lifecycle events.
58. **`adComplete` event = ad-lifecycle completion signal, format-specific trigger** — new `LifecycleEvent` on `CallbackRegistry`. For video: emitted immediately after the IMA SDK fires `COMPLETE` (clean playback end only; errors and skips do not trigger it). For banner: emitted after a configurable `adCompleteDelayMs` (default 10 000 ms) following the banner render; when the rendered mediaType has `refresh` configured (per-mediaType, D64), the timer starts only after the last refresh cycle renders (i.e., after `onCapReached` sets the flag and the next `onAuctionWon` run fires the timer). Timer is cleared on `destroy()`. Payload: `{ slotId, mediaType: "banner" | "video" }`. Added to `FORWARDED_EVENTS` (analytics beacon + NR sink). Named `adComplete`, not `onDestroy`, to avoid collision with the existing `destroy` event which signals slot teardown. Trade-off accepted: banner trigger is time-based rather than viewability-based — consistent with publisher intent for an ad-display-window signal distinct from IAB viewability.
57. **`bidder_config` event = per-slot bidder snapshot at auction start** — new lifecycle event on `CallbackRegistry`. `SlotLifecycle.enqueueInitial()` fires it once after lazy/consent gating, before `pbjs.requestBids`. Payload: `{ slotId, bidder_count, bidder_names (CSV), bidders_json }`. `bidders_json` is `JSON.stringify` of `[{ bidder, params }]` where params have been run through `normalizeBidderParams` — non-primitives nested-stringified, and keys in a PII denylist (`email`, `hashedEmail`, `sha256email`, `sha256_email`, `uid2`, `uid2_token`, `userId`, `user_id`, `deviceId`, `device_id`, `ifa`, `idfa`, `gaid`, `eids`, `ip`, `tcString`, `gdprConsent`, `consent`, `usp`, `uspString`, `us_privacy`) dropped. Hard length cap 4000 chars on `bidders_json`. Event does NOT re-fire on `refresh` (bidders don't change mid-session). Added to `FORWARDED_EVENTS` so it flows through both the publisher analytics beacon and the NR sink — letting publishers query `FROM PageAction WHERE actionName = 'adwrapper_bidder_config' FACET bidder_names` in NRQL to see which adapters ran where.
60. **Shadow-DOM slot registration = explicit `registerSlot(slotId, containerEl)`** — refines D6/D53. The `document.currentScript` auto-init path (D6) cannot serve hosts that mount slots inside a Shadow DOM. Per the HTML spec, `document.currentScript` is **null** for any `<script>` whose root is a shadow root (the "execute the script element" step only sets `currentScript` when the script's root is *not* a shadow root), so a self-executing tag placed inside a shadow root never calls `registerScript`. Conversely, when the slot tag sits in the main document but the container is built later inside an open shadow root, neither `getElementById` nor `scriptEl.getRootNode()` can reach it (`getRootNode()` resolves the *script's* tree, not the container's), and a document-level `MutationObserver` cannot observe DOM mutations inside a shadow tree — so neither auto-detection nor DOM-walking reliably resolves a shadow-rooted, late-mounted container. New public method `registerSlot(slotId: string, containerEl: HTMLElement): Promise<void>` lets the host hand the SDK the container element directly from its framework mount hook (push, not pull — the host is the only party that knows when the element exists). Reads `AdWrapperConfig[slotId]` (throws `ConfigError` if absent, like `registerScript`); treats `containerEl` as a publisher-owned surface (tracked in `publisherContainers`, so `destroy` clears `innerHTML` rather than `remove()`, per D53); idempotent on re-mount (`destroy`-then-register, per D26); joins the same 50 ms batched-auction queue (D29). `containerEl` travels as a method argument only — the `config.container` *string* (element ID, D53) and its registry validation are unchanged; the config registry never holds a DOM handle. Throws on a non-Element `containerEl` (programmer error, D20). Closed shadow roots are unsupported (the host must pass the element; the SDK cannot reach a closed root). See `docs/adr/0003-shadow-dom-slot-registration.md`.

61. **Prebid = always self-load an isolated, renamed-global instance; never reuse host `window.pbjs`** — reverses D45's Prebid reuse and refines D7/D44. Root cause of the field bug: on a host page that already runs Prebid, the SDK reused `window.pbjs` (D45) whose custom build bundled only the host's adapters — so PubMatic + Magnite (`rubicon`) were "not found" at `requestBids`; standalone pages worked because the SDK's own `not-for-prod` build bundled every adapter. Resolution: the SDK **always** loads its own pinned Prebid built with a **custom global var name** (`_adwPbjs`, D7) and drives auctions through its private internal handle (`pbjsCached`), never `window.pbjs`. Prebid adapters are compile-time-bundled with no public runtime-registration API (`pbjs` exposes no `registerBidder`; `aliasBidder` only aliases already-installed adapters), so "inject the missing adapters into the host's Prebid" is not achievable — a second isolated instance is the only correct path. Render stays clean (Prebid-only, no GAM — D9). **Sync isolation:** the global rename isolates the JS API but not network/cookie side effects; with two live cores both would fire `userSync`/cookie-syncs/CMP. So when a host `window.pbjs` is detected at config time, the SDK's instance sets `userSync.syncEnabled:false` and defers identity to the host. Detection is best-effort via the synchronous host `pbjs` stub (`que` array); fully-async host Prebid with no early stub is a small false-negative window (SDK runs its own syncs). IMA + identity-resolver reuse (D45) unchanged. Trade-off: always ships a full Prebid (extra bytes even when the host has one) and a second core's syncs are suppressed (possible match-rate cost for SDK bidders) in exchange for a guaranteed adapter set and zero host-`pbjs` impact. See `docs/adr/0004-isolated-renamed-prebid-instance.md`. **Delivery superseded by D62:** the renamed-global instance is now *inlined* into the bundle rather than loaded as an external pinned+SRI script. The isolation guarantee + sync-suppression logic from this decision are unchanged; only how the bundle reaches the page changed.

62. **Prebid = vendored, lean-built, and inlined into the shipped bundle** — supersedes the external-delivery half of D7/D44/D61 and ADR-0004; amends D19/D29. The renamed-global Prebid build (`_adwPbjs`, D61) is **concatenated into the SDK's shipped IIFE *and* ESM bundles** rather than fetched as a separate external script. **Source:** the official Prebid.js repo at the latest stable tag (pinned **9.53.5**), built once by setting Prebid `package.json` `globalVarName: "_adwPbjs"` (no `--prebidGlobalVarName` CLI flag exists in Prebid 9) then `gulp build --modules=<lean-correct set>`, with the artifact **vendored** (committed, provenance in `vendor/PREBID-BUILD.md`: tag, exact command, module list, date, sha384). **Lean-correct module set:** the six v1 bidders (D8: appnexus, rubicon, ix, openx, pubmatic, triplelift) + `userId{sharedIdSystem,id5IdSystem,uid2IdSystem}` + `consentManagementTcf` + `consentManagementUsp` + `tcfControl` (the Prebid-9 name for the former `gdprEnforcement` activity-control module) + `currency`. **Dropped as provably unused:** `dfpAdServerVideo` (no GAM — D9; `VideoRenderer` passes `vastUrl`/`vastXml` straight to IMA). (`priceFloors` was also dropped here — since **re-added by D63** to make `prebidConfig.floors` emit `imp.bidfloor`.) `consentManagement*` + `currency` are kept despite not being called by SDK code, for bidder consent-string propagation/storage gating and correct cross-currency winner ranking inside Prebid. **Build wiring:** rollup emits SDK core to an intermediate name (`dist/pubads.core.*`), gated ≤ 30 KB gz; the vendored artifact is gated by its own budget; a post-rollup raw concat (Prebid IIFE first) produces `dist/pubads.mini.*`; `compute-sri.mjs` hashes the final files. **Loader:** `loadPrebid` short-circuits on the pre-present inlined `_adwPbjs`; the inject path survives only as a `prebidSrc` override (D44). **Maintenance:** pinned/vendored Prebid gets no auto-updates — rebuild + re-vendor + recompute SRI + bump on any Prebid security advisory touching our modules/bidders, plus a quarterly stable-release review. Trade-off: large inlined payload + manual update burden, in exchange for single-artifact delivery, no external Prebid fetch/availability risk, and one whole-bundle SRI. ESM consumers who already ship Prebid get a duplicate. See `docs/adr/0005-vendored-inlined-prebid-bundle.md`.
63. **`priceFloors` added to the vendored Prebid build** — reverses the `priceFloors` exclusion in D10/D62/ADR-0005; amends the D62 module set. The publisher config surface `AdWrapperOptions.prebidConfig.floors` (forwarded verbatim to `pbjs.setConfig` in `bootstrap.ts`) was a silent no-op because the vendored build omitted the `priceFloors` module — so Prebid never installed the `getFloor()` auction hook and adapters emitted `imp.bidfloorcur` but no `imp.bidfloor`. Fix: add `priceFloors` to the `gulp build --modules=` list, re-vendor + recompute SRI. No SDK code change (forwarding already existed). Makes `prebidConfig.floors` (incl. mediaType/size-keyed models + `enforcement`) live for every adapter that calls `bidRequest.getFloor()` (PubMatic, Rubicon, AppNexus, …). Trade-off: floor enforcement can reduce fill if floors are set too high (publisher-owned values); +few KB gz to the vendored artifact; one more module on the manual re-vendor surface. Per-bidder param floors (`rubicon.params.floor`, `pubmatic.params.kadfloor`, `appnexus.params.reserve`) remain as a flat-floor fallback but cannot express the mediaType-keyed model. See `docs/adr/0006-add-pricefloors-module.md`.
64. **Refresh config moved from slot-root to per-mediaType** — relocates the `refresh` field (D17) from `ValidatedSlotConfig` into each `mediaTypes.<format>` (`banner.refresh`, `video.refresh`, `native.refresh`); reverses the slot-root placement in D42. **Cadence follows the rendered mediaType:** a slot renders one winning creative at a time (highest CPM across formats), so `SlotLifecycle` records the winning bid's mediaType (`onAuctionWon`) and reads that format's `refresh` for both the refresh scheduler and the adComplete gate. **Re-evaluated each impression:** because a refreshed auction can hand a different format the win, the scheduler's interval is retuned per impression via `RefreshScheduler.updateInterval(ms)` — which resets the countdown to the new interval from now while preserving the session-cap fire count (so a mediaType switch never resets the cap). If the rendered mediaType has no `refresh`, the slot stops refreshing while that creative shows (a running scheduler is cancelled). Validation (min-interval floor from `minRefreshIntervalSec`, sessionCap ≥ 1) is unchanged, just applied per-mediaType with `mediaTypes.<format>.refresh.*` error fields. Trade-off: a slot with mixed formats can change refresh rate between impressions and can go dormant if a no-refresh format wins — intended, since cadence is a property of what's actually on screen. See `docs/adr/0007-per-mediatype-refresh.md`.

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
  // refresh is opt-in and per-mediaType (D64): mediaTypes.<format>.refresh,
  // e.g. mediaTypes.banner.refresh = { intervalSec: 30 }. The rendered format
  // drives the cadence, re-evaluated each impression.
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
window.AdWrapper.on("adComplete",     (e) => {});  // { slotId, mediaType: "banner" | "video" }
window.AdWrapper.on("adSkipped",      (e) => {});  // { slotId, mediaType: "video" }
window.AdWrapper.on("error",          (e) => {});  // { code, message, context }
window.AdWrapper.on("destroy",        (e) => {});

// Lifecycle control.
window.AdWrapper.destroy("homepage_300x250_top");
window.AdWrapper.destroyAll();
```

Self-executing tag on the page:

```html
<script id="homepage_300x250_top" src="https://cdn.jsdelivr.net/npm/@nayan9229/ads@1/dist/pubads.mini.js"></script>
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
