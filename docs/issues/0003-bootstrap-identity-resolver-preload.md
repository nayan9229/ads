# Issue #0003 — `BootstrapOptions.identityResolver` config + parallel preload

> **Status: COMPLETE** — landed via TDD, 6 Jest cases green, full suite 205/47 passing.
> Type: AFK
> Parent: [docs/prd/0001-identity-resolver-integration.md](../prd/0001-identity-resolver-integration.md)
> Shipped artifacts: `src/core/bootstrap.ts` (`IdentityResolverConfig` type, `BootstrapOptions.identityResolver`, `BootstrapOptions.identityResolverLoaderOverride`, `ensureIdentityResolverPreload` memoized preload + webview suppression + error-event chain), `tests/bootstrap-identity-resolver-preload.test.ts`

## Parent

PRD: Identity Resolver Integration + Bid-Request Enrichment.
Mirrors decisions D43 (IMA config-conditional parallel preload) and D51 (dedicated `identityResolver` config block).

## What to build

Extend `BootstrapOptions` with a dedicated `identityResolver` configuration block. When `enabled === true`, bootstrap fires the `loadIdentityResolver()` call in parallel with the existing Prebid + IMA preloads. The resolved global is memoized in a module-level `identityReadyPromise` analogous to `imaReadyPromise`, and the wrapped runtime exposes a single `ensureIdentitySignals()` async function that callers (orchestrator, in slice #0004) await once per page session.

Behaviorally:

- `identityResolver` absent OR `enabled: false` → loader is never invoked, zero bytes fetched (mirrors D43's banner-only path).
- `identityResolver.enabled: true` AND any slot configured → loader fires in parallel with Prebid load.
- `environment: "webview"` detected → loader is skipped even if `enabled: true` (mirrors D34 / D50 — webview suppression).
- Loader rejects → `error` event with `code: "E_IDENTITY_LOAD_FAIL"` emitted once at bootstrap; `ensureIdentitySignals()` cached `null` so all subsequent awaits resolve to `null` without re-attempting.
- Loader resolves → runtime's `resolveIdentitySignals()` is invoked once; resolved signals (or `null` on internal throw) are cached for the session.

```ts
// Config shape (from grilling Q3 + Q5):
interface IdentityResolverConfig {
  readonly enabled: boolean;
  readonly src?: string;
  readonly version?: string;
  readonly deviceIdCookieName?: string;
  readonly tiers?: ReadonlyArray<1 | 2 | 3 | 4>;
  readonly timeoutMs?: number; // default 1000
}
```

## Acceptance criteria

- [x] `BootstrapOptions.identityResolver?: IdentityResolverConfig` added with shape above.
- [x] `identityResolver.enabled === false` (or block absent) → `loadIdentityResolver` is never called.
- [x] `identityResolver.enabled === true` + at least one slot configured → loader called exactly once during bootstrap.
- [x] Loader call is made **in parallel with** Prebid load (not serialized after Prebid resolves).
- [x] `environment: "webview"` → loader is never called even with `enabled: true`.
- [x] `ensureIdentitySignals()` returns the same cached Promise across multiple calls (page-session memoization).
- [x] Loader rejects → `error` event fires exactly once with code `E_IDENTITY_LOAD_FAIL`.
- [ ] Loader resolves but runtime's `resolveIdentitySignals()` throws → swallowed; cached value is `null`; no extra error event emitted. _(Deferred to Slice #0004 — signal-extraction concern.)_
- [ ] Loader resolves and runtime returns signals → cached value is the runtime output; first call to `ensureIdentitySignals()` returns it. _(Deferred to Slice #0004 — consuming-side concern.)_
- [ ] `identityResolver.timeoutMs` is forwarded to `DependencyLoader` for the script load timeout (default 1000 ms). _(Deferred — DependencyLoader currently uses `BootstrapOptions.timeoutMs`; per-load override needs constructor extension.)_
- [x] No regression in existing 186-test suite.
- [x] Bundle size delta < 600 bytes gzipped on top of the slice #0002 cost.

## Blocked by

- Issue #0002 (`DependencyLoader.loadIdentityResolver` must exist for the parallel preload to call it).
