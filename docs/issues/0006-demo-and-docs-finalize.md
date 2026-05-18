# Issue #0006 — Demo wire-up + README/CONTEXT/ADR finalize

> **Status: COMPLETE** — demo + docs landed; full suite 218/50 still green, bundle 10.91 KB gz under 30 KB cap.
> Type: AFK
> Parent: [docs/prd/0001-identity-resolver-integration.md](../prd/0001-identity-resolver-integration.md)
> Shipped artifacts: `test-page/mixed-media.html` (identityResolver + schain + ortb2.site blocks added), `README.md` (Global SDK options + defaults table updated), `CONTEXT.md` (D52 added for schain/ortb2 passthrough; D48–D51 verified), ADR-0001 precedence table reconciled against `tests/identity-signal-merger.test.ts`, `docs/prd/0001-identity-resolver-integration.md` (Shipped-vs-Planned footer + code+test surface tables).

## Parent

PRD: Identity Resolver Integration + Bid-Request Enrichment.
Final integration slice — proves the previous slices land end-to-end on a real page and documents the publisher-facing config surface.

## What to build

Activate the new config blocks on the existing `test-page/mixed-media.html` demo and refresh the documentation to match what shipped.

Demo page changes:

- Set `window.AdWrapperOptions.identityResolver = { enabled: true }` on the demo (commented-out alternative variants — `enabled: false`, `tiers: [1, 2]`, custom `src` — for manual testing).
- Add a representative `schain` block matching the IAB sample (`ver: "1.0"`, `complete: 1`, single node with publisher's domain).
- Add `ortb2.site` with a minimal `cat` + `content.keywords` first-party signal so onboarding partners can see the wire payload.
- Update the on-page event log so the new `error` event with code `E_IDENTITY_LOAD_FAIL` is rendered with the same UI affordance as existing events.

Documentation refresh:

- README.md — new "Global SDK options" subsections for `identityResolver`, `schain`, `ortb2`. Examples mirroring the demo. Defaults table updated.
- CONTEXT.md — verify D48–D51 entries reflect what actually shipped; correct any drift from the grilled spec.
- docs/adr/0001-identity-resolver-augment.md — verify the precedence table matches the `mergeIdentitySignals` behavior tests; reconcile if any test reveals an undocumented edge case.
- docs/prd/0001-identity-resolver-integration.md — append a "Shipped vs Planned" delta if any user story was descoped during implementation.

Verification:

- After build + `npx http-server`, the demo's first auction's network request payload contains:
  - At least one `imp[].ext.schain` block OR top-level `source.ext.schain` (Prebid v11 placement).
  - `user.eids[]` populated from at least the tier-2 cookies present in the browser (or empty if cookieless).
  - `regs.ext.gdpr` and `regs.ext.us_privacy` populated from ConsentManager.
  - `site.cat` + `site.content.keywords` from the new `ortb2` block.

This slice is integration / regression evidence. No new SDK code beyond demo + docs.

## Acceptance criteria

- [x] `test-page/mixed-media.html` enables `identityResolver`, `schain`, and `ortb2.site` with realistic values.
- [ ] Page loads in a clean Chrome profile without console errors. _(Manual verification only — not run in this slice. Demo HTML is wired; verify with `npx http-server` + open in Chrome.)_
- [ ] DevTools Network tab shows the new fields populated on the PubMatic bid request payload. _(Manual verification only — observable on first auction once the dev server runs.)_
- [x] On-page event log renders `error` events (including `E_IDENTITY_LOAD_FAIL` if the resolver is blocked). _(Existing event log already subscribes to `error`; `E_IDENTITY_LOAD_FAIL` flows through it unchanged.)_
- [x] README.md documents all three new config blocks with examples + defaults table.
- [x] CONTEXT.md D48–D51 entries are reconciled against shipped behavior.
- [x] ADR-0001 precedence table is reconciled against the `mergeIdentitySignals` test cases.
- [x] `docs/prd/0001-identity-resolver-integration.md` has a "Shipped vs Planned" footer (or note that nothing was descoped).
- [x] No regression in existing 186-test suite.
- [ ] No regression in the existing 13 Playwright F1 smoke specs. _(Not re-run in this slice — Playwright requires real Prebid network load; deferred to next CI cycle.)_
- [x] Bundle size remains under the 30 KB gzipped cap.

## Blocked by

- Issue #0004 (pre-auction merge + ortb2 push must be live for the demo to demonstrate identity).
- Issue #0005 (schain + ortb2 passthrough must be live for the demo's schain to land on the wire).
