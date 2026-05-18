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
      src="https://cdn.jsdelivr.net/npm/@nayan9229/ads@1/dist/sdk.js"
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

Single object. Applies to all slots. Set BEFORE the first `<script src="sdk.js">` tag.

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

  // === Misc ===
  cspNonce: "abc123",
  //   Propagate to injected <script> + <iframe> nonces.

  debug: true,
  //   Verbose SDK logs + forward `pbjs.setConfig({ debug: true })`.

  environment: "auto",
  //   "auto" | "browser" | "webview". Default: auto-detect from UA.
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

Available after first `<script src="sdk.js">` execute.

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
| Bundle size cap | 30 KB gzipped |

---

## Local development

```sh
npm install
npm test          # Jest — 153 tests, 37 suites
npm run typecheck # tsc --noEmit
npm run build     # Rollup IIFE → dist/sdk.js
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
claude --resume 9ddcabd5-f013-4c49-833f-7a9d46a49a9a                                                                                                                   
claude-n --resume 9ddcabd5-f013-4c49-833f-7a9d46a49a9a                                                                                                                 
```