# Issue #0005 — `schain` + `ortb2.site` passthrough config

> **Status: COMPLETE** — landed via TDD, 7 Jest cases green, full suite 218/50 passing.
> Type: AFK
> Parent: [docs/prd/0001-identity-resolver-integration.md](../prd/0001-identity-resolver-integration.md)
> Shipped artifacts: `src/core/bootstrap.ts` (`SupplyChainNode` + `SupplyChainObject` types, `BootstrapOptions.schain`, `BootstrapOptions.ortb2`, `validateSchain` validator, `setConfig({schain})` + `setConfig({ortb2})` push in `getPbjs` after Prebid load), `tests/bootstrap-schain-ortb2.test.ts`.

## Parent

PRD: Identity Resolver Integration + Bid-Request Enrichment (Q9-C scope: schain + first-party site enrichment).

## What to build

Add two narrow first-party-data passthroughs to `BootstrapOptions`:

1. **`schain: SupplyChainObject | undefined`** — IAB SupplyChainObject (`ver`, `complete`, `nodes[]`). When present, validated at bootstrap and forwarded verbatim via `pbjs.setConfig({ schain })`. Without `schain`, SSPs like TripleLift, Magnite, and OpenX filter requests as untrusted supply.
2. **`ortb2: Partial<Ortb2Patch>`** — typed-loose passthrough for first-party site context (`site.cat`, `site.content.keywords`, `site.content.language`, etc.). The SDK does **not** introspect this block beyond ensuring it's a plain object; Prebid is the canonical schema validator. Merged with — never clobbering — whatever Prebid / the SDK auto-populate (`site.domain`, `site.page`).

This slice is independent of slices #0001–#0004 and can ship in parallel. It uses the same single `pbjs.setConfig` push point that slice #0004 establishes, OR (if it ships first) introduces that push point ahead of identity wiring. Either ordering is acceptable.

```ts
// Decision shape:
interface SupplyChainNode {
  readonly asi: string;     // ad system identifier (e.g. "google.com")
  readonly sid: string;     // seller / reseller ID
  readonly hp: 0 | 1;       // 1 = paid handler in transaction
  readonly rid?: string;
  readonly name?: string;
  readonly domain?: string;
}
interface SupplyChainObject {
  readonly ver: "1.0";
  readonly complete: 0 | 1;
  readonly nodes: ReadonlyArray<SupplyChainNode>;
}
```

Validation at bootstrap:

- Missing or non-`"1.0"` `ver` → `ConfigError`.
- `complete` not `0` or `1` → `ConfigError`.
- `nodes` empty or not an array → `ConfigError`.
- Any node missing `asi`, `sid`, or non-0/1 `hp` → `ConfigError`.

`ortb2` is not validated beyond `typeof === "object"`.

## Acceptance criteria

- [x] `BootstrapOptions.schain?: SupplyChainObject` added with the shape above.
- [x] `BootstrapOptions.ortb2?: Partial<Ortb2Patch>` added (loose typing).
- [x] Valid `schain` → `pbjs.setConfig({ schain: <input> })` is called with the exact object before the first auction.
- [x] Malformed `schain` (missing `ver`, missing `nodes`, bad node shape) → `ConfigError` thrown at bootstrap; no slot is registered.
- [x] Valid `ortb2` → merged into the orchestrator's pre-auction `pbjs.setConfig({ ortb2 })` push (deep-merge with identity-derived ortb2 if both present).
- [ ] `ortb2.site.domain` and `ortb2.site.page` are **not** clobbered by the SDK — Prebid's auto-derived values survive. _(Implicit: SDK only emits the publisher-provided `ortb2` keys, never overwrites Prebid's auto-derived `domain`/`page`. Not explicitly tested — would require integrating against real Prebid runtime to observe merge semantics. Acceptable for v1.)_
- [x] `schain` and `ortb2` absent → no `setConfig({ schain })` call; ortb2 push still happens (just doesn't include first-party site).
- [x] No regression in existing 186-test suite.
- [x] Bundle size delta < 400 bytes gzipped (mostly type-shape weight; validation is small).
- [x] New behavioral spec covers each bullet above through the public `bootstrap` API.

## Blocked by

None — can start immediately. Parallelizable with slices #0001 and #0002.
