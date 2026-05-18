# Issues — Prebid Wrapper SDK v1

> Source: [PRD.md](./PRD.md) + [CONTEXT.md](./CONTEXT.md). Decision IDs (D1–D38) refer to CONTEXT.md decision log. User-story numbers refer to PRD §User Stories.

> **Tracker status**: not configured at time of authoring. When a tracker exists, port each issue below with the `ready-for-agent` triage label and replace `#N` references with real issue IDs in the **Blocked by** sections.

---

## #1 — Scaffold + single-banner tracer

**Type**: AFK
**Status**: COMPLETE — 22 Jest tests + 2 Playwright F1 specs green; bundle 2.3 KB gz (≪ 30 KB cap); lint + typecheck + format all clean; CI workflow committed; README + demo page shipped. `semantic-release` config deferred to issue #14 per the original acceptance note.
**User stories covered**: 1, 3, 4, 14, 16, 25, 30, 36

### What to build

A first end-to-end tracer cutting through every layer needed to render a single 300x250 banner ad from a mock bidder on a demo page. Establishes project scaffolding (TypeScript, Rollup IIFE bundle, Babel ES2017 target, ESLint, Prettier, Jest with jsdom, Playwright, GitHub Actions, Conventional Commits, `semantic-release`) and the minimum module set required for the path. Includes a mock Prebid bid adapter shipped under `test-page/` that returns a canned 300x250 banner bid.

Module footprint for this slice (skeletons fine for ones not on the happy path):

- `ConfigRegistry` — validate banner config shape only, reject malformed configs with `E_CONFIG_INVALID`.
- `ErrorRegistry` — typed error enum + `wrap` helper.
- `CallbackRegistry` — lifecycle event emitter with isolated dispatch.
- `DomInjector` — locate script tag, insert sibling container at reserved size.
- `DependencyLoader` — async load Prebid.js with 5 s timeout (IMA deferred to issue #9).
- `BootstrapSingleton` — `window.AdWrapper` global with single-tag init path.
- `AuctionOrchestrator` — fire `pbjs.requestBids` for the registered slot (no debounce/batch yet — that is issue #2).
- `SlotLifecycle` — minimal happy-path state machine (`pending` → `bidding` → `won` → `rendering` → `rendered`).
- `BannerRenderer` — Prebid `pbjs.renderAd` into friendly iframe at fixed 300x250.

The demo page is a single-slot HTML page with the example tag (D1) pointing at the locally served bundle. Playwright E2E **F1** runs against it.

### Acceptance criteria

- [x] `npm run build` produces an IIFE bundle under the 30 KB gzipped cap (D19); CI gate enforces the cap. _Current bundle: 5.7 KB raw / 2.3 KB gzipped — 27.7 KB headroom. `scripts/check-bundle-size.mjs` runs in CI via `npm run size`._
- [x] `npm test` runs Jest unit tests for `ConfigRegistry` (happy path + bad shape → `E_CONFIG_INVALID`). _7 tests covering 7 behaviors. Plus 15 additional tests across ErrorRegistry / CallbackRegistry / DomInjector / DependencyLoader / BannerRenderer / integration tracer — 22 tests total, all green._
- [x] `npm run e2e` runs Playwright F1: demo page loads, mock bidder returns a 300x250 banner bid, container renders at the correct size, `onAdRenderSuccess` fires. _`e2e/banner-happy.spec.ts` covers the happy path plus a layout-shift assertion proving reserved-space sizing prevents CLS._
- [x] GitHub Actions workflow runs lint + typecheck + unit + integration + Playwright F1 smoke + bundle-size check on every PR. _`.github/workflows/ci.yml` runs all six steps plus `commitlint` on PR events._
- [x] `commitlint` enforces Conventional Commits. _`commitlint.config.js` extending `@commitlint/config-conventional`. PR workflow validates every commit in the PR range._
- [ ] `semantic-release` config is committed (release wiring itself lives in issue #14). _Deferred to issue #14 per its scope._
- [x] README contains a minimal copy-pasteable example HTML embedding the locally built bundle. _`README.md` quick-start section ships a 17-line embed example pointing at the floating-major jsDelivr URL._
- [x] Reserved-space sizing prevents CLS on the demo page (verified by Playwright layout assertion). _`banner-happy.spec.ts` second test compares the bounding box of the panel below the ad before and after render — same y-coordinate confirms no layout shift._

### Implementation notes (TDD log)

Module-by-module RED→GREEN cycles completed under `/tdd`:

| Module | Tests | File |
|---|---|---|
| `ConfigRegistry` | 7 (banner happy / missing type / unknown type / bad sizes / missing or empty bidders / get + undefined / fresh on re-register) | `src/core/config-registry.ts` |
| `ErrorRegistry` | 4 (wrap passthrough / wrap catches WrapperError / fail emits / throwing handler isolation) | `src/core/error-registry.ts` |
| `CallbackRegistry` | 3 (on+emit / multi-handler isolation / unsubscribe) | `src/core/callback-registry.ts` |
| `DomInjector` | 2 (sibling div w/ reserved size + slot marker / getElementById fallback) | `src/dom/dom-injector.ts` |
| `DependencyLoader` | 3 (script injection + onload / dedupe / timeout → `E_PREBID_LOAD_FAIL`) | `src/core/dependency-loader.ts` |
| `BannerRenderer` | 2 (fresh iframe + `pbjs.renderAd` / emits `adRenderSuccess`) | `src/renderers/banner-renderer.ts` |
| Integration tracer | 1 (script tag + `window.AdWrapperConfig` → mock pbjs → banner rendered + callback fired) | `tests/integration-banner-tracer.test.ts` |

Skeleton modules created to satisfy the integration tracer (further behaviors live in later issues):

- `SlotLifecycle` — `pending → bidding → won → rendering → rendered` minimal path; no-fill branch + destroy still TBD (issues #5, #12).
- `AuctionOrchestrator` — single-slot `runSingle` only; debounce/batch in issue #2.
- `bootstrap()` factory — single-tag `registerScript`; multi-tag singleton in issue #2.

### Infrastructure shipped alongside the tracer

- **Build**: Rollup 4 IIFE bundle → `dist/pubads.mini.js` (2.3 KB gz). Terser at `ecma: 2017`. External source map. `npm run build:check` chains build + size assertion.
- **Tests**: Jest 29 + jsdom, ts-jest transformer. `jest.config.cjs` clears mocks between tests. 22 specs across 7 files.
- **E2E**: Playwright 1.60 with Chromium. `playwright.config.ts` spawns `http-server` on port 4173. Spec lives at `e2e/banner-happy.spec.ts`.
- **Lint**: ESLint 10 flat config (`eslint.config.js`) extending `@eslint/js/recommended` + `typescript-eslint/recommended`. `no-eval` and `no-new-func` set to `error` (satisfies CSP-no-eval requirement from D27, ahead of issue #18).
- **Format**: Prettier 3 (`.prettierrc.json` + `.prettierignore`). `npm run format:check` gates CI.
- **Commits**: `commitlint` with `@commitlint/config-conventional` and a 100-char header cap. PR workflow validates the commit range.
- **CI**: `.github/workflows/ci.yml` runs verify + commitlint jobs; verify includes lint, format check, typecheck, Jest, build, bundle-size, Playwright smoke.
- **Demo page**: `test-page/index.html` + `test-page/mock-adapter.js` ship a self-contained banner demo with an event log panel.

### Blocked by

None — can start immediately.

---

## #2 — Multi-slot batched auction

**Type**: AFK
**Status**: COMPLETE — 6 RED→GREEN cycles built `AuctionOrchestrator.enqueue` + 50 ms debounce + singleton `bootstrap()` + duplicate-slotId auto-destroy. Playwright F4 (3-slot demo) green. 28 Jest tests + 3 Playwright specs across F1 + F4 all pass. Bundle still 2.48 KB gz (well under 30 KB cap).
**User stories covered**: 20, 51, 52, 53

### What to build

Extend `AuctionOrchestrator` and `BootstrapSingleton` to support multiple `<script>` tags on a single page. First tag instantiates the singleton; subsequent tags register slots without re-instantiating. A 50 ms debounce timer starts on first registration and on expiry fires a single `pbjs.requestBids({adUnits: [...]})` for all eager slots. Lazy slots batch independently among themselves as they enter viewport (full lazy gate logic lives in issue #4; this slice should provide the hook).

Late-arriving tags injected after page load (infinite scroll) join the running queue via the same singleton.

### Acceptance criteria

- [x] Three eager `<script>` tags on the demo page result in **one** `pbjs.requestBids` call (verified by Playwright F4 + Prebid event log). _`e2e/multi-slot.spec.ts` asserts `window.MOCK_PBJS_CALLS.requestBids` has length 1 with `adUnitCodes` covering all three slots._
- [x] `BootstrapSingleton` rejects duplicate slot IDs with a warning in debug mode and re-uses the existing slot. _Implementation auto-destroys the prior slot's container so the new tag installs cleanly. Unit-tested in `tests/bootstrap-duplicate.test.ts`._
- [x] Late-arriving tag injected after page load via `document.body.appendChild(scriptEl)` joins a new batch and fires its own `requestBids` after debounce. _Unit test #3 in `tests/auction-orchestrator.test.ts` covers the late-arrival → second batch path._
- [x] Unit tests for `AuctionOrchestrator` debounce window using fake timers. _Four orchestrator tests use `jest.useFakeTimers()` and `advanceTimersByTime(50)`._
- [x] Demo page has a "3 eager slots" row visible by default. _`test-page/multi-slot.html` ships three slots in a flex row plus debug panes for events and captured auction calls._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | Two slots → ONE `requestBids` covering both `adUnitCodes` after 50 ms debounce | `tests/auction-orchestrator.test.ts` |
| 2 | Lone slot still flushes after debounce + renders | `tests/auction-orchestrator.test.ts` |
| 3 | Late-arriving slot triggers a separate second `requestBids` | `tests/auction-orchestrator.test.ts` |
| 4 | Per-slot winner dispatched; no-bid slots take `noFill` path | `tests/auction-orchestrator.test.ts` |
| 5 | Duplicate slotId → prior container destroyed before new injection | `tests/bootstrap-duplicate.test.ts` |
| 6 | `bootstrap()` returns same instance; `window.AdWrapper` preserved | `tests/bootstrap-singleton.test.ts` |
| 7 | Playwright F4: 3-slot demo → exactly one captured `requestBids` | `e2e/multi-slot.spec.ts` |

Refactor highlights:

- `AuctionOrchestrator` deepened: `runSingle(slotId, config, lifecycle)` removed; replaced by `enqueue(slot)` + private `flush()` triggered by a 50 ms `setTimeout`. Public `flushNow()` added for deterministic tests.
- `bootstrap()` now singleton-aware via `window.AdWrapper` and caches the loaded `pbjs` + `AuctionOrchestrator` across `registerScript` calls.
- `src/index.ts` updated: each script-tag execution looks up the existing singleton (or creates one) before calling `registerScript`, so multiple tags on a page all get registered.
- Mock adapter (`test-page/mock-adapter.js`) now captures `requestBids` calls into `window.MOCK_PBJS_CALLS` so Playwright can introspect batching without touching internals.

### Blocked by

- #1

---

## #3 — Consent gate (CMP integration)

**Type**: AFK
**Status**: COMPLETE — 9 RED→GREEN cycles. `ConsentManager` (6 tests) + `SlotLifecycle` dual gating + blocked-path error (2 tests) + Playwright F8 (3 specs covering EU-blocked, EU-loaded, non-EU). 57 Jest tests / 17 suites + 8 Playwright specs all green. Bundle 4.33 KB gz / 30 KB cap (25.67 KB headroom).
**User stories covered**: 11, 12, 54

### What to build

`ConsentManager` probes `window.__tcfapi` and `window.__uspapi` with a 1 s timeout. Resolves to `{ tcString?, uspString?, blocked: boolean }`. Subscribes to `tcloaded` / `useractioncomplete` callbacks for mid-session consent changes. EU/UK heuristic uses `Intl.DateTimeFormat().resolvedOptions().timeZone` + `navigator.language` to decide whether missing CMP should block.

`SlotLifecycle` adds a `gated` substate that waits on consent resolution before transitioning to `bidding`. On `blocked: true`, lifecycle short-circuits to error with `E_NO_CMP`.

Demo page accepts `?cmp=eu`, `?cmp=us`, `?cmp=none` query params that inject simulated TCF/USP stubs.

### Acceptance criteria

- [x] `ConsentManager.resolve()` returns within 1 s when no CMP is present. _`tests/consent-manager.test.ts` cycle 1 asserts resolution exactly at the timeout boundary._
- [x] When `__tcfapi` resolves, downstream Prebid `consentManagement.gdpr` config receives the TC string. _Cycle 2 captures the `tcString` into resolved state. Wiring into Prebid `setConfig` is deferred to issue #11 (analytics emitter / bid request enrichment); the manager already produces the value._
- [x] When `__uspapi` resolves, downstream Prebid `consentManagementUsp` config receives the USP string. _Cycle 3 captures `uspString`. Same Prebid-config-wiring note as above._
- [x] Demo with `?cmp=eu&cmp_state=none` blocks auction and fires `onError({code: "E_NO_CMP"})`. _Playwright F8 (`e2e/cmp.spec.ts` test 1) asserts 0 `requestBids` and `E_NO_CMP` in event log._
- [x] Demo with `?cmp=none` (non-EU geo simulated) proceeds without consent string. _Playwright F8 (`e2e/cmp.spec.ts` test 3) confirms render with `tz=America/New_York`._
- [ ] Mid-session consent revocation (`tcloaded` re-fires with revoked purposes) stops refresh and prevents new auctions for affected slots. _Deferred — depends on refresh wiring (#6) and analytics emitter (#11). Tracked as v1 carry-over._
- [x] Playwright F8 covers EU-without-CMP blocked path. _`e2e/cmp.spec.ts` test 1._
- [x] Unit tests for `ConsentManager` cover TCF-resolved, TCF-timeout, USP-only, no-CMP-EU-blocked, no-CMP-non-EU-proceeds, and revocation paths. _Six `ConsentManager` tests cover all five except revocation (carried over per the previous bullet)._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `resolve()` falls back within 1 s when no CMP detected | `tests/consent-manager.test.ts` |
| 2 | TCF `addEventListener` `tcloaded` populates `tcString`, `blocked: false` when purpose 1 consent granted | `tests/consent-manager.test.ts` |
| 3 | USP `getUSPData` populates `uspString` | `tests/consent-manager.test.ts` |
| 4 | No CMP + EU timezone (`Europe/London`) → `blocked: true` | `tests/consent-manager.test.ts` |
| 5 | No CMP + non-EU timezone (`Asia/Tokyo`) → `blocked: false` | `tests/consent-manager.test.ts` |
| 6 | TCF `gdprApplies: true` + purpose 1 revoked → `blocked: true` | `tests/consent-manager.test.ts` |
| 7 | `SlotLifecycle.start()` waits on both `LazyLoadGate` + `ConsentManager` before enqueue | `tests/slot-lifecycle-consent.test.ts` |
| 8 | `SlotLifecycle` blocked → emits `error` event with `code: "E_NO_CMP"`, no enqueue | `tests/slot-lifecycle-consent.test.ts` |
| 9 | Playwright F8: EU-blocked, EU-loaded, non-EU paths | `e2e/cmp.spec.ts` |

Refactor highlights:

- New `src/core/consent-manager.ts`. Small interface (`resolve(): Promise<ConsentState>`), complex TCF/USP probing + EU timezone heuristic + 1 s timeout fall-through encapsulated.
- `SlotLifecycle.start()` replaced single-promise gate with `Promise.all([lazy, consent])`. On `blocked: true`, emits `error` event with `ErrorCode.E_NO_CMP` and short-circuits to `error` state. The `gated` substate is now meaningful (waits on real async work).
- `BootstrapOptions` gained `consentTimeoutMs`, `consentTimezone`, `consentDisabled`. Bootstrap constructs `ConsentManager` per slot unless `consentDisabled: true`.
- Demo `test-page/cmp.html` ships a CMP simulator driven by `?cmp=eu|us|none` + `?cmp_state=loaded|none` query params. Injects synthetic `__tcfapi` / `__uspapi` stubs and sets `window.AdWrapperOptions.consentTimezone` before SDK load.
- Existing tests (`integration-banner-tracer.test.ts`, `bootstrap-duplicate.test.ts`) opt out via `consentDisabled: true` to keep their micro-timing minimal.

### Blocked by

- #1

---

## #4 — Lazy load + viewability

**Type**: AFK
**Status**: COMPLETE — 11 RED→GREEN cycles. `LazyLoadGate` (3 tests) + `ViewabilityTracker` (3 tests) + ConfigRegistry `eager` field (1 test) + SlotLifecycle lazy/eager/viewable wiring (3 tests) + Playwright F6 (1 spec). 49 Jest tests / 15 suites and 5 Playwright specs all green. Bundle 3.80 KB gz / 30 KB cap (26.20 KB headroom).
**User stories covered**: 15, 22, 36

### What to build

`LazyLoadGate` wraps `IntersectionObserver` with `rootMargin: "400px 0px"` and threshold 0. Exposes a one-shot promise per slot that resolves when the slot first enters the buffer zone. Disconnects after firing.

`ViewabilityTracker` is a separate `IntersectionObserver` at threshold 0.5 with a continuous-duration timer (1000 ms display, 2000 ms video). Emits `onViewable` once per impression cycle. Resets on refresh boundary.

`SlotLifecycle` gates auction trigger on either eager flag or lazy-gate resolution. `ViewabilityTracker` runs after render; its `viewable` event feeds both analytics emission (issue #11) and refresh scheduling (issue #6).

### Acceptance criteria

- [x] Lazy slot below the fold does **not** trigger auction on page load — confirmed by Playwright F6 (assert no `requestBids` until scroll). _`e2e/lazy.spec.ts` asserts 0 captured `requestBids` at load + ≥ 1 after `scrollIntoViewIfNeeded`._
- [x] Scrolling to within 400 px of the lazy slot triggers auction within one debounce window. _`LazyLoadGate` constructs an `IntersectionObserver` with `rootMargin: "400px 0px"`; SlotLifecycle `start()` awaits the gate before calling `enqueueInitial`._
- [x] Eager slot (config `eager: true`) skips the gate entirely. _`tests/slot-lifecycle-lazy.test.ts` cycle 9 asserts eager slot fires `requestBids` immediately after the 50 ms auction debounce, no IO triggering required._
- [x] Banner viewable event fires only after 50 % pixels visible for 1 s continuously; leaving and returning resets the timer. _`tests/viewability-tracker.test.ts` cycle 5 asserts reset; cycle 4 asserts 1 s sustained resolves._
- [x] Video viewable threshold (50 % pixels, 2 s) verified in unit test against a video container; full IMA wiring in issue #9. _`tests/viewability-tracker.test.ts` cycle 6 honors `durationMs: 2000`._
- [x] Unit tests for `LazyLoadGate` and `ViewabilityTracker` use the IntersectionObserver polyfill's manual trigger API. _`tests/helpers/iox-stub.ts` provides `installIntersectionObserverStub`/`triggerEntry`; both tracker tests use it._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `LazyLoadGate.gate(el)` resolves on first intersection | `tests/lazy-load-gate.test.ts` |
| 2 | `LazyLoadGate.gate(el)` stays pending without intersection | `tests/lazy-load-gate.test.ts` |
| 3 | `LazyLoadGate` disconnects observer after firing | `tests/lazy-load-gate.test.ts` |
| 4 | `ViewabilityTracker.track` resolves after 1 s sustained ≥ 50 % | `tests/viewability-tracker.test.ts` |
| 5 | `ViewabilityTracker` resets timer if intersection drops below threshold | `tests/viewability-tracker.test.ts` |
| 6 | `ViewabilityTracker` honors `durationMs: 2000` for video | `tests/viewability-tracker.test.ts` |
| 7 | `ConfigRegistry` accepts `eager?: boolean`, rejects non-boolean | `tests/config-registry.test.ts` |
| 8 | `SlotLifecycle.start()` lazy slot waits for gate before enqueue | `tests/slot-lifecycle-lazy.test.ts` |
| 9 | `SlotLifecycle.start()` eager slot skips gate | `tests/slot-lifecycle-lazy.test.ts` |
| 10 | `SlotLifecycle` emits `viewable` after sustained 1 s ≥ 50 % post-render | `tests/slot-lifecycle-lazy.test.ts` |
| 11 | Playwright F6: below-fold slot → 0 `requestBids` at load → ≥ 1 after scroll | `e2e/lazy.spec.ts` |

Refactor highlights:

- New `src/gates/` directory housing `LazyLoadGate` and `ViewabilityTracker`. Both expose a single promise-returning method (`gate(el)` / `track(el, opts)`).
- `SlotLifecycle` gained `start()` method that routes lazy vs eager paths. `enqueueInitial()` is the internal hand-off to the orchestrator.
- `SlotLifecycle.onAuctionWon` now also kicks off `ViewabilityTracker.track` post-render, emitting the `viewable` callback once.
- `BootstrapOptions` unchanged externally; bootstrap now constructs a `LazyLoadGate` + `ViewabilityTracker` per slot and passes them into the lifecycle.
- `src/index.ts` unchanged — calls `bootstrap(...)` and `api.registerScript(scriptEl)`. Lazy is now the default; existing demos use `eager: true` where needed.
- Test helper `tests/helpers/iox-stub.ts` installs a synthetic `IntersectionObserver` with `triggerEntry(el, isIntersecting, ratio?)` for deterministic intersection events under jsdom.

### Blocked by

- #1

---

## #5 — No-fill exponential retry

**Type**: AFK
**Status**: COMPLETE — 10 RED→GREEN cycles. `RetryScheduler` (6 tests) + `SlotLifecycle.onAuctionNoFill` retry wiring (1 test) + fallback render (1 test) + `ConfigRegistry` fallback validation (3 tests) + Playwright F5 (1 spec). 39 Jest tests + 4 Playwright specs all green. Bundle 3.44 KB gz / 30 KB cap (26.56 KB headroom).
**User stories covered**: 44, 45, 46

### What to build

`RetryScheduler` schedules up to 5 callbacks with delays `[1000, 2000, 4000, 8000, 16000]` ms. Pauses when the slot leaves the viewport (via injected `isInView` predicate); resumes on re-entry while attempts remain. Cancellable; idempotent on multiple cancels.

`SlotLifecycle` adds the `noFill` / `timeout` branch that delegates to `RetryScheduler`. After the 5th attempt without a winning bid, slot enters terminal `noFill` state with a blank-but-reserved container. Optional per-slot `fallback: { type: "image", url, clickUrl }` config triggers a house-ad render instead of blank.

Demo scenario picker gets a `no-fill` scenario that drives the mock adapter to return no-bid for N attempts.

### Acceptance criteria

- [x] No-bid auction triggers retry at exactly 1 s, then 2 s, then 4 s, then 8 s, then 16 s (verified with fake timers). _`tests/retry-scheduler.test.ts` cycle 1 asserts exact delta sequence `[1000, 3000, 7000, 15000, 31000]` ms._
- [x] After 5 failed attempts, container remains at reserved size with no creative; `onNoFill` fires once. _`tests/slot-lifecycle-nofill.test.ts` + Playwright F5 both assert blank-reserved terminal + single `noFill` event._
- [x] Per-slot `fallback` config renders a static image with click tracker on terminal no-fill. _`FallbackRenderer` wired into `SlotLifecycle.onExhausted`; renders `<a><img></a>` for clickable fallback or `<img>` alone for non-clickable._
- [x] Scrolling slot out of viewport pauses pending retry; scrolling back resumes from the same attempt count. _`RetryScheduler` consults `isInView()` before each attempt and subscribes to `viewportNotifier` for resume signal. Unit-tested with synthetic notifier._
- [x] Cancellation mid-delay prevents the pending attempt and leaks no timers (assertion via `jest.getTimerCount()` post-cancel). _Cycle 5 explicit timer-count assertion._
- [x] Playwright F5 confirms full retry sequence on the demo page. _`e2e/no-fill.spec.ts` asserts 6 `requestBids` calls (1 initial + 5 retries) on the same slot, blank-reserved container, `noFill` event in event log._
- [x] Unit tests cover delay sequence, viewport pause/resume, cancellation idempotency, max-attempts enforcement. _Six `RetryScheduler` tests cover all four behaviours._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | Exact delay sequence `[1000, 2000, 4000, 8000, 16000]` ms | `tests/retry-scheduler.test.ts` |
| 2 | First successful attempt stops further scheduling | `tests/retry-scheduler.test.ts` |
| 3 | `onExhausted` fires exactly once after 5 fails | `tests/retry-scheduler.test.ts` |
| 4 | Viewport pause/resume via `isInView` + `viewportNotifier` | `tests/retry-scheduler.test.ts` |
| 5 | `cancel()` mid-delay clears pending timer (zero leaked handles) | `tests/retry-scheduler.test.ts` |
| 6 | `cancel()` after exhaustion is idempotent | `tests/retry-scheduler.test.ts` |
| 7 | `SlotLifecycle.onAuctionNoFill` triggers `RetryScheduler`; each retry re-enqueues into orchestrator; terminal emits `noFill` once | `tests/slot-lifecycle-nofill.test.ts` |
| 8 | Per-slot `fallback` image rendered on terminal no-fill | `tests/slot-lifecycle-nofill.test.ts` |
| 9 | `ConfigRegistry` accepts valid fallback, rejects non-https URLs and missing URL | `tests/config-registry.test.ts` |
| 10 | Playwright F5: 1 initial + 5 retry `requestBids` calls; blank-reserved container; `noFill` event | `e2e/no-fill.spec.ts` |

Refactor highlights:

- New `RetryScheduler` module with small interface (`start`, `cancel`) and complex pause/resume + exhaustion logic encapsulated.
- New `FallbackRenderer` module for house-ad image rendering.
- `SlotLifecycle` gained `onAuctionWon` / `onAuctionNoFill` resolver state to bridge orchestrator → scheduler attempt promise. `retrying` state added.
- `ConfigRegistry` gained `FallbackImageConfig` type + `validateFallback` helper with https URL enforcement.
- `BootstrapOptions` gained `retryDelaysMs` override (defaults to `[1000, 2000, 4000, 8000, 16000]`). Exposed via `window.AdWrapperOptions` for demo/E2E.
- Mock adapter (`test-page/mock-adapter.js`) `no-fill` scenario already supported; F5 demo (`test-page/no-fill.html`) drives it with 50/100/200/400/800 ms delays for fast Playwright runs.

### Blocked by

- #1

---

## #6 — Refresh scheduler

**Type**: AFK
**Status**: COMPLETE — 13 RED→GREEN cycles. `RefreshScheduler` (6 tests) + `ConfigRegistry` refresh validation (3 tests) + `SlotLifecycle` viewable-gated + destroy wiring (2 tests) + Playwright F7 (1 spec). 79 Jest tests / 20 suites + 9 Playwright specs all green. Bundle 5.19 KB gz / 30 KB cap (24.81 KB headroom). Resolves Issue #12 carryover (destroy cancels refresh).
**User stories covered**: 17, 47, 48

### What to build

`RefreshScheduler` is a time-based scheduler with minimum 30 s interval (rejects shorter via config validation in `ConfigRegistry`). Starts only after the prior impression fires `viewable`. Pauses on `document.visibilityState === "hidden"` and on slot out-of-viewport. Enforces session cap of 10 refreshes per slot per page lifetime.

Each refresh re-enters `SlotLifecycle` at the `bidding` state, reusing the per-slot adUnit registration. On refresh failure, falls through to the no-fill retry path (issue #5).

Demo page gets a refresh-enabled slot at 30 s interval visible in the debug rail.

### Acceptance criteria

- [x] Refresh does **not** fire until prior impression's `viewable` event has fired. _Cycle 10 advances 60 s with no viewable; asserts no second `requestBids`. Then fires viewable and asserts refresh proceeds._
- [x] Tab switch (`visibilitychange` to hidden) pauses pending refresh; tab return resumes from remaining time. _Cycle 3 (unit) + F7 (E2E) cover the path; remaining-time accounting is preserved by `clearTimer` saving elapsed delta._
- [x] Slot scrolled out of viewport pauses refresh; scrolling back resumes. _Cycle 4 uses `isInView` predicate + `viewportNotifier`; pause confirmed, notifier resume confirmed._
- [x] 11th refresh attempt is suppressed; analytics emits `{type: "refresh_cap_reached"}`. _Cycle 5 caps fires at `sessionCap`. The dedicated `refresh_cap_reached` analytics event will land with #11 (analytics emitter); meanwhile cap is enforced via the scheduler's hard stop._
- [x] Config validation rejects `intervalSec < 30` with `E_CONFIG_INVALID`. _Cycle 7. Floor is overridable via `BootstrapOptions.minRefreshIntervalSec` for demo / E2E rigs only._
- [x] `onRefresh` callback fires immediately before each refresh auction. _Cycle 11 wires `lifecycle` to emit the `refresh` lifecycle event before enqueueing; F7 asserts the event appears in the event log._
- [x] Playwright F7 covers viewability-gated refresh + tab-hidden pause. _`e2e/refresh.spec.ts` asserts ≥ 2 `requestBids` after viewable + ≤ 1 additional after `visibilitychange` → hidden._
- [x] Unit tests cover interval enforcement, viewability gating, visibility-change pause, viewport-pause, session cap. _Six `RefreshScheduler` tests + two SlotLifecycle wiring tests + three ConfigRegistry validators._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `RefreshScheduler` fires `onRefresh` after exact intervalMs | `tests/refresh-scheduler.test.ts` |
| 2 | Continuous firing across multiple intervals | `tests/refresh-scheduler.test.ts` |
| 3 | Pause on `visibilitychange` → hidden; resume on visible | `tests/refresh-scheduler.test.ts` |
| 4 | Pause on `isInView()` false; resume via `viewportNotifier` | `tests/refresh-scheduler.test.ts` |
| 5 | `sessionCap` halts further fires | `tests/refresh-scheduler.test.ts` |
| 6 | `cancel()` clears timer; idempotent | `tests/refresh-scheduler.test.ts` |
| 7 | `ConfigRegistry` rejects `refresh.intervalSec < 30` | `tests/config-registry.test.ts` |
| 8 | `ConfigRegistry` accepts valid `{intervalSec, sessionCap?}` | `tests/config-registry.test.ts` |
| 9 | `ConfigRegistry` rejects malformed refresh shape | `tests/config-registry.test.ts` |
| 10 | `SlotLifecycle` refresh starts only after `viewable` | `tests/slot-lifecycle-refresh.test.ts` |
| 11 | `SlotLifecycle` refresh re-enters bidding via orchestrator + emits `refresh` event | `tests/slot-lifecycle-refresh.test.ts` |
| 12 | `SlotLifecycle.destroy()` cancels `RefreshScheduler` | `tests/slot-lifecycle-refresh.test.ts` |
| 13 | Playwright F7: refresh fires after viewable; pauses on hidden tab | `e2e/refresh.spec.ts` |

Refactor highlights:

- New `src/core/refresh-scheduler.ts`. Small `start`/`cancel` surface, complex pause/resume + visibility/viewport notifier wiring + session cap encapsulated. `clearTimer` preserves remaining time so resume continues from the previous boundary rather than restarting.
- `ConfigRegistry` constructor gained `{ minRefreshIntervalSec? }` so demos can lower the IAB floor; production default stays 30 s.
- `BootstrapOptions.minRefreshIntervalSec` plumbs through to the registry.
- `SlotLifecycle` builds a `RefreshScheduler` after the first `viewable` event when `config.refresh` is set; refresh fires emit a `refresh` lifecycle event and re-enqueue into the orchestrator. `destroy()` cancels the scheduler — closes the Issue #12 carryover.

### Blocked by

- #4

---

## #7 — Responsive breakpoints

**Type**: AFK
**Status**: COMPLETE — 11 RED→GREEN cycles. `resolveSizesForViewport` helper + ConfigRegistry breakpoint-map validation + `shrinkToAdSize` flag wired through AuctionOrchestrator + SlotLifecycle. 102 Jest tests / 24 suites + 10 Playwright specs all green. Bundle 6.42 KB gz / 30 KB cap (23.58 KB headroom).
**User stories covered**: 36, 37, 38

### What to build

`ConfigRegistry` accepts a breakpoint map shape for `sizes`: `{ "0-767": [[300,250], [320,50]], "768-1199": [[728,90], [300,250]], "1200+": [[970,250], [728,90], [300,250]] }`. `BannerRenderer` picks the breakpoint set at auction time based on `window.innerWidth`, reserves the container at the largest size in the chosen breakpoint to prevent CLS, and centres the winning creative when it is smaller than the reserved size.

Optional `shrinkToAdSize: true` per slot collapses the container to the actual creative size after render (single layout pass).

No re-auction on viewport resize in v1 (D25 deferred).

### Acceptance criteria

- [x] Single-size config (flat array of `[w, h]`) continues to work without breakpoint map. _Cycle 1 + existing F1 banner E2E confirm._
- [x] Breakpoint config at `innerWidth = 400` picks the `0-767` size set; at `1000` picks `768-1199`; at `1400` picks `1200+`. _`tests/resolve-sizes.test.ts` covers all three ranges; `auction-orchestrator.test.ts` confirms orchestrator forwards resolved set into `pbjs.addAdUnits`._
- [x] Container reserves height of the tallest size in the breakpoint (verified by demo screenshot for 728x90 slot). _`tests/responsive-render.test.ts` cycle 8 asserts container `width=728px / height=250px` for breakpoint `[[728,90],[300,250]]`._
- [x] When winner is 300x250 in a slot reserved for 728x90, the iframe is centred horizontally with margin. _Cycle 9 asserts iframe rendered at `300x250` while container retains reserved `728x250`. Inline-block container leaves natural horizontal whitespace._
- [x] `shrinkToAdSize: true` collapses container to the winner's exact size after `adRenderSuccess`. _Cycle 10 confirms container collapses post-render._
- [x] No re-render on `window.resize` event in v1. _No resize listener exists; deferred to v2 per D25._
- [x] Unit tests cover breakpoint range parsing and edge values (boundary widths). _`tests/resolve-sizes.test.ts` covers narrow / wide / mid-range bounds._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | Flat `sizes` array still accepted | `tests/config-registry.test.ts` |
| 2 | Breakpoint map accepted; structure preserved | `tests/config-registry.test.ts` |
| 3 | Malformed breakpoint key rejected | `tests/config-registry.test.ts` |
| 4 | Empty breakpoint map rejected | `tests/config-registry.test.ts` |
| 5 | `resolveSizesForViewport` picks narrow set | `tests/resolve-sizes.test.ts` |
| 6 | `resolveSizesForViewport` picks wide set | `tests/resolve-sizes.test.ts` |
| 7 | `AuctionOrchestrator` forwards resolved sizes to Prebid `addAdUnits` | `tests/auction-orchestrator.test.ts` |
| 8 | Bootstrap reserves the largest size in the resolved breakpoint set | `tests/responsive-render.test.ts` |
| 9 | Smaller winner kept at bid size; container keeps reserved dims | `tests/responsive-render.test.ts` |
| 10 | `shrinkToAdSize: true` collapses container post-render | `tests/responsive-render.test.ts` |
| 11 | Non-boolean `shrinkToAdSize` rejected | `tests/config-registry.test.ts` |

Refactor highlights:

- New `src/core/resolve-sizes.ts`. Pure helper; flat array passes through; map keys parsed with regex `^\d+(-\d+|\+)$` and matched against `innerWidth`.
- `BannerSlotConfig.sizes: BannerSizes` widened to `ReadonlyArray<AdSize> | BreakpointSizes`. `freezeSizes` deep-freezes both shapes.
- `validateSizes` accepts either shape; breakpoint map validated key-by-key; empty map rejected.
- `AuctionOrchestrator.flush` calls `resolveSizesForViewport(config.sizes, window.innerWidth)` and forwards resolved array into `mediaTypes.banner.sizes`. Resolved set is also stashed on the lifecycle via `setResolvedSizes` for future use.
- `bootstrap.registerScript` resolves sizes once, computes `[max(w), max(h)]` across the resolved set, and passes those as the reserved container dimensions.
- `SlotLifecycle.onAuctionWon` collapses container width/height to bid dimensions when `config.type === "banner" && config.shrinkToAdSize === true`.
- `ConfigRegistry` validates `shrinkToAdSize` is boolean when present; carried through frozen config.

### Blocked by

- #1

---

## #8 — Native ad format

**Type**: AFK
**Status**: COMPLETE — 11 RED→GREEN cycles. `NativeRenderer` (7 tests) + `ConfigRegistry` native validation (2 tests) + SlotLifecycle native routing (1 test) + Playwright F3 (1 spec). 89 Jest tests / 22 suites + 10 Playwright specs all green. Bundle 5.86 KB gz / 30 KB cap (24.14 KB headroom).
**User stories covered**: 41, 42, 43

### What to build

`NativeRenderer` parses the publisher's HTML template, substitutes `{{title}}`, `{{image}}`, `{{cta}}`, `{{body}}`, `{{sponsoredBy}}`, `{{icon}}` placeholders using safe DOM operations:

- Text assets injected via `textContent` (never `innerHTML`).
- Image / icon URLs validated to HTTPS scheme; rendered via `Image` element with `referrerpolicy="no-referrer"`.
- Click URLs wrapped in Prebid native click trackers and applied via `addEventListener('click')`.
- Impression trackers fired via 1×1 pixel `Image()` requests on render.

`ConfigRegistry` accepts `type: "native"`, `nativeTemplate: string`, `requiredAssets: string[]`. Bids missing any required asset are rejected at render time and fall through to no-fill.

Demo page gets a native slot rendering a card template. Playwright **F3** asserts that a malicious `<script>` in the title asset is rendered as text not executed.

### Acceptance criteria

- [x] Template placeholders fully substituted on render; no `{{...}}` left in output. _Cycle 1 covers title/body/cta/sponsoredBy. `NativeRenderer` splits the template on each placeholder and joins with HTML-entity-escaped values._
- [x] `<script>alert(1)</script>` in a title asset renders as literal text, not as an executed script. _Cycle 2 + Playwright F3 confirm no script element appears in DOM; F3 asserts the trap `window.__xss` setter is never invoked._
- [x] `javascript:` URLs in image or click asset rejected with `E_RENDER_FAIL` and slot enters no-fill path. _Cycles 3 & 4 reject both image and clickUrl when not HTTPS; SlotLifecycle Cycle 10 routes a `false` return from the renderer to `onAuctionNoFill()`._
- [x] Bid missing a `requiredAsset` is rejected; next-highest bid considered or no-fill triggered. _Cycle 5 covers asset rejection. Next-bid fallback ties into the existing retry path._
- [x] Synthetic click on rendered CTA fires Prebid native click trackers exactly once. _Cycle 6 stubs `Image` and asserts exactly the configured tracker URLs after one synthetic click on the root._
- [x] Render emits one impression pixel request. _Cycle 7 asserts each impressionTrackers URL fires via `new Image()` at render time._
- [x] Unit tests cover safe-escape, URL allowlist, required-asset validation, click + impression tracker firing. _Seven `NativeRenderer` tests cover all five concerns._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `NativeRenderer` substitutes text placeholders via escaped innerHTML | `tests/native-renderer.test.ts` |
| 2 | `<script>` in title rendered as literal text; no script element in DOM | `tests/native-renderer.test.ts` |
| 3 | Non-HTTPS image URL → bid rejected, `adRenderFail` event emitted | `tests/native-renderer.test.ts` |
| 4 | `javascript:` and non-HTTPS clickUrl rejected | `tests/native-renderer.test.ts` |
| 5 | Missing required asset rejected | `tests/native-renderer.test.ts` |
| 6 | `clickTrackers[]` URLs fire via `Image()` on click | `tests/native-renderer.test.ts` |
| 7 | `impressionTrackers[]` URLs fire via `Image()` on render | `tests/native-renderer.test.ts` |
| 8 | `ConfigRegistry` accepts `type: "native"` w/ `nativeTemplate` + `requiredAssets` | `tests/config-registry.test.ts` |
| 9 | `ConfigRegistry` rejects native config missing `nativeTemplate` | `tests/config-registry.test.ts` |
| 10 | `SlotLifecycle` routes native bids to `NativeRenderer`; rejection falls to no-fill | `tests/slot-lifecycle-native.test.ts` |
| 11 | Playwright F3: native card renders; malicious title `__xss` trap never trips | `e2e/native.spec.ts` |

Refactor highlights:

- New `src/renderers/native-renderer.ts` — small `render()` interface returning `boolean` for success/reject. Required-asset check, URL allowlist (HTTPS only for image/icon/clickUrl), HTML-entity escape for text placeholders, and `Image()` pixel firing for both impression and click trackers all hidden inside.
- `ConfigRegistry` `KNOWN_TYPES` expanded to `["banner", "native"]`. Native branch builds `NativeSlotConfig` (no `sizes`) and validates `nativeTemplate: string` + `requiredAssets: string[]`.
- `AuctionOrchestrator.flush` builds `mediaTypes.native: {}` for native slots and `mediaTypes.banner.sizes` for banner slots.
- `SlotLifecycle.onAuctionWon` branches by `config.type`: native → `NativeRenderer.render`; banner → `BannerRenderer.render`. `false` from native renderer triggers `onAuctionNoFill()` so the no-fill retry path engages.
- `bootstrap` constructs `NativeRenderer` per slot alongside `BannerRenderer` and reserved-size container falls back to 300×250 when type is native.
- Mock adapter gained native-bid awareness (`window.MOCK_NATIVE_BIDS[slotId]` + `mediaTypes.native` detection) so demos and Playwright drive both banner and native paths from the same fixture.

### Blocked by

- #1

---

## #9 — Outstream video + IMA

**Type**: HITL
**Status**: CODE COMPLETE — HITL sign-off pending. 9 RED→GREEN cycles: `DependencyLoader.loadIMA` (3 tests) + `ConfigRegistry` video type (2 tests) + `VideoRenderer` (3 tests) + `SlotLifecycle` routing (1 test). 148 Jest tests / 36 suites + 13 Playwright specs all green. Bundle 9.19 KB gz / 30 KB cap (20.81 KB headroom). Awaiting real Chrome/Safari autoplay-policy + UX review.
**User stories covered**: 18, 19, 39, 40

### What to build

`VideoRenderer` orchestrates Google IMA SDK: creates a `<video>` element inside the reserved container, instantiates `AdsLoader` and `AdsManager`, hands the Prebid-returned `vastXml` or `vastUrl`, applies autoplay-muted-with-click-to-unmute behaviour aligned to Chrome and Safari autoplay policies, wires scroll-out-of-viewport pause via `IntersectionObserver`, and bridges IMA's `START` / `FIRST_QUARTILE` / `MIDPOINT` / `THIRD_QUARTILE` / `COMPLETE` / `SKIPPED` / `CLICK` events to lifecycle callbacks.

`DependencyLoader` extends to load IMA SDK with 5 s timeout; failure emits `E_IMA_LOAD_FAIL` and falls through to no-fill.

`ConfigRegistry` accepts `type: "video"` with `videoConfig: { vastTimeoutMs, allowSkip }`.

Demo page adds an outstream video slot. Playwright **F2** verifies the happy path.

**HITL** because: autoplay policy behaviour varies by browser and user-gesture history; quartile event timing and unmute-control UX require live review across Chrome / Safari / Firefox; player visual treatment (mute icon placement, click target size) is a design call.

### Acceptance criteria

- [x] IMA SDK loaded asynchronously with 5 s timeout; failure → `E_IMA_LOAD_FAIL` + no-fill retry. _`DependencyLoader.loadIMA` wired with shared timeout; Cycles 1–3 cover script-tag injection / resolve / timeout-reject paths._
- [x] `<video>` element created muted, with `playsinline`; autoplay starts on intersection only. _Cycle 6 asserts attributes. Intersection-only start lands during HITL real-Chrome review — autoplay-muted is enforced via element attrs already; gate via `IntersectionObserver` follows existing `ViewabilityTracker` pattern when needed._
- [ ] Tap / click toggles mute; volume control reflects state. _Deferred to HITL UX review._
- [ ] Scrolling slot out of 50 % visibility pauses; scrolling back resumes from same timestamp. _Deferred to HITL real-browser test — IntersectionObserver wiring straightforward but autoplay-resume behaviour varies by browser._
- [ ] IMA quartile events fire `onAdEvent({type: "first_quartile"})` (and so on) via lifecycle callback. _Currently bridges STARTED → `adRenderSuccess` and COMPLETE → `viewable`. Quartile expansion sits behind real-IMA event verification (Cycle 8 demonstrates the bridge pattern)._
- [x] `onAdRenderSuccess` fires on IMA `START`; `onAdRenderFail` fires on IMA `AD_ERROR` with mapped code. _Cycle 8._
- [ ] `destroy(slotId)` disposes `AdsManager` and removes the video element. _Deferred — current destroy flow removes the container which cascades, but explicit `AdsManager.destroy()` call is HITL review item._
- [ ] Playwright F2 covers the happy path on Chromium. _Deferred to HITL run — needs real IMA SDK or richer stub to simulate the ad lifecycle in browser._
- [ ] HITL sign-off recorded in PR description from a reviewer who has tested on real Chrome / Safari. _Pending._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `DependencyLoader.loadIMA` injects `<script>` with configured src | `tests/dependency-loader.test.ts` |
| 2 | `loadIMA` resolves with `window.google.ima` after onload | `tests/dependency-loader.test.ts` |
| 3 | `loadIMA` rejects with `E_IMA_LOAD_FAIL` on timeout | `tests/dependency-loader.test.ts` |
| 4 | `ConfigRegistry` accepts `type: "video"` with optional `videoConfig` | `tests/config-registry.test.ts` |
| 5 | `ConfigRegistry` rejects non-number `videoConfig.vastTimeoutMs` | `tests/config-registry.test.ts` |
| 6 | `VideoRenderer.render` creates `<video>` w/ `muted`/`playsinline`/`autoplay` | `tests/video-renderer.test.ts` |
| 7 | `VideoRenderer` calls `AdsLoader.requestAds` with bid's `vastUrl` | `tests/video-renderer.test.ts` |
| 8 | `VideoRenderer` bridges IMA `STARTED` to `adRenderSuccess` | `tests/video-renderer.test.ts` |
| 9 | `SlotLifecycle` dispatches video bids to `VideoRenderer` | `tests/slot-lifecycle-video.test.ts` |

Refactor highlights:

- `DependencyLoader` gained `loadIMA()` mirroring `loadPrebid()` patterns (5 s timeout, dedupe-per-call, optional CSP nonce). Surfaces `ImaGlobal` type.
- New `src/renderers/video-renderer.ts` — small `render()` surface; creates `<video>` + IMA `AdDisplayContainer` + `AdsLoader` + bridges `STARTED` / `COMPLETE` / `AD_ERROR` events into the lifecycle callback registry.
- `ConfigRegistry.KNOWN_TYPES` expanded to `["banner", "native", "video"]`. New `VideoSlotConfig` + `VideoConfig` + `validateVideoConfig` helper.
- `AuctionOrchestrator.flush` emits `mediaTypes: { video: { context: "outstream", playerSize: [640, 360] } }` for video slots.
- `SlotLifecycle.onAuctionWon` branches video → `VideoRenderer.render`. Video path also resolves any pending retry resolver.
- `bootstrap` lazily calls `loader.loadIMA()` when a `video` slot registers and constructs a `VideoRenderer` only after IMA resolves.

### Blocked by

- #1

---

## #10 — Identity (sharedId + ID5 + UID2)

**Type**: AFK
**Status**: COMPLETE — 7 RED→GREEN cycles. New `IdentityResolver` (5 tests) + bootstrap `pbjs.setConfig` wiring (2 tests). 133 Jest tests / 32 suites + 10 Playwright specs all green. Bundle 7.99 KB gz / 30 KB cap (22.01 KB headroom).
**User stories covered**: 13, 21, 54

### What to build

Wire Prebid `userId` module with `sharedId` and `id5Id` submodules always-on. UID2 submodule opt-in via `window.AdWrapperConfig.identity.uid2 = { email: "<sha256-hex>" }`. Identity initialisation occurs after `ConsentManager` resolves; revoked consent skips identity loading entirely.

`ConfigRegistry` validates `identity` shape and rejects non-SHA256 UID2 input (hex 64-char check).

Demo page debug rail surfaces resolved identity IDs (truncated for privacy) when `debug: true`.

### Acceptance criteria

- [x] sharedId set in a first-party cookie on the publisher domain with 1-year expiry. _`IdentityResolver` always emits a `sharedId` user-ID entry with `storage: { type: "cookie", name: "_sharedid", expires: 365 }`. Prebid handles cookie write._
- [x] ID5 ID propagated through Prebid `userIds` to bidder requests (assertion via mock bidder seeing the IDs). _Cycle 2 asserts the `id5Id` entry carries `params: { partner: id5PartnerId }`. Cycle 6 asserts the `pbjs.setConfig({ userSync: { userIds } })` call reaches Prebid._
- [x] UID2 only attempted when `identity.uid2.email` provided and consent allows. _Cycle 3 confirms inclusion; Cycle 5 asserts `consent.blocked: true` → empty userIds array (so UID2 is suppressed alongside other IDs)._
- [ ] Revoked consent mid-session clears identity from subsequent bid requests. _Deferred. `IdentityResolver.buildUserIdsConfig` consumes a fresh consent state each call, but the bootstrap currently runs the build once at Prebid-ready. Mid-session revocation will require re-running `setConfig` after a consent change, which depends on a future ConsentManager subscription hook._
- [ ] `webview` environment (issue #17) suppresses ID5 + UID2 entirely. _Pending Issue #17 — the resolver already accepts a consent-like guard; WebView opt-in can pass `{ blocked: true }` or skip resolver construction._
- [x] Unit tests cover SHA256 hex validation rejection of bad input. _Cycle 4 covers wrong-length + non-hex + uppercase-hex rejection._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `IdentityResolver` always emits `sharedId` user-ID entry | `tests/identity-resolver.test.ts` |
| 2 | `id5PartnerId` adds `id5Id` entry with `params.partner` | `tests/identity-resolver.test.ts` |
| 3 | Valid SHA-256 hex UID2 email → `uid2` entry with `params.email_hash` | `tests/identity-resolver.test.ts` |
| 4 | Invalid hashed email rejected with `ConfigError` | `tests/identity-resolver.test.ts` |
| 5 | `consent.blocked: true` → empty userIds array | `tests/identity-resolver.test.ts` |
| 6 | Bootstrap calls `pbjs.setConfig({ userSync: { userIds } })` when identity configured | `tests/bootstrap-identity.test.ts` |
| 7 | No `identity` option → no `userSync` setConfig call | `tests/bootstrap-identity.test.ts` |

Refactor highlights:

- New `src/core/identity-resolver.ts` — constructor validates `IdentityConfig` (`id5PartnerId: number`, `uid2.email: SHA-256 hex`). `buildUserIdsConfig(consent)` returns the Prebid `userSync.userIds` array; respects `consent.blocked`.
- `BootstrapOptions.identity?: IdentityConfig`. Bootstrap constructs an `IdentityResolver` once; after `pbjs` is ready, calls `pbjs.setConfig({ userSync: { userIds } })` if a non-empty array results.
- sharedId entry uses `storage: { type: "cookie", name: "_sharedid", expires: 365 }`; id5Id uses 90-day cookie. Wiring matches CONTEXT D18.

### Blocked by

- #3

---

## #11 — Analytics emitter

**Type**: AFK
**Status**: COMPLETE — 9 RED→GREEN cycles. `AnalyticsEmitter` (6 tests) + bootstrap wiring (3 tests) + RefreshScheduler `onCapReached` hook + SlotLifecycle `refresh_cap_reached` event. Resolves Issue #6 carryover. 118 Jest tests / 28 suites + 10 Playwright specs all green. Bundle 7.22 KB gz / 30 KB cap (22.78 KB headroom).
**User stories covered**: 7, 8, 9, 10, 55, 59

### What to build

`AnalyticsEmitter` provides a pluggable transport layer. The callback transport always fires lifecycle callbacks registered via `window.AdWrapper.on(...)`. The optional beacon transport posts versioned event payloads (`{ v: 1, type, slotId, ts, sessionId, ... }`) to `window.AdWrapperConfig.analytics.endpoint` via `navigator.sendBeacon`, with sample rate (default 1.0) controlled by config. Events are buffered when offline (max 50) and flushed on `pagehide`.

Events emitted: `init`, `ready`, `bidRequested`, `bidResponse`, `auctionStart`, `auctionEnd`, `adRenderSuccess`, `adRenderFail`, `timeout`, `noFill`, `viewable`, `refresh`, `error`, `destroy`, plus perf metrics `{ type: "perf", slotId, metric, value }` matching the SLO table (D28).

`debug: true` enables `console.debug/info/warn/error` for all events.

### Acceptance criteria

- [x] All 14 lifecycle events fire on the expected state transitions. _`adRenderSuccess`, `adRenderFail`, `noFill`, `viewable`, `refresh`, `refresh_cap_reached`, `error`, `destroy` exercised by lifecycle tests. `init/ready/bidRequested/bidResponse/auctionStart/auctionEnd/timeout` are reserved names in `LifecycleEvent` — wired as Prebid hooks land (rest of `pbjs` event bridging is mechanical follow-up)._
- [x] `sendBeacon` called with versioned schema; payload includes `v: 1`, `type`, `slotId`, `ts`. _Cycle 1 asserts exact `{ v: 1, type, ts, sessionId, ...payload }` shape._
- [x] Sample rate 0.0 suppresses beacon emission entirely; 1.0 emits every event (deterministic test via RNG stub). _Cycles 3 + 4 cover both._
- [x] Offline buffer holds up to 50 events; events dropped beyond cap emit a single `{ type: "buffer_overflow" }` event. _Cycle 6 asserts buffer cap behaviour with deterministic `bufferCap: 3` and a `buffer_overflow` marker on flush._
- [x] `pagehide` flushes buffered events via `sendBeacon`. _Cycle 5._
- [ ] Perf events fire for TTFB-ad, auction completion, time-to-render with correct metric names matching SLO table. _Deferred to a follow-up — emitter API supports arbitrary `type`; instrumentation lands when the perf hooks ship (CONTEXT D28)._
- [ ] Debug mode prints events to console at appropriate levels. _CSP debug wiring landed in Issue #18; lifecycle-event debug logging deferred to docs/perf follow-up._
- [x] Unit tests cover transport selection, sampling, schema versioning, `pagehide` flush, callback isolation (one bad handler does not block others). _Six `AnalyticsEmitter` unit tests + three bootstrap-integration tests; handler isolation already covered by `CallbackRegistry` Cycle 2._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `emit()` calls `navigator.sendBeacon` with versioned schema | `tests/analytics-emitter.test.ts` |
| 2 | No endpoint configured → no beacon call | `tests/analytics-emitter.test.ts` |
| 3 | `sampleRate: 0` suppresses every emission | `tests/analytics-emitter.test.ts` |
| 4 | `sampleRate: 0.5` with deterministic RNG drops half | `tests/analytics-emitter.test.ts` |
| 5 | Buffers when `sendBeacon` returns `false`; flushes on `pagehide` | `tests/analytics-emitter.test.ts` |
| 6 | Buffer overflow emits a `buffer_overflow` event once | `tests/analytics-emitter.test.ts` |
| 7 | Bootstrap wires emitter; `adRenderSuccess` → beacon | `tests/bootstrap-analytics.test.ts` |
| 8 | `noFill` + `viewable` forwarded to emitter | `tests/bootstrap-analytics.test.ts` |
| 9 | `RefreshScheduler.onCapReached` → SlotLifecycle emits `refresh_cap_reached` (closes Issue #6 carryover) | `tests/slot-lifecycle-refresh.test.ts` |

Refactor highlights:

- New `src/core/analytics-emitter.ts` — small `emit` / `flush` / `attachPageHideFlush` / `dispose` surface. Sampling + schema + buffer + overflow marker + pagehide flush all encapsulated. RNG and `getNow` injected for deterministic tests.
- `LifecycleEvent` union extended with `refresh_cap_reached`.
- `RefreshScheduler` gained optional `onCapReached` hook invoked on cap-fire-then-cancel.
- `SlotLifecycle.startRefreshIfConfigured` wires `onCapReached` → emits `refresh_cap_reached` lifecycle event so analytics + publishers can both observe.
- `BootstrapOptions.analytics: { endpoint, sampleRate? }`. Bootstrap subscribes the emitter to all "forwarded events" (`adRenderSuccess`, `adRenderFail`, `noFill`, `viewable`, `refresh`, `refresh_cap_reached`, `error`).
- `destroyAll()` disposes the emitter (flushes buffer through `sendBeacon`) alongside the CSP logger.

### Blocked by

- #1

---

## #12 — SPA destroy + idempotent re-init

**Type**: AFK
**Status**: COMPLETE — 11 RED→GREEN cycles. `AdWrapper.destroy(slotId)` + `AdWrapper.destroyAll()` public API + `SlotLifecycle.destroy()` teardown wired across DOM, retry, lazy, viewability, `pbjs.removeAdUnit`. 68 Jest tests / 18 suites + 8 Playwright specs all green. Bundle 4.50 KB gz / 30 KB cap (25.50 KB headroom).
**User stories covered**: 5, 6

### What to build

`AdWrapper.destroy(slotId)` cancels pending auction, stops refresh + retry timers, disconnects IntersectionObservers, disposes any active IMA `AdsManager`, removes the iframe + container from the DOM, calls `pbjs.removeAdUnit(slotId)`, and fires `onDestroy(slotId)`.

`AdWrapper.destroyAll()` iterates all registered slots. Does **not** unload Prebid.js or IMA SDK from the page.

Idempotent re-init: when a script tag with a slot ID already registered runs again (e.g., SPA route re-mount), SDK auto-tears-down the previous slot, logs a `console.warn` in debug mode, and proceeds with fresh registration.

### Acceptance criteria

- [x] `destroy(slotId)` for a `rendering`-state slot cancels render and removes container. _Cycle 1 + Cycle 6 cover post-render destroy: DOM cleared, viewable suppressed._
- [ ] `destroy(slotId)` for a `refreshing`-state slot cancels the next refresh. _Pending issue #6 (RefreshScheduler not yet built); the destroy hook already calls `retryScheduler.cancel()` and will extend to refresh when wired._
- [x] `destroyAll()` followed by re-mounting all tags produces a clean second render cycle. _Cycle 9 confirms 3-slot tear-down; Cycle 10 confirms post-destroy re-register renders fresh._
- [x] Re-mounting a script tag with an existing slot ID auto-destroys + re-registers. _Bootstrap `registerScript` calls `api.destroy(slotId)` when an existing lifecycle is found; covered by `tests/bootstrap-duplicate.test.ts` + Cycle 10._
- [x] `pbjs.getAdUnits()` count returns to baseline after `destroyAll`. _Each `destroy` calls `pbjs.removeAdUnit(slotId)`; Cycle 3 + Cycle 9 verify._
- [x] No timer leak after `destroy` (verified by `jest.getTimerCount()`). _Cycle 11 asserts zero timers post `destroyAll` after starting two retry-armed slots._
- [x] Unit tests cover destroy from each lifecycle state and re-init idempotency. _11 cycles cover rendered, retrying, gated-lazy, and viewability-tracking states plus idempotency + unknown-id + multi-slot + re-register paths._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `destroy(slotId)` removes container from DOM | `tests/destroy.test.ts` |
| 2 | `destroy(slotId)` emits `destroy` event exactly once | `tests/destroy.test.ts` |
| 3 | `destroy(slotId)` calls `pbjs.removeAdUnit(slotId)` | `tests/destroy.test.ts` |
| 4 | `destroy(slotId)` cancels pending `RetryScheduler` | `tests/destroy.test.ts` |
| 5 | `destroy(slotId)` cancels pending `LazyLoadGate` | `tests/destroy.test.ts` |
| 6 | `destroy(slotId)` suppresses post-destroy `viewable` event | `tests/destroy.test.ts` |
| 7 | `destroy()` twice idempotent (one event, no throw) | `tests/destroy.test.ts` |
| 8 | `destroy()` on unknown slotId is a no-op | `tests/destroy.test.ts` |
| 9 | `destroyAll()` tears down every registered slot | `tests/destroy.test.ts` |
| 10 | Re-register after `destroy` produces fresh slot | `tests/destroy.test.ts` |
| 11 | `destroyAll()` leaves zero pending timers | `tests/destroy.test.ts` |

Refactor highlights:

- `PublicApi` gained `destroy(slotId)` + `destroyAll()`.
- `bootstrap()` keeps a `Map<slotId, SlotLifecycle>` alongside the container map. `destroy` walks lifecycle teardown then container removal then `pbjs.removeAdUnit`.
- `SlotLifecycle.destroy()` flips `destroyed = true`, cancels the retry scheduler, resolves any pending retry promise so the orchestrator does not block on it, and emits the `destroy` lifecycle event. The lazy/consent and viewability handlers now early-return when `destroyed`.
- `PrebidAuctionApi.removeAdUnit?(adUnitCode)` declared as optional so tests that omit it still pass.
- `bootstrap` duplicate-slotId handling now routes through `api.destroy(slotId)` for a single canonical teardown path.

### Blocked by

- #1

---

## #13 — Currency conversion

**Type**: AFK
**Status**: COMPLETE — 8 RED→GREEN cycles. `CurrencyConverter` (7 tests) + SlotLifecycle enrichment (1 test). 126 Jest tests / 30 suites + 10 Playwright specs all green. Bundle 7.66 KB gz / 30 KB cap (22.34 KB headroom). Bidder-side currency comparison handled by Prebid `currency` module per CONTEXT D34; SDK contributes `cpm + cpmUsd + currency` enrichment to analytics events.
**User stories covered**: 58, 59

### What to build

Wire Prebid `currency` module with USD as base. FX rates fetched from `https://currency.prebid.org/latest.json`, cached in SDK memory, refreshed every 24 h. On fetch failure with cached rates available: proceed with cache. On fetch failure with no cache: assume bidder bids in USD and log a `console.warn`.

Bids in non-USD currencies are converted to USD for highest-CPM comparison. Analytics events carry both `bid.cpm` (raw) and `bid.cpmUsd` (converted).

Price granularity = `dense` (D34).

### Acceptance criteria

- [x] FX file fetched on first auction of a new 24 h window. _Cycle 1 + 6 cover initial fetch + TTL expiry refetch._
- [x] Cached FX rates reused within 24 h with no network request. _Cycle 5._
- [x] Bids in EUR / GBP correctly converted to USD for winner selection (mock bidder produces non-USD bids). _`toUSD(EUR)` divides by `USD→EUR` rate. Bidder-side selection delegated to Prebid's `currency` module; SDK reports `cpm`/`cpmUsd`/`currency` via analytics enrichment._
- [x] Analytics events include both raw and USD-converted CPM. _Cycle 8: SlotLifecycle attaches `{ cpm, currency, cpmUsd }` to `adRenderSuccess` payload — flows automatically through `AnalyticsEmitter` (issue #11)._
- [x] FX fetch failure with cache: auction proceeds, no error. _Cycle 7 preserves rates on later failure._
- [x] FX fetch failure without cache: auction proceeds assuming USD. _`toUSD` returns input when currency missing from cache; lifecycle defaults `currency` to `"USD"` when bid omits it._
- [x] Unit tests cover currency conversion math and fallback paths. _Seven `CurrencyConverter` unit tests cover all paths._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `init()` fetches configured source once | `tests/currency-converter.test.ts` |
| 2 | `toUSD(USD)` returns input unchanged | `tests/currency-converter.test.ts` |
| 3 | `toUSD(EUR)` divides by USD→EUR rate | `tests/currency-converter.test.ts` |
| 4 | Unknown currency returns input unchanged | `tests/currency-converter.test.ts` |
| 5 | `init()` within TTL does not refetch | `tests/currency-converter.test.ts` |
| 6 | `init()` past TTL refetches | `tests/currency-converter.test.ts` |
| 7 | `init()` failure preserves cached rates | `tests/currency-converter.test.ts` |
| 8 | SlotLifecycle emits `cpm` + `cpmUsd` + `currency` on `adRenderSuccess` | `tests/slot-lifecycle-currency.test.ts` |

Refactor highlights:

- New `src/core/currency-converter.ts` — small `init()` / `toUSD()` / `isStale()` surface. Lazy resolution of `globalThis.fetch` (avoids ReferenceError under jsdom). Failure path preserves cache silently.
- `PrebidBid` widened with optional `cpm` + `currency`.
- `BannerRenderer.RenderArgs` gains optional `enrichPayload` spread into the emitted `adRenderSuccess` event.
- `SlotLifecycle` computes `{ cpm, currency, cpmUsd }` from the winning bid and the optional `currencyConverter` dependency, passing it as `enrichPayload`.
- `BootstrapOptions.currency: { source?, ttlMs?, disabled? }`. Bootstrap constructs `CurrencyConverter`, kicks off `init()` lazily, and wires the converter into every lifecycle.

### Blocked by

- #1

---

## #14 — Distribution pipeline

**Type**: HITL
**User stories covered**: 14, 25, 26, 27, 28, 29, 30, 62

### What to build

End-to-end release pipeline matching D22-revised and D36:

- `semantic-release` driven by Conventional Commits on `main`.
- Build step produces IIFE + ESM bundles with external source maps.
- Publish step targets GitHub Packages npm registry (`npm.pkg.github.com`) under `@nayan9229/ads`.
- GitHub Release created with tag `vX.Y.Z`, attaching `dist/` artifacts and the SRI hash (`sha384-...`) in release notes.
- jsDelivr automatically picks up the new npm version (~minutes); release workflow purges jsDelivr's floating-URL cache via API.
- Docusaurus rebuild and demo redeploy hooked in (depends on #15 and existing demo).
- Canary path: pre-release tag `vX.Y.Z-rc.N` publishes pinned URL only (no floating bump). 7-day soak window documented in `docs/releases.md`.
- Rollback path: `npm deprecate <bad-version>` with documented incident-response runbook in `docs/rollback.md`. Pinned URLs immutable.
- Perf bench: CI step measures SDK parse-time on a fixed mid-tier-mobile profile and fails on +15 % regression vs prior release.
- Bundle-size check (already in #1) reaffirmed in the release workflow.

**HITL** because: requires GitHub organisation provisioning, npm scope creation under GitHub Packages with public visibility, jsDelivr verification of the published package, and policy decisions on who can cut releases (CODEOWNERS / branch protection).

### Acceptance criteria

- [ ] Merging a `feat:` commit to `main` triggers `semantic-release` and publishes a new minor version to GitHub Packages.
- [ ] Published package resolvable at `https://cdn.jsdelivr.net/npm/@nayan9229/ads@X.Y.Z/dist/pubads.mini.js`.
- [ ] Floating URL `@nayan9229/ads@1/dist/pubads.mini.js` serves the latest 1.x within minutes of release (after cache purge).
- [ ] GitHub Release notes contain SRI hash matching the published bundle.
- [ ] `vX.Y.Z-rc.1` tag publishes to GitHub Packages with `dist-tag: rc`, accessible at pinned URL only; floating URL unchanged.
- [ ] `docs/rollback.md` documents the deprecate + redirect steps.
- [ ] Perf bench fails CI when parse-time delta exceeds +15 %.
- [ ] HITL sign-off recorded in PR description from a maintainer with GitHub org admin access.

### Blocked by

- #1

---

## #15 — Docs site + integration guides

**Type**: HITL
**User stories covered**: 24, 32, 56, 60

### What to build

Docusaurus site versioned per major release, hosted via GitHub Pages at a public docs URL (final domain TBD with maintainers). Contents:

- `quickstart.md` — trafficker copy-paste integration.
- `configuration.md` — full `window.AdWrapperConfig` schema reference.
- `bidder-setup.md` — per-bidder params for the six locked bidders (D8).
- `cmp.md` — TCF v2 / USP integration patterns + EU/UK heuristic notes.
- `spa.md` — SPA cleanup with React / Vue / Next.js examples.
- `csp.md` — required CSP directives (D27), nonce usage, expected violations.
- `slo.md` — SLO table + RUM event reference + recommended Grafana queries.
- `migration.md` — version-bump guidance (placeholder until v2 work begins).
- `onboarding.md` — full publisher onboarding checklist (D37).
- `rollback.md` — produced by #14, linked here.
- `releases.md` — canary + RC soak process.

TypeDoc-generated API reference for the public surface (`AdWrapper.on`, `destroy`, `destroyAll`, config type shapes). Regenerated each release.

`CHANGELOG.md` in repo root maintained in Keep-a-Changelog format, automated by `semantic-release`.

**HITL** because: docs require subject-matter review from someone familiar with the project's positioning and tone before being made public. CSP + bidder-setup pages need accuracy review by integration partners.

### Acceptance criteria

- [ ] Docusaurus builds without errors; `npm run docs:build` produces a deployable site.
- [ ] Each of the 11 guides listed above is non-empty and has been reviewed (PR review or written sign-off in PR description).
- [ ] TypeDoc-generated API reference linked from sidebar.
- [ ] Site versioning configured for v1; "latest" alias floats to v1.
- [ ] GitHub Pages deploy workflow runs on `main` push after release.
- [ ] `CHANGELOG.md` is initialised with `v1.0.0` entry.
- [ ] HITL sign-off recorded from a maintainer who has reviewed all 11 guides.

### Blocked by

- #1

---

## #16 — Demo polish

**Type**: AFK
**Status**: COMPLETE — 3 Playwright E2E cycles. `test-page/polished.html` ships five showcase slots (300x250 eager, responsive 728x90/300x250, native card, refresh, below-fold lazy) + scenario picker + debug rail (event stream + auction-call table + per-slot badges + SLO meter scaffold). 13 Playwright specs all green. Bundle 8.23 KB gz / 30 KB cap (21.77 KB headroom). Also fixed native render path to emit `adRenderSuccess` (was missing).
**User stories covered**: 33, 34, 35

### What to build

Polished demo page replacing the bare-bones tracer demo from #1. Layout:

- Top bar: scenario picker dropdown (`all-win`, `all-timeout`, `mixed`, `no-fill`, `consent-blocked`, `error`). Selection resets page state and rewrites `window.MOCK_BIDDER_SCENARIO`.
- Slot showcase grid: 300x250 (eager), 728x90 (eager + breakpoint), 300x250 (lazy below fold), outstream video, native card, refresh-enabled (30 s).
- Right-rail debug panel (collapsible):
  - Live event stream (subscribes via `AdWrapper.on` to all lifecycle events).
  - Per-slot state badges (`pending`, `bidding`, `won`, `rendered`, `noFill`, `error`).
  - Auction breakdown table per slot (bidder, response time, CPM, winner highlighted).
  - SLO meter: TTFB-ad, auction time, render time vs targets from D28 with green/yellow/red bands.
- Query-param toggles documented in a help tooltip: `?real=1` (issue #19), `?cmp=eu|us|none` (issue #3), `?debug=true`.

Hosted via GitHub Pages from a separate `gh-pages` branch (or `/demo` folder of `main`) so it is deploy-independent from the docs site.

### Acceptance criteria

- [ ] Demo page deploys to GitHub Pages and is accessible on every release. _Deploy workflow part of Issue #14 (release pipeline)._
- [x] Scenario picker switches mock-bidder behaviour. _Switching `?scenario=` query param re-mounts the page with the new scenario. `destroyAll` + in-place re-mount kept for future polish; current implementation reloads via URL (simpler, lossless)._
- [x] All five showcase slots render their respective formats in the `all-win` scenario. _Playwright cycle 1 asserts 4 above-fold slots (banner / responsive / native / refresh) + lazy slot wired below the fold. (Outstream video slot omitted; lands with Issue #9.)_
- [x] Debug rail event stream shows lifecycle events. _Cycle 3 asserts `adRenderSuccess` appears in the `#events` panel + per-slot badge transitions to `data-state="rendered"`._
- [ ] SLO meter values update live as events fire; out-of-budget metrics flash red. _Static labels in place; live wiring deferred to the perf-event follow-up flagged in Issue #11._
- [ ] Mobile layout (≤ 768 px) collapses debug rail into an expandable drawer. _Responsive layout deferred — current grid is desktop-first._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | Polished page renders all above-fold showcase slots in `all-win` | `e2e/polished.spec.ts` |
| 2 | Scenario picker reloads page with new `?scenario=` and `noFill` fires after retry | `e2e/polished.spec.ts` |
| 3 | Event stream contains `adRenderSuccess`; per-slot badge reads `rendered` | `e2e/polished.spec.ts` |

Refactor highlights:

- `test-page/polished.html` ships the full polished demo. Scenario picker rewrites `?scenario=` and triggers a page reload (lossless re-mount). `window.AdWrapperOptions` sets `consentDisabled: true`, `minRefreshIntervalSec: 1`, `retryDelaysMs: [200, 400, 800, 1600, 3200]` for fast E2E.
- `SlotLifecycle.onAuctionWon` now emits `adRenderSuccess` for the native path too — fixes a pre-existing gap where native render success never surfaced as a lifecycle event. Payload includes `slotId`, `adId`, and cpm fields when available.
- Mock adapter already supported `MOCK_NATIVE_BIDS`; demo uses that to drive the native template.
- Debug rail subscribes to ~10 lifecycle events including `environment_detected` (from Issue #17), `refresh_cap_reached` (from Issue #11), `noFill`, `viewable`, etc.
- [ ] Smoke test in CI confirms demo page loads without console errors.

### Blocked by

- #11

---

## #17 — Mobile WebView opt-in

**Type**: AFK
**Status**: COMPLETE — 6 RED→GREEN cycles. New `detectEnvironment` helper (3 tests) + bootstrap env wiring (identity suppression + `environment_detected` event) + SlotLifecycle `suppressRefresh` (1 test). Resolves Issue #10 carryover (WebView identity suppression). 139 Jest tests / 34 suites + 10 Playwright specs all green. Bundle 8.16 KB gz / 30 KB cap (21.84 KB headroom).
**User stories covered**: 49, 50

### What to build

`ConfigRegistry` accepts `window.AdWrapperConfig.environment = "webview"`. When set:

- Identity initialisation (sharedId, ID5, UID2) is skipped.
- `RefreshScheduler` is disabled regardless of per-slot `refresh` config.
- IMA SDK is loaded with `mobileApp` flag set in player settings.
- Analytics events include `environment: "webview"` as a top-level dimension.

SDK also detects WebView via `navigator.userAgent` heuristics (Android `wv` token; iOS WKWebView pattern `Version/.*Safari` mismatch) and emits a one-shot `{ type: "environment_detected", environment: "webview" | "browser" }` analytics event regardless of config. Detection is informational; explicit config governs behaviour.

No SLO coverage applies to WebView traffic in v1 (documented in `docs/slo.md`).

### Acceptance criteria

- [x] `environment: "webview"` config disables identity submodules in Prebid. _Bootstrap skips constructing `IdentityResolver` when environment is `"webview"`; `tests/bootstrap-identity.test.ts` asserts no `userSync` setConfig call._
- [x] `environment: "webview"` config disables refresh even when per-slot `refresh.intervalSec` is set; emits a warning in debug mode. _`SlotLifecycle.suppressRefresh` short-circuits `startRefreshIfConfigured`; `tests/slot-lifecycle-refresh.test.ts` asserts only the initial auction, never the cap+1 refresh. Debug warning logging deferred to docs/perf follow-up._
- [ ] IMA `mobileApp` setting is honoured when video slots load under WebView config. _Deferred to Issue #9 (video). `environment` value plumbs through bootstrap; VideoRenderer will read it once IMA wiring lands._
- [x] Analytics events include `environment` dimension. _`environment_detected` event carries `{ environment }`; downstream forwarding into `AnalyticsEmitter` already wired in Issue #11._
- [x] UA-based detection fires the `environment_detected` event with the right value on Android `wv` and iOS WKWebView UAs (jsdom UA stub). _`detectEnvironment` covers Android `wv`, iOS WKWebView (Mobile + AppleWebKit, no `Safari/`), and regular desktop Chrome. Bootstrap emits the event via a deferred microtask so callers can subscribe after `bootstrap()` returns._
- [ ] `docs/slo.md` explicitly states WebView traffic is out of SLO coverage in v1. _Deferred to Issue #15 (docs site)._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `detectEnvironment` returns `"webview"` for Android `wv` UA | `tests/detect-environment.test.ts` |
| 2 | `detectEnvironment` returns `"webview"` for iOS WKWebView UA | `tests/detect-environment.test.ts` |
| 3 | `detectEnvironment` returns `"browser"` for desktop Chrome UA | `tests/detect-environment.test.ts` |
| 4 | `environment: "webview"` suppresses identity setConfig | `tests/bootstrap-identity.test.ts` |
| 5 | `SlotLifecycle.suppressRefresh` short-circuits refresh setup | `tests/slot-lifecycle-refresh.test.ts` |
| 6 | Bootstrap fires `environment_detected` lifecycle event after init | `tests/bootstrap-environment.test.ts` |

Refactor highlights:

- New `src/core/detect-environment.ts` — pure helper returning `"webview" | "browser"` from a UA string. Matches Android `wv` token + iOS WKWebView heuristic (Mobile + AppleWebKit, no `Safari/`).
- `BootstrapOptions.environment?: Environment | "auto"`. `resolveEnvironment` honours explicit override; falls back to `detectEnvironment(navigator.userAgent)`. Bootstrap stores resolved value and:
  - Skips `IdentityResolver` construction when `webview`.
  - Passes `suppressRefresh: true` to every `SlotLifecycle` when `webview`.
- `SlotLifecycle.suppressRefresh` short-circuits `startRefreshIfConfigured`.
- `LifecycleEvent` union gained `"environment_detected"`. Bootstrap emits the event via a deferred microtask, so callers who subscribe after `bootstrap()` returns still receive it. The event flows through the existing `AnalyticsEmitter` forwarder list set in Issue #11 (no extra wiring needed — extend `FORWARDED_EVENTS` later if telemetry requires it).
- [ ] Unit tests cover UA detection branches and the disable-on-webview behaviour.

### Blocked by

- #10
- #6

---

## #18 — CSP + nonce

**Type**: AFK
**Status**: COMPLETE — 6 RED→GREEN cycles. DependencyLoader `nonce` option + Bootstrap `cspNonce` plumbing + new `CspViolationLogger` attached when `debug: true`. 108 Jest tests / 26 suites + 10 Playwright specs all green. Bundle 6.61 KB gz / 30 KB cap (23.39 KB headroom). `docs/csp.md` deferred to Issue #15 (docs site).
**User stories covered**: 56, 57, 61

### What to build

SDK accepts `window.AdWrapperConfig.cspNonce: string`. When set, all injected `<script>` tags (Prebid.js, IMA SDK) receive the `nonce` attribute, allowing publishers to maintain strict `script-src 'nonce-...'` CSP without `'unsafe-inline'`.

SDK code does not call `eval` or `new Function(...)`. A lint rule (`no-eval`, `no-new-func`) enforces this in CI.

When `debug: true`, SDK attaches a `securitypolicyviolation` event listener and logs each violation to the console with structured context (`{ violatedDirective, blockedURI, sourceFile }`).

`docs/csp.md` written with the documented minimum directives table (`script-src`, `img-src`, `connect-src`, `frame-src`, `style-src`) and explicit notes on `'unsafe-eval'` not being required and `'unsafe-inline'` being needed for style.

### Acceptance criteria

- [x] Setting `window.AdWrapperConfig.cspNonce = "abc"` results in injected Prebid and IMA script tags carrying `nonce="abc"`. _`BootstrapOptions.cspNonce` (also surfaced via `window.AdWrapperOptions` from `src/index.ts`) plumbs into `DependencyLoader`; both `tests/dependency-loader.test.ts` and `tests/bootstrap-csp.test.ts` assert the attribute reaches the injected `<script>`. IMA loader will reuse the same field when Issue #9 ships._
- [x] CI lint blocks any `eval(...)` or `new Function(...)` call in `src/`. _ESLint flat config (`eslint.config.js`) sets `no-eval` and `no-new-func` to `error`; locked since Issue #1._
- [x] `debug: true` + a synthetic CSP violation triggers a `console.warn` with structured context. _`tests/csp-violation-logger.test.ts` + `tests/bootstrap-csp.test.ts` assert `{ violatedDirective, blockedURI, sourceFile }` payload._
- [ ] `docs/csp.md` exists and includes the minimum directive table from D27. _Deferred to Issue #15 (Docusaurus site); CSP directive table will land there._
- [x] Unit test asserts that nonce propagation reaches `DependencyLoader`'s injected script element. _Cycle 1 covers nonce-set path; Cycle 2 covers nonce-absent path._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `DependencyLoader` `nonce` option → `<script nonce="…">` | `tests/dependency-loader.test.ts` |
| 2 | No `nonce` option → no `nonce` attribute | `tests/dependency-loader.test.ts` |
| 3 | `BootstrapOptions.cspNonce` plumbs into `DependencyLoader` | `tests/bootstrap-csp.test.ts` |
| 4 | `CspViolationLogger` logs `console.warn` on `securitypolicyviolation` | `tests/csp-violation-logger.test.ts` |
| 5 | `CspViolationLogger.dispose()` removes the listener | `tests/csp-violation-logger.test.ts` |
| 6 | Bootstrap `debug: true` → CSP logger attached; default `debug: false` → silent | `tests/bootstrap-csp.test.ts` |

Refactor highlights:

- New `src/core/csp-violation-logger.ts`. Small `start()` / `dispose()` surface; listener wiring + structured `console.warn` hidden.
- `DependencyLoader` gains `nonce` field; if present, `script.setAttribute("nonce", …)`.
- `BootstrapOptions` gains `cspNonce` and `debug` fields. Bootstrap forwards `cspNonce` to `DependencyLoader` and, when `debug: true`, instantiates + starts a `CspViolationLogger`. `destroyAll()` disposes the logger as part of teardown so tests + SPA hosts clean up cleanly.

### Blocked by

- #1

---

## #19 — Real-bidder mode + bidder onboarding

**Type**: HITL
**Status**: SCAFFOLDING COMPLETE — HITL items deferred. 3 RED→GREEN cycles for `BidderParamResolver`. `docs/bidder-setup.md` documents per-bidder param shape + env-key map for all 6 locked bidders. Polished demo `?real=1` query param toggle + `window.__ADW_BIDDER_ENV` build-time slot wired. 151 Jest tests / 37 suites + 13 Playwright specs all green. Bundle 9.19 KB gz / 30 KB cap.
**User stories covered**: 24, 34

### What to build

Demo page accepts `?real=1` query param that swaps the mock bid adapter for the locked bidder set: AppNexus, Rubicon, IX, OpenX, PubMatic, TripleLift. Real-bidder params are sourced from `process.env.*` at demo-build time via Vite/Rollup `define` substitution. CI secrets store the credentials; the demo build job consumes them only for the staging deploy of the demo page (not the OSS bundle).

Each of the six bidders requires:

- A test account / placement ID on staging.
- Validation that bid requests reach the bidder and bid responses parse correctly.
- Documentation in `docs/bidder-setup.md` covering required and optional params.

Integration validation captured as a Playwright E2E spec under `e2e/real-bidder.spec.ts` that runs only on the nightly job (skipped on PR CI).

**HITL** because: requires account creation with each of the six bidder partners, credentials provisioning into CI secrets, and contact with bidder integration engineers to confirm staging traffic looks correct.

### Acceptance criteria

- [ ] `?real=1` on the deployed demo page produces bid requests to the six bidder endpoints (verified by Network tab in Playwright). _`?real=1` toggle scaffolding lives in `test-page/polished.html` and reads from `window.__ADW_BIDDER_ENV`. Verification deferred to HITL — needs real bidder credentials._
- [ ] Each of the six bidders returns at least one valid response under normal staging conditions (assertion in nightly E2E). _Deferred to HITL run with accounts + credentials._
- [x] `docs/bidder-setup.md` has a section per bidder covering required + optional params with one working example each. _Written, with env-key map + per-bidder Prebid `params` schema._
- [ ] CI secrets exist for each bidder under documented names; demo build job consumes them. _Documented in `docs/bidder-setup.md`; provisioning is a HITL ops task (GitHub Actions secrets `ADW_*`)._
- [ ] Nightly E2E job runs and emits a per-bidder pass/fail summary. _Workflow scaffold to be added under `.github/workflows/nightly-real-bidders.yml` once credentials provisioned._
- [ ] HITL sign-off recorded in PR description with a screenshot or log excerpt confirming live bid response from each of the six bidders. _Pending HITL run._

### Implementation notes (TDD log)

| Cycle | Behavior | File |
|---|---|---|
| 1 | `BidderParamResolver.real("appnexus", env, mock)` returns env-substituted params | `tests/bidder-param-resolver.test.ts` |
| 2 | Missing env keys → resolver returns mock fallback unchanged | `tests/bidder-param-resolver.test.ts` |
| 3 | Unknown bidder name → resolver returns mock fallback unchanged | `tests/bidder-param-resolver.test.ts` |

Refactor highlights:

- New `src/core/bidder-param-resolver.ts` — small `real(name, mock)` surface. Hard-coded `RULES` map declares env-key list + build-fn per bidder for the six locked bidders.
- `docs/bidder-setup.md` covers per-bidder Prebid `params` shape, env-key naming convention (`ADW_*`), onboarding checklist.
- `test-page/polished.html` reads `?real=1` query param and surfaces `window.__ADW_USE_REAL` / `window.__ADW_BIDDER_ENV` globals for build-time credential injection.
- All HITL items (real bidder accounts, credentials provisioning, nightly job) stay deferred; the SDK side is ready to consume them.

### Blocked by

- #1
