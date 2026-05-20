# @nayan9229/ads

Prebid.js wrapper SDK. Drop one `<script>` per slot. SDK auto-load Prebid.js + IMA SDK + bidder adapters. No publisher-side dependency management.

> Design source-of-truth: [CONTEXT.md](./CONTEXT.md) • PRD: [PRD.md](./PRD.md) • Issues: [ISSUES.md](./ISSUES.md)

---

## Quick start

```html
<!DOCTYPE html>
<html>
  <head>
    <script>
      window.AdWrapperConfig = {
        homepage_300x250_top: {
          mediaTypes: { banner: { sizes: [[300, 250]] } },
          bidders: [{ bidder: "appnexus", params: { placementId: 13144370 } }],
        },
      };
    </script>
  </head>
  <body>
    <article>Content above the ad.</article>

    <script
      id="homepage_300x250_top"
      src="https://cdn.jsdelivr.net/npm/@nayan9229/ads@1/dist/pubads.mini.js"
    ></script>

    <article>Content below the ad.</article>
  </body>
</html>
```

`script id` must match a key in `window.AdWrapperConfig`. SDK reads matching entry, reserves slot size, loads Prebid, runs auction, renders highest-CPM winner.

---

## v1 feature set

- Banner (any size + responsive breakpoint maps).
- Outstream + instream video via Google IMA SDK.
- Native HTML with safe template escape.
- Multi-bidder: AppNexus, Rubicon, IX, OpenX, PubMatic, TripleLift.
- Lazy load + viewability tracking + viewability-gated refresh.
- Exponential backoff retry on no-fill.
- Consent: TCF v2 + CCPA. Identity: sharedId + ID5 + opt-in UID2.
- Pluggable analytics over `navigator.sendBeacon`.
- SPA-friendly destroy + idempotent re-init.
- CSP nonce propagation + CSP violation logging.
- Mixed mediaTypes per slot (banner + video same auction; routes winner by `bid.mediaType`).

---

## Global SDK options — `window.AdWrapperOptions`

Single object. Applies to all slots. Set BEFORE the first `<script src="pubads.mini.js">` tag.

```js
window.AdWrapperOptions = {
  // === Auctions ===
  prebidSrc: "https://your-cdn.example.com/prebid-9.x-custom.js",
  //   Hosted Prebid build. Default fall back to jsdelivr `not-for-prod` build + console.warn.

  timeoutMs: 1500,
  //   Per-auction timeout. Default: Prebid built-in (~3000ms).

  retryDelaysMs: [1000, 2000, 4000, 8000, 16000],
  //   No-fill backoff. Empty array `[]` = retry disabled. Default: 5 attempts as shown.

  prebidConfig: {
    bidderTimeout: 1500,
    priceGranularity: "dense",
    cache: { url: "https://prebid.adnxs.com/pbc/v1/cache" },
    // any pbjs.setConfig key — verbatim forward after Prebid loads
  },

  // === Consent ===
  consentDisabled: true,
  //   Skip CMP wait entirely. Use ONLY in dev. Default: false (block on CMP).

  consentTimeoutMs: 8000,
  //   CMP wait cap before fall back to non-personalized. Default: 8000.

  consentTimezone: "America/New_York",
  //   Override timezone for CCPA region inference (testing only).

  // === Identity ===
  identity: {
    id5PartnerId: 1234,
    uid2: { email: "<64-char-sha256-lowercase-hex>" },
  },
  //   sharedId always on. ID5 opt-in via id5PartnerId. UID2 opt-in via pre-hashed email.

  // === Refresh floor ===
  minRefreshIntervalSec: 30,
  //   Per-slot `refresh.intervalSec` clamp. Default: 30.

  // === Currency ===
  currency: {
    source: "https://currency.prebid.org/latest.json",
    ttlMs: 86_400_000,
    disabled: false,
  },
  //   FX rates for CPM normalization to USD in analytics. `disabled: true` skip fetch.

  // === Analytics ===
  analytics: {
    endpoint: "https://analytics.example.com/collect",
    sampleRate: 0.1,
  },
  //   sendBeacon emit. sampleRate 0..1. Buffer flush on pagehide.

  // === New Relic Browser sink ===
  newrelic: {
    licenseKey: "NRJS-aaaaaaaaaaaaaaaaaa",
    applicationID: "1234567890",
    accountID: "1234567",
    // beacon: "bam.eu01.nr-data.net",       // EU data residency. Default "bam.nr-data.net".
    // errorBeacon: "bam.eu01.nr-data.net",  // Default = beacon.
    // agentSrc: "https://js-agent.newrelic.com/nr-loader-spa-current.min.js",
    sampleRate: 0.1,                          // Non-error events. Errors always 100%.
  },
  //   SDK forwards lifecycle events to publisher's NR account. Errors → noticeError;
  //   other events → addPageAction("adwrapper_" + event). If window.newrelic already
  //   present (publisher installed NR snippet in <head>), SDK reuses it. Otherwise
  //   SDK seeds window.NREUM and async-injects the NR loader. PRIVACY: per-event
  //   attribute allowlist, identifier-class fields (eids/deviceId/userId) dropped,
  //   cpm bucketed to 0.25 increments. See docs/adr/0002-newrelic-browser-sink.md.

  // === Misc ===
  cspNonce: "abc123",
  //   Propagate to injected <script> + <iframe> nonces.

  debug: true,
  //   Verbose SDK logs + forward `pbjs.setConfig({ debug: true })`.

  environment: "auto",
  //   "auto" | "browser" | "webview". Default: auto-detect from UA.

  // === Identity-resolver runtime (augments Prebid userId modules) ===
  identityResolver: {
    enabled: true,
    src: "https://cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.0/dist/index.umd.js",
    timeoutMs: 1000,
    tiers: [1, 2, 3, 4],
  },
  //   Loads identity-resolver UMD on demand, resolves OpenRTB user.eids[] +
  //   user.buyeruid from 15+ vendor cookies, merges with Prebid userId modules,
  //   pushes via pbjs.setConfig({ ortb2 }) pre-auction. ConsentManager-aware:
  //   eids+buyeruid stripped when consent blocked, regs.* always forwarded.
  //   Default src = jsDelivr GitHub pin. webview env always skips.

  // === IAB SupplyChain (schain) ===
  schain: {
    ver: "1.0",
    complete: 1,
    nodes: [{ asi: "your-domain.com", sid: "your-publisher-id", hp: 1 }],
  },
  //   Forwarded verbatim via pbjs.setConfig({ schain }). Many SSPs filter
  //   requests without it. Validated at bootstrap: ver must be "1.0",
  //   complete must be 0|1, nodes[] non-empty, each node needs asi/sid/hp.

  // === First-party site context ===
  ortb2: {
    site: {
      cat: ["IAB12"],
      content: { keywords: "ad-tech, prebid", language: "en" },
    },
  },
  //   Verbatim passthrough to pbjs.setConfig({ ortb2 }). Prebid auto-derives
  //   site.domain + site.page — do NOT override those keys. Loose typed
  //   (Record<string, unknown>); SDK does not validate inner shape.
};
```

---

## Per-slot config — `window.AdWrapperConfig[slotId]`

Keyed by `script id`. Each slot independent.

```js
window.AdWrapperConfig = {
  my_slot_id: {
    mediaTypes: {
      banner: { /* see below */ },
      video:  { /* see below */ },
      native: { /* see below */ },
    },
    bidders: [
      { bidder: "appnexus", params: { placementId: 13144370 } },
      // multiple bidders OK. Multiple entries per bidder OK (e.g. one per mediaType).
    ],
    eager: true,
    //   true = auction fire on script execute. Default: false = LazyLoadGate wait until in-viewport.

    fallback: { type: "image", url: "/house-300x250.png", clickUrl: "https://example.com/promo" },
    //   Rendered after retry exhaustion.

    refresh: { intervalSec: 30, sessionCap: 5 },
    //   Post-viewable re-auction. Floor 30s. Omit to disable.

    container: "my-ad-div",
    //   Optional. ID of an existing <div> element to render into.
    //   When set, the SDK uses that element directly as the ad surface — no sibling
    //   div is injected, and the SDK does not override the element's sizing or layout.
    //   If the ID cannot be resolved at slot-registration time, an `error` event fires
    //   (code: E_CONFIG_INVALID) and the SDK falls back to the default sibling-injection path.
    //   On destroy(), the element's contents are cleared but the element is not removed.
    //   Omit to keep the default behaviour: SDK injects a sized <div> after the <script> tag.
  },
};
```

### `mediaTypes.banner`

```js
banner: {
  sizes: [[300, 250], [320, 50]],
  //   Flat array OR responsive map:
  //   sizes: { mobile: [[320, 50]], tablet: [[300, 250]], desktop: [[728, 90]] }
  //   Breakpoints inferred from window.innerWidth.

  shrinkToAdSize: true,
  //   true = container css shrink to winning creative size after render.
}
```

### `mediaTypes.video`

```js
video: {
  context: "instream",            // "instream" | "outstream"
  linearity: 1,                   // 1 = linear (in-stream), 2 = non-linear. Default 1; invalid → coerced to 1.
  playerSize: [640, 480],
  mimes: ["video/mp4", "application/javascript"],
  protocols: [1, 2, 3, 4, 5, 6, 7, 8],
  api: [1, 2],
  playbackmethod: [2],
  skip: 1,
  delivery: [1, 2],
  vastTimeoutMs: 8000,
  allowSkip: true,
}
```

`context: "instream"` require IMA SDK. SDK preload IMA before auction; on IMA load fail, slot strip video mediaType pre-auction and fall back to banner if banner also configured.

### `mediaTypes.native`

```js
native: {
  template: "<div><h3>{title}</h3><p>{body}</p><img src='{image}'></div>",
  //   Template string. Asset placeholders escape automatically.

  requiredAssets: ["title", "image"],
  //   Auction enforce presence. Missing required = noFill.
}
```

### Mixed mediaTypes

One slot can request banner + video + native demand in same auction. Winner routed by `bid.mediaType`:

```js
{
  mediaTypes: {
    banner: { sizes: [[300, 250]] },
    video:  { context: "outstream", linearity: 1, playerSize: [300, 250], mimes: ["video/mp4"] },
  },
  bidders: [
    { bidder: "pubmatic", params: { publisherId: "156276", adSlot: "test_banner" } },
    { bidder: "pubmatic", params: { publisherId: "156276", adSlot: "test_video" } },
  ],
}
```

Reserved size = max banner size. Video constrained to that area.

---

## Public API — `window.AdWrapper`

Available after first `<script src="pubads.mini.js">` execute.

```js
// Subscribe events
window.AdWrapper.on("adRenderSuccess", (p) => console.log(p));
window.AdWrapper.on("adRenderFail",    (p) => {});
window.AdWrapper.on("noFill",          (p) => {});
window.AdWrapper.on("viewable",        (p) => {});
window.AdWrapper.on("refresh",         (p) => {});
window.AdWrapper.on("error",           (p) => {});
window.AdWrapper.on("refresh_cap_reached", (p) => {});
window.AdWrapper.on("environment_detected", (p) => {});

// SPA destroy
window.AdWrapper.destroy("my_slot_id");
```

Payloads include `slotId`. Render events also include `adId`, `size`, `cpm`, `currency`, `cpmUsd`.

---

## Defaults reference

| Option | Default |
| --- | --- |
| `retryDelaysMs` | `[1000, 2000, 4000, 8000, 16000]` (5 attempts, exp backoff) |
| `consentTimeoutMs` | `8000` |
| `consentDisabled` | `false` |
| `minRefreshIntervalSec` | `30` |
| `currency.source` | `https://currency.prebid.org/latest.json` |
| `currency.ttlMs` | `86_400_000` (24h) |
| `environment` | `"auto"` |
| `prebidSrc` | `cdn.jsdelivr.net/npm/prebid.js@latest/dist/not-for-prod/prebid.js` (with warn) |
| `identityResolver` | absent — runtime not loaded (zero bytes) |
| `identityResolver.src` | `cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.0/dist/index.umd.js` |
| `identityResolver.timeoutMs` | `1000` ms |
| `identityResolver.tiers` | `[1, 2, 3, 4]` (all tiers) |
| `schain` | absent — no `pbjs.setConfig({ schain })` call |
| `ortb2` | absent — no first-party passthrough |
| `newrelic` | absent — NR sink disabled (zero bytes of NR agent loaded) |
| `newrelic.sampleRate` | `1.0` (errors always 100% regardless) |
| `newrelic.beacon` / `errorBeacon` | `bam.nr-data.net` (US). EU: `bam.eu01.nr-data.net`. |
| `newrelic.agentSrc` | `https://js-agent.newrelic.com/nr-loader-spa-current.min.js` |
| Bundle size cap | 30 KB gzipped |

### CSP requirements for `newrelic` option

The publisher CSP must allow the NR agent script + beacons:

```
script-src  ... https://js-agent.newrelic.com
connect-src ... https://*.nr-data.net
```

For EU data residency, replace `*.nr-data.net` with `*.eu01.nr-data.net` (or include both).

### NR event mapping

Every SDK emission routes through `newrelic.addPageAction("adwrapper_" + event, attrs)`. NRQL queries against `adwrapper_*` PageActions are the canonical view; the NR Errors UI is intentionally unused (see lockdown below).

| SDK event | NR PageAction name | Attributes |
| --- | --- | --- |
| `error` | `adwrapper_error` | `code`, `message`, `slotId?`, `sessionId` |
| `bidder_config` | `adwrapper_bidder_config` | `slotId`, `bidder_count`, `bidder_names` (CSV), `bidders_json` (stringified `[{bidder, params}]` with PII-class keys stripped) |
| `adRenderSuccess` | `adwrapper_adRenderSuccess` | `slotId`, `bidder`, `cpm_bucket`, `size`, `mediaType` |
| `adRenderFail` | `adwrapper_adRenderFail` | `slotId`, `reason` |
| `noFill` / `viewable` | `adwrapper_noFill` / `adwrapper_viewable` | `slotId` |
| `refresh` | `adwrapper_refresh` | `slotId`, `count` |
| `refresh_cap_reached` | `adwrapper_refresh_cap_reached` | `slotId`, `cap` |
| `environment_detected` | `adwrapper_environment_detected` | `environment` |

`bidder_config` fires once per slot when the auction enqueues (after lazy/consent gating, before `requestBids`). It does not re-fire on `refresh`. Bidder params are normalized — non-primitive values are JSON-stringified, and keys in the PII denylist (`email`, `hashedEmail`, `sha256email`, `uid2`, `uid2_token`, `userId`, `deviceId`, `ifa`, `idfa`, `gaid`, `eids`, `ip`, `tcString`, `gdprConsent`, `consent`, `usp`, `uspString`, `us_privacy`) are dropped before serialization. `bidders_json` is hard-truncated at 4000 characters.

`cpm` is never forwarded raw — bucketed to `Math.floor(cpm * 4) / 4` as `cpm_bucket` to bound NRQL cardinality and avoid exporting exact prices. Identifier-class fields (`eids`, `deviceId`, `userId`, `email`) are dropped by the allowlist even if present in upstream payloads.

### NR Browser feature lockdown (SDK-injected agent only)

When the SDK injects the NR loader (no pre-existing `window.newrelic` on the page), it seeds `NREUM.init` to disable every NR Browser auto-feature so the agent forwards only the `adwrapper_*` PageActions emitted by the SDK:

| NR feature | State | Effect |
| --- | --- | --- |
| `ajax` | `enabled: false` + `deny_list: ["*"]` | XHR/fetch calls are not reported |
| `jserrors` | `enabled: false` | Uncaught JS errors on the page are not reported |
| `metrics` | `enabled: false` | Web-vitals (LCP/FID/CLS), JS heap, etc. not reported |
| `page_view_event` | `enabled: false` | No PageView event |
| `page_view_timing` | `enabled: false` | No load timings |
| `session_replay` / `session_trace` | `enabled: false` | No replay or trace |
| `spa` | `enabled: false` | No SPA route-change tracking |
| `distributed_tracing` | `enabled: false` | No W3C trace headers added to outbound requests |
| `page_action` | `enabled: true` | **Only feature kept on; ferries `adwrapper_*` actions** |

If the publisher already has the NR Browser snippet installed in `<head>`, the SDK reuses `window.newrelic` instead of injecting its own loader — in that case this lockdown does **not** apply and the publisher's own NR config governs everything except the `adwrapper_*` PageActions the SDK emits.

---

## Local development

```sh
npm install
npm test          # Jest — 153 tests, 37 suites
npm run typecheck # tsc --noEmit
npm run build     # Rollup IIFE → dist/pubads.mini.js
npm run size      # Gzipped bundle cap check (30 KB)
npm run e2e       # Playwright smoke on demo page
npm run lint
npm run format
```

Demo pages in `test-page/`. After build:

```sh
npx http-server -p 4173 .
# http://127.0.0.1:4173/test-page/mixed-media.html   — banner+video mixed
# http://127.0.0.1:4173/test-page/index.html         — basic banner
```

---

## License

[Apache 2.0](./LICENSE).

```
claude-v --resume 69b76cf5-e935-4ab3-813e-ce29b67b3b9a                                                                                                                 
```