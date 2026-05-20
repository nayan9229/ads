# Publisher-configurable New Relic Browser sink (no shipped NR SDK)

## Context

The SDK had one telemetry path: lifecycle callbacks plus an optional `analytics.endpoint` that beacons batched events to a publisher-provided URL (D16). Publishers asked for first-class New Relic visibility — errors grouped in NR Errors, lifecycle events queryable in NRQL — without standing up their own beacon collector.

The original request was "OpenTelemetry logs via New Relic", but the OTel JS browser logs stack (`@opentelemetry/api-logs` + `sdk-logs` + `exporter-logs-otlp-http`) is ~25–40 kB gz before any of our code. The SDK has a hard 30 kB gz cap on `dist/pubads.mini.js` enforced by `scripts/check-bundle-size.mjs`. Shipping OTel into every publisher page is not viable.

## Decision

Add an optional `BootstrapOptions.newrelic` block. When set, a `NewRelicSink` subscribes to the existing `CallbackRegistry` (the same `FORWARDED_EVENTS` set the analytics beacon already uses) and forwards to the publisher's New Relic Browser agent. Three architectural commitments:

1. **No NR SDK code in our bundle.** Forwarder is a thin (~1–2 kB gz) module that calls `window.newrelic.noticeError` / `window.newrelic.addPageAction`. We do not bundle, vendor, or transpile any NR SDK source.
2. **No license key in our source.** Publisher passes `licenseKey` + `applicationID` (+ optional `accountID`, `beacon`, `errorBeacon`, `trustKey`) into `init()`. If their key leaks via view-source, that is their NR account, not a shared one — keys are never embedded by the SDK.
3. **Two install paths, publisher chooses implicitly.** If `window.newrelic` is already present (publisher installed the NR snippet in `<head>` — recommended for accurate page-load timing), the sink uses it directly. Otherwise, when `newrelic.enabled !== false`, the sink seeds `window.NREUM = { loader_config, info, init }` from the supplied config and async-injects the NR loader script (default `https://js-agent.newrelic.com/nr-loader-spa-current.min.js`, overridable via `agentSrc`). Events fired before the agent finishes loading are buffered in a 50-entry FIFO and flushed on load; on load failure the queue is silently dropped — the publisher's `analytics.endpoint` beacon (if configured) still runs.

## NR API map

| SDK event | NR call |
| --- | --- |
| `error` (callback) | `newrelic.addPageAction("adwrapper_error", { code, message, slotId?, sessionId })` |
| All other `FORWARDED_EVENTS` | `newrelic.addPageAction("adwrapper_" + event, attrs)` |

`addPageAction` carries every SDK emission, including errors. We do not use `newrelic.noticeError` — that path requires the NR Browser agent's `jserrors` feature, which we explicitly disable (see "Lockdown" below). The trade-off is loss of NR Errors UI grouping in exchange for the ability to forward zero page-level data. NRQL queries against `adwrapper_*` actions are the canonical view.

## Lockdown — ad-lifecycle only, no page data

When the SDK injects the NR loader (no pre-existing `window.newrelic`), the seeded `NREUM.init` block disables every NR Browser auto-feature so the agent forwards only the `adwrapper_*` PageActions emitted by this sink:

```js
NREUM.init = {
  ajax:               { enabled: false, deny_list: ["*"] },
  jserrors:           { enabled: false },
  metrics:            { enabled: false },
  page_action:        { enabled: true,  harvestTimeSeconds: 30 },
  page_view_event:    { enabled: false },
  page_view_timing:   { enabled: false },
  session_replay:     { enabled: false },
  session_trace:      { enabled: false },
  spa:                { enabled: false },
  distributed_tracing:{ enabled: false },
  privacy:            { cookies_enabled: false },
};
```

The publisher's page views, XHR/fetch traffic, uncaught JS errors, web-vitals (LCP/FID/CLS), and session traces never reach NR via the SDK-injected agent. The publisher's own analytics stack remains the canonical source for that data.

If a publisher's own NR snippet is already present in `<head>`, the sink reuses `window.newrelic` instead of injecting its own loader — in that case this lockdown does NOT apply and the publisher's existing NR config governs everything except the `adwrapper_*` PageActions the sink emits.

## Attribute allowlist

A hard-coded per-event allowlist runs before every emission. Anything not on the list is dropped, including identifier-class fields that may sit in event payloads (`eids`, `deviceId`, `userId`, `email`).

| Event | Forwarded attributes |
| --- | --- |
| `error` | `code`, `slotId?`, `message` (truncated 200 chars) |
| `adRenderSuccess` | `slotId`, `bidder`, `cpm` (bucketed → `cpm_bucket`), `size`, `mediaType` |
| `adRenderFail` | `slotId`, `reason` |
| `noFill` | `slotId` |
| `viewable` | `slotId` |
| `refresh` | `slotId`, `count` |
| `refresh_cap_reached` | `slotId`, `cap` |
| `environment_detected` | `environment` |

Common attributes (`sessionId`, `sdkVersion`) are appended by the sink to every call.

`cpm` is bucketed via `Math.floor(cpm * 4) / 4` (0.25 increments) and emitted as `cpm_bucket` — never raw. This bounds NRQL cardinality and avoids exporting exact prices to a third-party telemetry vendor.

## Sampling

`error` is always 100 %. All other events share one session-coherent sample decision derived from `newrelic.sampleRate` (default 1.0) at sink construction — a session is either fully sampled-in or fully sampled-out. Same `rng` / `sessionId` pattern as `AnalyticsEmitter` for D16 consistency.

## Considered alternatives

- **OpenTelemetry browser SDK with OTLP/HTTP exporter to NR ingest** — rejected on bundle size (~25–40 kB gz minimum vs 30 kB total cap). Would also require a public OTLP ingest with our license key in headers, exposing it on every publisher page.
- **SDK injects NR agent with our (SDK vendor) license key** — rejected. Would embed our key in every publisher page, bill us per publisher page-view, and force CSP/consent decisions on every publisher.
- **Send SDK telemetry to our own collector that forwards to NR** — rejected: SDK has no backend and adding one breaks D16 (no SDK-owned analytics backend).
- **Repoint `analytics.endpoint` at NR's OTLP ingest** — rejected: would break publishers using their own endpoint and silently start exfiltrating to a third party.
- **Hand-rolled OTLP-JSON beacon (no NR SDK)** — viable on bundle, but loses NR Errors grouping (`noticeError` does stack-trace fingerprinting) and PageAction-native NRQL. Re-evaluate if NR adds a "raw events" endpoint.

## Consequences

- Two telemetry sinks coexist (publisher beacon + NR). They consume the same callback stream; adding a third sink follows the same pattern.
- When the SDK injects the NR loader (no pre-existing `window.newrelic`), page-load timing metrics in NR are degraded — NR agent missed `document_start`. Documented as a known limitation; recommend publishers install the NR snippet in `<head>` if they care about page-load timings.
- CSP additions are publisher-owned: `script-src https://js-agent.newrelic.com` and `connect-src https://*.nr-data.net` (or EU equivalents). README documents this.
- Bundle impact ~1.5 kB gz for `nr-sink.ts`; well within the 30 kB cap.
- Bid-price exact values never reach NR; only `cpm_bucket`. Downstream NR alerts that expect exact CPM need to be re-defined against buckets.
