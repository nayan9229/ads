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
