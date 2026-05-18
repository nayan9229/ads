# Issue #0002 — `DependencyLoader.loadIdentityResolver()` + test override

> **Status: COMPLETE** — landed via TDD, 5 Jest cases green, full suite 199/46 passing.
> Type: AFK
> Parent: [docs/prd/0001-identity-resolver-integration.md](../prd/0001-identity-resolver-integration.md)
> Shipped artifacts: `src/core/errors.ts` (`E_IDENTITY_LOAD_FAIL`), `src/core/dependency-loader.ts` (`loadIdentityResolver`, `DEFAULT_IDENTITY_RESOLVER_SRC`, `IdentityResolverGlobal`, `_resetReuseWarnState` extended), `tests/dependency-loader-identity.test.ts`
> Note: `BootstrapOptions.identityResolverLoaderOverride` (last unticked criterion) deferred to Slice #0003 — it's a bootstrap surface concern, not a loader concern.

## Parent

PRD: Identity Resolver Integration + Bid-Request Enrichment.
Mirrors decisions D44 (default dependency URLs) and D45 (reuse pre-existing globals + warn) from `CONTEXT.md`.

## What to build

Extend the existing `DependencyLoader` with a third loader method — `loadIdentityResolver()` — that injects the `identity-resolver` UMD bundle, resolves to the `window.OpenRTBIdentityResolver` global, and follows the same conventions as `loadPrebid` and `loadIMA`.

- Default `src` is `https://cdn.jsdelivr.net/gh/nayan9229/identity-resolver@1.0.0/dist/index.umd.js` (overridable via constructor option).
- Detect pre-existing `window.OpenRTBIdentityResolver` and reuse it; emit a one-time `console.warn` (module-level dedupe, matching the existing pattern for `pbjs` and `google.ima`).
- CSP nonce propagation (`opts.nonce`).
- Reject after `timeoutMs` with a typed `WrapperError` carrying `code: ErrorCode.E_IDENTITY_LOAD_FAIL`.
- Reject on `script.onerror` with the same code.
- Memoize the in-flight promise — repeated calls reuse the same promise.

A matching `_resetReuseWarnState()` export must clear the new warn-state flag too (for tests).

A `BootstrapOptions.identityResolverLoaderOverride?: () => Promise<IdentityResolverGlobal>` knob must be added to the bootstrap surface to allow tests to inject the loader without touching the script-tag layer (mirrors `prebidLoaderOverride` and `imaLoaderOverride`).

## Acceptance criteria

- [x] New `loadIdentityResolver(): Promise<IdentityResolverGlobal>` method on `DependencyLoader`.
- [x] New `ErrorCode.E_IDENTITY_LOAD_FAIL` added to the error registry.
- [x] Pre-existing `window.OpenRTBIdentityResolver` → method resolves to it; emits one console.warn; no `<script>` tag injected.
- [x] No pre-existing global → script tag injected with default jsDelivr-GH src, resolves when `window.OpenRTBIdentityResolver` appears.
- [x] `script.onload` fires but global is missing → rejects with `E_IDENTITY_LOAD_FAIL`.
- [x] `script.onerror` fires → rejects with `E_IDENTITY_LOAD_FAIL`.
- [x] Timeout fires (`timeoutMs` elapsed before load) → rejects with `E_IDENTITY_LOAD_FAIL`.
- [x] CSP nonce option propagates to the injected `<script>` tag.
- [x] In-flight promise is memoized — second `loadIdentityResolver` call returns the same Promise.
- [x] One-time `console.warn` is module-scoped: multiple loaders in the same module instance still produce a single warn.
- [x] `_resetReuseWarnState()` resets the new flag in addition to existing ones.
- [ ] `BootstrapOptions.identityResolverLoaderOverride` is honored when present, bypassing the real loader. _(Deferred to Slice #0003 — bootstrap-surface concern.)_
- [x] No regression in existing 186-test suite.
- [x] Bundle size delta < 250 bytes gzipped (loader is tiny; bulk lives in the injected runtime).

## Blocked by

None — can start immediately. Slice #0001 and #0002 can run in parallel.
