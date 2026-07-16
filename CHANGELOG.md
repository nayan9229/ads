# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.2](https://github.com/nayan9229/ads/compare/v1.4.1...v1.4.2) (2026-07-16)

### Bug Fixes

* **build:** stamp live build timestamp banner on shipped bundles ([443c317](https://github.com/nayan9229/ads/commit/443c3176d639938eb0acf03c2187eed5231c5b15))




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-6eSgYfwSwR8Vdba7PY7jhZXvxSQlZ1rTgGRCy2lJ4AvUBU2dlwa+NNJHe+WhtYPW`
- `dist/pubads.mini.esm.js` — `sha384-ZjbG4m/EZz/DMuZvshkosO0xPzBwL6hHmZwtc8qrTzbYDZGw3WHROzjdDMW1FZhb`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

## [1.4.1](https://github.com/nayan9229/ads/compare/v1.4.0...v1.4.1) (2026-07-16)

### Bug Fixes

* **video:** forward outstream renderer stub + plcmt/maxduration to Prebid adUnit ([82ef6fa](https://github.com/nayan9229/ads/commit/82ef6fa5aa4633982aab331b4c7d533b50a181b1)), closes [#20](https://github.com/nayan9229/ads/issues/20)




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-DA9oRUE/VEgqd1AQOf1K9w54zJ6UvamxnuxkoKznwneErUF9KIkMt2MPhirOsOZP`
- `dist/pubads.mini.esm.js` — `sha384-6AClAi4Q+xo7eMApL1X3mGUBLcsp58zYTmIn52lpQiEYCDeJhm563j3x5XAqFWmr`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

## [1.4.0](https://github.com/nayan9229/ads/compare/v1.3.0...v1.4.0) (2026-07-02)

### Features

* **refresh:** per-mediaType refresh; video refreshes on ad-complete or skip ([3f092bc](https://github.com/nayan9229/ads/commit/3f092bc8dce2e1fba7858a8afd665e07572c0bf0))
* **surface:** detect execution surface + GAM-creative backfill with injected signals ([ccefd17](https://github.com/nayan9229/ads/commit/ccefd1712a2c59fed719f6e7042e0cb4cbd2489d))




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-TXF2fvvNz5ji9So+ZmEDFZQBePZCZs83G3CG73uG6kZEl7cueqTLLXZDISyyjdzF`
- `dist/pubads.mini.esm.js` — `sha384-9iFkhN3Al5wi2zhtNBYPXoxO+9VlqD9+kr2voOwHnq6tHF5orM7AoTl4JPNOjFqd`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

## [1.3.0](https://github.com/nayan9229/ads/compare/v1.2.2...v1.3.0) (2026-07-01)

### Features

* **prebid:** bundle priceFloors module so prebidConfig.floors emits imp.bidfloor ([8f2e819](https://github.com/nayan9229/ads/commit/8f2e819f74492f633b5f89d7b78b63e0157afce2))
* **refresh:** move refresh config from slot to mediaType level ([252f711](https://github.com/nayan9229/ads/commit/252f71186429757fc9f540c616699a8484615ac1))




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-tVT94LjBzpZeNXdkv8IMk29PoV3e5vDj83wxy4Gb5tcXruN2wSEk7Ow/Sr/HQldx`
- `dist/pubads.mini.esm.js` — `sha384-1npO4BSdZhJdkhNzXRMy8n3N+SB7d2tZbvVOpn1W6Z6TQ4wN0p8ddnsBZsM+3Gv/`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

## [1.2.2](https://github.com/nayan9229/ads/compare/v1.2.1...v1.2.2) (2026-06-18)

### Bug Fixes

* **prebid:** inline isolated renamed-global Prebid; never reuse host pbjs ([b54be70](https://github.com/nayan9229/ads/commit/b54be70c7d36e1619167f60f1e2a2749e1680576))




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-l7RFbm3GMjM9N0z1cEvGN8wnAOU3EhEvs7LD+AHioAqo8V8XvGQp/zPHO2SeztCU`
- `dist/pubads.mini.esm.js` — `sha384-tgsds0+hreXGmwIEYxqe2B8oKvLH5kpifl4hdTDor5uYLnlSEZQZLuUMR/oKn3pf`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

## [1.2.1](https://github.com/nayan9229/ads/compare/v1.2.0...v1.2.1) (2026-06-05)

### Build

* republish bundle; bump CI actions (checkout/setup-node) to v5 / Node 24 (manual release)

## [1.2.0](https://github.com/nayan9229/ads/compare/v1.1.5...v1.2.0) (2026-06-05)

### Features

* **bootstrap:** add registerSlot for Shadow DOM hosts ([76f53d1](https://github.com/nayan9229/ads/commit/76f53d1b8c3ef8a251f835822bff00059f17f4cd))




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-POiu1TqKa4Zq1lXBcW0N09jMbAj5V0589sQ+lDZb6otBM1Ef7w8VjI5KTq8VbsPe`
- `dist/pubads.mini.esm.js` — `sha384-DyT5T22H7uWWf/4BFUFCiSx64flsp8aNLTvOlNPBq4GxsiIdrXT6QKbHYDZxfJlS`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

## [1.1.5] — 2026-05-22

### Features

- **`adSkipped` lifecycle event** (D59) — fires when the user clicks the IMA skip button (`SKIPPED` event). Video-only. Does NOT emit `viewable` or `adComplete` — skip is early termination, not IAB-viewable engagement or natural completion. Payload: `{ slotId, mediaType: "video" }`. Added to `FORWARDED_EVENTS` (analytics beacon + NR sink). Named `adSkipped` consistent with `adRenderSuccess`/`adComplete` prefix pattern.

### Bundle

- gzipped `dist/pubads.mini.js`: 12.93 KB → 12.96 KB (+0.03 KB). Cap unchanged (30 KB gz); 17.04 KB headroom.

## [1.1.4](https://github.com/nayan9229/ads/compare/v1.1.3...v1.1.4) (2026-05-21)

### Docs

* document adComplete callback in README (v1.1.3) ([b2b6a66](https://github.com/nayan9229/ads/commit/b2b6a66d792b57e70b2d129ee735cc241df98ed3))
* **readme:** update test count to 244 tests, 53 suites ([a81cd61](https://github.com/nayan9229/ads/commit/a81cd61204bd3c2de03c9384feb3ef26a2c667c2))




## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-T5YSlxsPnt5rfZmJcWPIgYHeAyAjJ1kaC2h8jFkYNnNkboCaMNY37zq1qmnqWP9T`
- `dist/pubads.mini.esm.js` — `sha384-aSfCTihyqPw0LJilApSSSo5c6xZL/bXl0mJmHUQmU6nWmSu7e7KsiIc6WW73FbHj`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries are appended automatically by `semantic-release` on every push to `main`
or `rc`. Do not edit prior entries by hand — re-tag via the rollback runbook
([docs/rollback.md](docs/rollback.md)) instead.

## [Unreleased]

## [1.1.3] — 2026-05-21

### Features

- **`adComplete` lifecycle event** (D58) — fires when an ad has run its course: for video, emitted immediately after IMA `COMPLETE` (clean playback end; errors and skips excluded); for banner, emitted after a configurable `adCompleteDelayMs` (default 10 000 ms) following the banner render. When `refresh` is configured, the banner timer starts only after the last refresh cycle's render (`onCapReached` flag + Option-B timing). Timer cleared on `destroy()`. Payload: `{ slotId, mediaType: "banner" | "video" }`. Added to `FORWARDED_EVENTS` (analytics beacon + NR sink). Per-slot config: `adCompleteDelayMs?: number` (non-negative, defaults to 10 000 ms).

### Bundle

- gzipped `dist/pubads.mini.js`: 12.75 KB → 12.93 KB (+0.18 KB). Cap unchanged (30 KB gz); 17.07 KB headroom.

## [1.1.1] — 2026-05-20

### Features

- **New Relic Browser sink** (D54–D56) — optional `BootstrapOptions.newrelic = { licenseKey, applicationID, accountID?, beacon?, errorBeacon?, agentSrc?, sampleRate?, enabled? }`. SDK reuses an existing `window.newrelic` or async-injects the NR loader with `NREUM.init` locked down to ad-lifecycle PageActions only — every NR auto-feature (`ajax`, `jserrors`, `metrics`, `page_view_event`, `page_view_timing`, `session_replay`, `session_trace`, `spa`, `distributed_tracing`) is `enabled: false`. License key never embedded in SDK; per-event attribute allowlist + cpm bucketing (0.25) + identifier-class drop. Errors emitted as `adwrapper_error` PageActions (not `noticeError`). 50-entry pre-ready FIFO. See `docs/adr/0002-newrelic-browser-sink.md`.
- **`bidder_config` lifecycle event** (D57) — fires once per slot at auction start with normalized bidder snapshot: `{ slotId, bidder_count, bidder_names (CSV), bidders_json }`. Bidder params run through a PII denylist (`email`/`hashedEmail`/`uid2`/`userId`/`deviceId`/`ifa`/`idfa`/`gaid`/`eids`/`ip`/consent strings) before serialization; `bidders_json` hard-capped at 4000 chars. Forwarded through both the publisher analytics beacon and the NR sink.
- **Build banner on dist bundles** — every `dist/pubads.mini*.js` opens with `/*! @nayan9229/ads v<version> | build <ISO timestamp> | commit <sha7> | (c) <year> <license> */`. Picks up `GITHUB_SHA` / `GIT_COMMIT` env vars in CI.

### Bundle

- gzipped `dist/pubads.mini.js`: 11.11 KB → 12.75 KB (+1.64 KB). Cap unchanged (30 KB gz); 17.25 KB headroom.

## [1.1.0](https://github.com/nayan9229/ads/compare/v1.0.1...v1.1.0) (2026-05-19)

### Features

* add container field to per-slot config for explicit DOM target (D53) ([6b3163d](https://github.com/nayan9229/ads/commit/6b3163dd0142d6604d83451d8a6f983a447483f3))

## Subresource Integrity

```
# Subresource Integrity hashes

- `dist/pubads.mini.js` — `sha384-RLC9hp6iQgynVYakizKSkEPsPjIUsnT7yapk/LMNOe7AGzVUdQMBg7XzA6h0Jar1`
- `dist/pubads.mini.esm.js` — `sha384-O2TWboxWcjvo7PDQ1oyswklYdaCnD3F6kiwJ0XE8MR3wRGPJKhqg1tbCPYRAYIwV`

Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.
```

<!-- semantic-release will insert versioned sections above this line on each release -->
