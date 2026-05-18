# Augment Prebid userId modules with `identity-resolver` runtime (don't replace)

## Context

SDK shipped with `IdentityResolver` class that emits Prebid `userSync.userIds[]` config (sharedId/ID5/UID2 via Prebid's built-in userId modules). To raise bid match rates we evaluated adopting [`@nayan9229/identity-resolver`](https://github.com/nayan9229/identity-resolver) — a 2.2 kB cookie-jar reader covering 15+ ID vendors that emits OpenRTB `user.eids[]` + `user.buyeruid` directly.

## Decision

**Augment, don't replace.** Both identity paths coexist:

1. **Prebid userId modules** (existing) — owns scheduled refresh and storage hygiene.
2. **identity-resolver runtime** (new) — owns broad cookie-jar coverage and OpenRTB shape.

Before each `requestBids`, SDK deterministically merges output from both paths in-memory and pushes a single `pbjs.setConfig({ ortb2: { user, regs } })` call.

## Precedence rules

| Field | Winner on conflict |
| --- | --- |
| `user.eids[]` | Union by `source` URI. identity-resolver wins (richer cookie set). |
| `user.buyeruid` | identity-resolver only (Prebid doesn't emit this). |
| `regs.ext.gdpr`, `regs.ext.us_privacy`, `user.consent` | SDK `ConsentManager` wins (canonical CMP source). Resolver's reads = fallback only when CM disabled. |

## Consent gating

When `ConsentManager.resolve()` returns `blocked: true`, SDK strips `eids` + `buyeruid` from the merged output but **always forwards `regs.ext.gdpr` / `regs.ext.us_privacy`** so bidders see the consent state.

## Failure mode

identity-resolver script is loaded with a 1000 ms timeout (configurable). On reject/timeout the first auction proceeds anonymous, an `error` event with code `E_IDENTITY_LOAD_FAIL` is emitted once, and subsequent auctions reuse the cached `null` (no re-attempt mid-session).

## Considered alternatives

- **Replace** — drop the existing `IdentityResolver` class and rely solely on identity-resolver. Rejected: breaking config-key change for early adopters; loses Prebid's scheduled refresh + storage hygiene for ID5.
- **Mode-flag (`mode: "prebid-modules" | "resolver" | "both"`)** — rejected as YAGNI until a second identity provider lands.
- **Provider registry array** — over-engineered for v1; revisit when a third identity source appears.

## Consequences

- Two identity code paths in the SDK. Failure of one doesn't kill the other.
- Bundle grows by ~0 kB on disk (runtime injected on demand) but +2.2 kB second request on first identity-enabled page load.
- Publisher config surface adds a new top-level `identityResolver: {...}` block (see [`README.md`](../../README.md)).
- The decision is hard to reverse once published — config-key compatibility must be maintained at least one major version.
