# Execution-surface detection and per-surface degradation (GAM-creative backfill)

> Status: **Accepted (design; implementation pending).** Amends D5 (top-page-only execution) and extends the D30/D34 environment→degradation pattern.

## Context

D5 fixed the SDK's execution context as the **publisher top page** — "not inside an ad-server creative iframe," with `meta name="ad.size"` treated as illustrative/unused.

A new delivery requirement breaks that assumption. The SDK is to run as a **GAM-first waterfall backfill**: Google Ad Manager serves the slot first (AdX / direct / higher-priority line items); on **unfill**, GAM serves an **HTML5 creative** whose body loads the SDK (`gen_ad.min.js`), which then runs the Prebid-direct auction and renders the winner. The SDK therefore executes **inside the GAM creative iframe**, not on the top page. It is *not* a `window.top` passback and does *not* require the SDK to be present on the publisher page.

The creative iframe can be one of three surfaces, and the publisher relationship dictates which:

- **`safeframe`** (cross-origin, sandboxed) — the case we have **today**; we only control the GAM creative slot.
- **`friendly-iframe`** (same-origin) — a **future** case, when we have top-frame cooperation.
- **`top`** — the original D5 integration (existing publishers), still supported.

Browser security makes several SDK capabilities impossible or mechanically different inside a cross-origin SafeFrame: storage is partitioned per (top-site, iframe-origin), third-party cookies are blocked (Safari ITP / Firefox ETP / Chrome partitioning), `window.top` is unreachable, and IntersectionObserver cannot see the top viewport.

## Decision

**Detect the execution surface at runtime and degrade capabilities per surface**, reusing the existing `environment`→degradation machinery (D30/D34) rather than inventing a parallel one. `webview` remains an orthogonal axis with its existing behavior.

Detection order: `window === window.top` → `top`; else framed — if `window.top.document` is reachable (same-origin) → `friendly-iframe`, else (`$sf.ext` present / cross-origin) → `safeframe`.

Per-surface policy:

| Surface | Consent | Identity | Viewability | Refresh | Render |
|---|---|---|---|---|---|
| `top` | `window.__tcfapi` | ON | IntersectionObserver | SDK-owned | banner + in/outstream |
| `friendly-iframe` | `window.top.__tcfapi` | ON (top-origin cookies) | IO via top document | SDK-owned | banner + outstream |
| `safeframe` | IAB `__tcfLocator` postMessage bridge | **OFF** | `$sf.ext.geom()` / `inViewPercentage()` | SDK-owned | banner + **best-effort** outstream |

Key points:

- **Identity is OFF in `safeframe`** — browser-enforced, not a choice. A cross-origin SafeFrame reads only its own partitioned/third-party storage, so Prebid's first-party ID modules (sharedId/pubcid), bidder cookie syncs, and the identity-resolver's vendor-cookie reads are all unusable. Mirrors the webview identity suppression (D34). `userSync` may stay enabled as best-effort but is not relied upon.
- **Consent is wired per-surface and gated by `consentDisabled`.** `consent-manager.ts` stops relying on bare `window.__tcfapi` in framed contexts: `top` → `window.__tcfapi`, `friendly-iframe` → `window.top.__tcfapi`, `safeframe` → IAB `__tcfLocator` cross-frame postMessage bridge. When `consentDisabled: false` (default), the SDK's auction gate uses that surface-appropriate path (EU/UK without a resolvable CMP blocks, per D15). When `consentDisabled: true`, the SDK skips its own gate entirely; Prebid's bundled `consentManagementTcf` still runs for the bid requests regardless.
- **Refresh stays SDK-owned and enabled on all browser surfaces, including framed ones** (product decision — the SDK rotates its own backfill inside the slot GAM handed it; GAM and the SDK may both refresh, and renders never stack because the container is cleared first, D-dup-fix). Webview keeps refresh OFF (D34). **Consequence:** `safeframe` refresh gating *requires* the `$sf.ext` viewability provider, since IntersectionObserver is blind cross-origin.
- **Video** is best-effort outstream in `safeframe` (may fail in restrictive SafeFrames); instream is impossible in a display-slot creative. **On outstream render failure/refusal in `safeframe`, fall back to the highest banner bid from the same auction** (banner is always requested in the multiformat unit), else emit `noFill`.

## Considered alternatives

- **`window.top` passback** (SDK on the top page; the creative just calls `window.top.AdWrapper.registerSlot`). Rejected for the current reality: we only have the cross-origin GAM creative slot and no top-page presence, so `window.top` is unreachable. (Retained conceptually for the `friendly-iframe`/top-control future.)
- **Prebid → GPT → GAM unified header bidding** ("highest CPM wins"). Rejected: requires top-page GPT control we don't have and is a heavy D9 reversal; the requirement is *backfill*, not unification. A waterfall gives GAM first-look by design.
- **Suppress refresh in framed surfaces** (like webview). Rejected per product; accepted the `$sf.ext` viewability dependency instead.

## Consequences

- **Amends D5**: execution context is surface-aware, not top-page-only.
- **Identity match rates collapse in `safeframe`** — accepted, because no *client-side cookie* trick beats storage partitioning + 3p-cookie blocking. Fill/CPM/match must be recovered by signals sourced **outside the frame**, in priority order:
  1. **Publisher/GAM injects identity into the creative** via GAM key-values/creative macros (a hashed-email/UID2 token, ID5/RampID envelope, or shared 1p id) that the SDK reads and feeds into `ortb2.user.eids` / `user.ext`. Highest leverage; needs publisher cooperation.
  2. **Prebid Server (S2S)** — server-side cookie syncs + match store bypass the frame's cookie limits and add demand. Reverses D33 (CSB-only in v1; S2S deferred to v2).
  3. **Cookieless deterministic/graph IDs** (UID2/EUID, ID5 server-side mode, LiveRamp ATS) supplied as tokens — survive cross-origin because they are values, not cookies.
  4. **`$sf.ext.geom()` viewability fed into `imp.ext`** — measured-viewable lifts CPM (and is already required for refresh gating).
  5. **Contextual signals** (page URL, IAB categories, `ortb2.site.content`, seller-defined audiences) passed via GAM macros — cookieless demand stabilizes fill.
  6. **Lower/omit price floors in the `safeframe` path** — high floors choke already-thin low-match demand; keep `schain` populated for SSP trust.
  Privacy Sandbox (Topics/PAAPI) is the forward path, not cookies.

  **In scope for this ADR:** items **1 (publisher-injected identity)**, **4 (`$sf.ext` viewability into `imp.ext`)**, and **5 (contextual injection)**. Item **2 (Prebid Server / S2S)** remains deferred (reverses D33). Design of the in-scope items:
  - **Injected-signals reader (channel-agnostic).** The SDK reads publisher-provided signals from, in order of precedence, `$sf.ext.meta()` → `window.AdWrapperIdentity` global (set inline in the creative) → the `gen_ad.min.js` `document.currentScript.src` query string. Whichever is present wins; the publisher populates the channel their GAM creative type supports.
  - **Identity (#1).** Accepts a raw OpenRTB `eids` array (base64url JSON) and named shortcuts (`uid2`, `id5`, `ramp`) that map to their canonical `eids` source objects. Merged into `ortb2.user.eids` via the existing signal merger (D48). **Precedence:** publisher-injected wins over the cookie-derived resolver on a same-`source` conflict (it is authoritative first-party). In `safeframe` the resolver/userId modules are OFF, so injected identity is the sole source.
  - **Viewability (#4).** The `$sf.ext.geom()` reading (already used for the refresh gate) is also stamped onto `adUnit.ortb2Imp.ext.data.viewability` at auction time, so bidders see measured-viewable — a CPM signal, not just internal gating.
  - **Contextual (#5).** Injected `cat`, `keywords`, `content` merge into `ortb2.site` and reach the bid request on all surfaces. Injected `page` is set into `ortb2.site.page` in framed contexts as a best-effort hint, but is **best-effort only**: verification showed Prebid's `refererInfo` FPD enrichment overwrites `site.page` with the referrer/ancestor-derived top URL even in a cross-origin SafeFrame, so the injected value typically does not survive to the wire. (`cat`/`keywords`/`content` are not derived by Prebid and do survive.)
- New runtime surface area: a surface detector (extends `detect-environment.ts`), a SafeFrame `$sf.ext` viewability provider (extends `viewability-tracker.ts`), and a cross-frame `__tcfLocator` path in `consent-manager.ts`.
- Nested iframes in the framed banner case (publisher → GAM SafeFrame → SDK friendly iframe) — extra layer, accepted.
- A GAM slot refresh reloads the creative and restarts the SDK, resetting `sessionCap`; effective refreshes across GAM reloads exceed the per-session cap — accepted for backfill.
- `meta name="ad.size"` remains illustrative/unused (D5) — sizing comes from the slot config's `mediaTypes`, not the meta tag.
