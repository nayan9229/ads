# Vendor a lean, renamed-global Prebid build and inline it into the shipped bundle

> Supersedes the _delivery_ half of [ADR-0004](0004-isolated-renamed-prebid-instance.md). The isolation rationale there (own `_adwPbjs` instance, never reuse host `window.pbjs`, sync-suppression) is unchanged; this ADR replaces "separate external pinned + SRI script" with "vendored + inlined into the bundle."

## Context

ADR-0004 settled that the SDK runs its **own** Prebid instance under a renamed global (`_adwPbjs`) so it never collides with a host page's `window.pbjs` and always has the required adapters (PubMatic, Magnite/`rubicon`). It proposed shipping that build as a _separate external script_, pinned and SRI-hashed, fetched at runtime by `DependencyLoader.loadPrebid`.

The follow-up requirement changed delivery: the customized Prebid must be **bundled directly into the SDK's main JavaScript output** — one artifact, no second network request, no externally-hosted Prebid — and the build should include only the modules/bidders we actually use.

Two hard constraints shaped this:

1. **Rollup cannot produce or tree-shake Prebid.** Prebid is its own gulp/webpack build; module selection happens at `gulp build --modules=…`, not in our rollup graph. So "only required modules" is a Prebid-build decision, and merging into our output is concatenation, not bundling.
2. **It breaks the single 30 KB gz cap (D19).** A 6-bidder lean Prebid is ~40–60 KB gz on its own — larger than the entire current SDK and ~2× the cap. Inlining forces the size budget to be redefined.

## Decision

**Vendor a lean, renamed-global Prebid build and concatenate it into both shipped bundles.**

- **Source + pin.** Official Prebid.js repo, latest stable tag (pinned **9.53.5**). The global rename is **not** a CLI flag — Prebid 9 has no `--prebidGlobalVarName`; the gulpfile reads `globalVarName` from `package.json` (`var prebid = require('./package.json')`). Module names were verified against the tag's `modules/` dir (names shifted across Prebid 8/9 — see `tcfControl` below). Built once with:
  ```
  # in Prebid.js checkout:
  node -e "p=require('./package.json');p.globalVarName='_adwPbjs';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
  npm ci && npx gulp build --modules=<lean-correct set>
  ```
- **Lean-correct module set.** Six v1 bidders (D8: `appnexusBidAdapter`, `rubiconBidAdapter`, `ixBidAdapter`, `openxBidAdapter`, `pubmaticBidAdapter`, `tripleliftBidAdapter`) + `userId{sharedIdSystem,id5IdSystem,uid2IdSystem}` + `consentManagementTcf` + `consentManagementUsp` + `tcfControl` (the Prebid-9 rename of `gdprEnforcement` — it does not exist under the old name) + `currency`. **Dropped:** `dfpAdServerVideo` (no GAM — D9; `VideoRenderer` feeds `vastUrl`/`vastXml` straight to IMA, never `buildVideoUrl`) and `priceFloors` (static config floors only — D10; dynamic floors v2-deferred). **`priceFloors` re-added by [ADR-0006](0006-add-pricefloors-module.md)/D63** — its exclusion silently no-op'd the `prebidConfig.floors` config (no `imp.bidfloor` emitted).
- **Vendored, not built-in-CI.** The minified artifact is committed (e.g. `vendor/prebid-adw-<ver>.js`) with provenance in `vendor/PREBID-BUILD.md` (tag, exact command, module list, date, sha384). The normal release does not run Prebid's toolchain; it only concatenates.
- **Merge = post-rollup raw concat.** Rollup emits the SDK core to an intermediate name (`dist/pubads.core.js` / `.esm.js`); a concat step writes `[Prebid IIFE] + [SDK]` → `dist/pubads.mini.js` / `.esm.js`. Prebid runs first, so `window._adwPbjs` exists before `init()`. No re-minification of the already-minified Prebid.
- **Split size budget (amends D19).** SDK core gated ≤ 30 KB gz on the pre-concat `pubads.core.js`; the vendored Prebid artifact gated by its own budget (set empirically after first build). SRI (`compute-sri.mjs`) computed on the final concatenated files.
- **Loader (amends D44).** `loadPrebid` short-circuits when `window._adwPbjs` is already present (the inlined case) → resolves synchronously, no injection. `prebidSrc` becomes optional/override-only; the inject/onload/timeout path survives solely as an escape hatch for a publisher pointing at their own renamed build.
- **Inlined into both IIFE and ESM** builds for full self-containment.
- **Maintenance.** Pinned/vendored Prebid receives no automatic updates. Rebuild + re-vendor + recompute SRI + bump on any Prebid security advisory touching our modules/bidders, plus a quarterly review of new stable releases.

## Considered alternatives

- **Keep external pinned + SRI script (ADR-0004 as-is)** — rejected by the new single-artifact requirement; loses nothing technically but doesn't meet "no externally-hosted Prebid, one file."
- **Feed Prebid into rollup as `intro`/`banner`** — rejected: rollup/terser would reprocess an already-minified webpack IIFE (slow, mangling risk) and the two size budgets can't be gated separately.
- **Build Prebid from source in CI each release** — rejected: adds Prebid's full webpack/babel toolchain (minutes + fragility) to every release; vendoring a pinned artifact is reproducible via the recorded command and keeps releases light.
- **Minimal module set (drop consent + currency too)** — rejected: risks bidders firing without consent strings / wrong storage gating, and mixed-currency mis-ranking (the SDK's own converter runs _after_ `getHighestCpmBids`, so it can't fix ranking).
- **IIFE-only inline** — considered; chose to inline into ESM too for consistency, accepting that ESM consumers already shipping Prebid get a duplicate.

## Consequences

- The shipped bundle is now ~10× the SDK core (Prebid-sized). The "30 KB" identity of the SDK survives only as the _core_ budget; publishers must expect a large combined download.
- **Init is no longer parallel for Prebid (amends D29):** Prebid parses synchronously up front. IMA + identity-resolver stay external + parallel.
- One whole-bundle SRI; no second network fetch; no jsDelivr/Prebid-CDN availability risk (addresses the D22 caveat for Prebid specifically).
- **Manual staleness risk:** a pinned vendored Prebid drifts from upstream security/adapter fixes until someone rebuilds — mitigated by the advisory + quarterly policy, not eliminated.
- **ESM duplicate-Prebid risk:** npm consumers that already bundle Prebid will ship two copies (different globals, so no runtime collision, but wasted bytes).
- Apache-2.0 (Prebid) is compatible with the SDK's Apache-2.0 (D31); the vendored artifact must preserve Prebid's license/attribution.
- `prebidSrc` / the loader's inject path is retained but demoted to an override; `pbjs.installedModules` is unneeded (we control the module set).
