# Issue #0001 — `IdentitySignalMerger` pure-function module

> **Status: COMPLETE** — landed via TDD, 8 Jest cases green, full suite 194/45 passing.
> Type: AFK
> Parent: [docs/prd/0001-identity-resolver-integration.md](../prd/0001-identity-resolver-integration.md)
> Shipped artifacts: `src/core/identity-signal-merger.ts`, `tests/identity-signal-merger.test.ts`

## Parent

PRD: Identity Resolver Integration + Bid-Request Enrichment (`docs/prd/0001-identity-resolver-integration.md`)
ADR: `docs/adr/0001-identity-resolver-augment.md` (precedence rules are the canonical spec)
CONTEXT: D49 (Identity signal precedence)

## What to build

A single pure-function module that merges identity signals from two independent sources — the `identity-resolver` runtime and the SDK's existing Prebid userId modules — into a single `ortb2` patch ready for `pbjs.setConfig`.

The function has zero side effects, zero I/O, and zero global reads. It takes a resolver-output snapshot, an array of Prebid-emitted eids, and a `ConsentSnapshot`, and returns the merged `ortb2.user` + `ortb2.regs` blocks. All precedence rules from ADR-0001 are encoded here:

- `user.eids[]` — union by `source` URI; resolver value wins on conflict.
- `user.buyeruid` — resolver only.
- `user.eids` + `user.buyeruid` are stripped when `ConsentSnapshot.blocked === true`.
- `regs.ext.gdpr` / `regs.ext.us_privacy` / `user.consent` — ConsentManager wins; resolver values are fallback only.

```ts
// Decision-rich type shape (from grilling Q8):
export function mergeIdentitySignals(input: {
  resolver: ResolverSignals | null;
  prebidEids: ReadonlyArray<Eid>;
  consent: ConsentSnapshot;
}): Ortb2Patch;
```

This is the **deepest testable module** of the integration: the contract that downstream slices (#3, #4) consume.

## Acceptance criteria

- [x] New module exposes a single function `mergeIdentitySignals` with the type shape above.
- [x] Resolver `eids` + Prebid `eids` with disjoint `source` URIs are unioned in the output.
- [x] Same `source` URI in both inputs → resolver value wins; Prebid value discarded.
- [x] `consent.blocked === true` → output `user.eids` is empty AND `user.buyeruid` is undefined.
- [x] `consent.blocked === true` → `regs.ext.gdpr` is still emitted in output.
- [x] `resolver === null` (load failure) → output `user.eids` derived from Prebid only; `user.buyeruid` undefined; no throw.
- [x] `consent.tcfApplies === true && !blocked` → `regs.ext.gdpr === 1`.
- [x] `consent.tcfApplies === false` → `regs.ext.gdpr === 0`.
- [x] `consent.uspString` present → wins over `resolver.regs.ext.us_privacy` in output.
- [x] `consent.uspString` absent + resolver value present → resolver fallback wins.
- [x] Empty `eids: []` in resolver treated identically to `eids: undefined`.
- [x] Multi-`uids` per source preserves the full uids array.
- [x] Module has 100% statement + branch coverage. No code paths uncovered.
- [x] No regression in existing 186-test suite.
- [x] No new bundle bytes shipped (pure-function — tree-shaken until slice #4 imports it).

## Blocked by

None — can start immediately.
