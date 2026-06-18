# Vendored Prebid.js build — provenance

This directory holds a **pre-built, renamed-global Prebid.js bundle** that is concatenated into the SDK's shipped output (CONTEXT **D62**, [ADR-0005](../docs/adr/0005-vendored-inlined-prebid-bundle.md)). It is committed (not built in CI) for reproducible, toolchain-free releases.

## Current artifact

| Field | Value |
|---|---|
| File | `prebid-adw-9.53.5.js` |
| Prebid version (pinned tag) | `9.53.5` |
| Global var name | `_adwPbjs` (not `pbjs`) |
| Built | 2026-06-18 |
| SRI | `sha384-Oho0X141JfTWRNqNZtfd2ybqTVHF3krkWNkHz+HtrCxNfzfmyB+/qC/CLSaQRwzJ` |
| Size | 315.8 KB raw / 108.5 KB gz |

### Modules baked in (lean-correct set, D62)

Bidders (D8): `appnexusBidAdapter`, `rubiconBidAdapter` (Magnite), `ixBidAdapter`, `openxBidAdapter`, `pubmaticBidAdapter`, `tripleliftBidAdapter`
Identity (D18): `userId` + `sharedIdSystem`, `id5IdSystem`, `uid2IdSystem`
Consent: `consentManagementTcf`, `consentManagementUsp`, `tcfControl`
Currency: `currency`

**Deliberately excluded:** `dfpAdServerVideo` (no GAM — D9; `VideoRenderer` feeds `vastUrl`/`vastXml` straight to IMA) and `priceFloors` (static config floors only — D10).

## How to rebuild (on Prebid bump — advisory or quarterly, D62)

> NOTE: Prebid 9.x has **no `--prebidGlobalVarName` CLI flag**. The global name is read from `package.json`'s top-level `globalVarName` field (`gulpfile.js`: `var prebid = require('./package.json')`). Set it before building. Module names are version-specific — `gdprEnforcement` is `tcfControl` in Prebid 9.

```bash
git clone --depth 1 --branch <NEW_TAG> https://github.com/prebid/Prebid.js.git
cd Prebid.js
node -e "const fs=require('fs');const p=require('./package.json');p.globalVarName='_adwPbjs';fs.writeFileSync('./package.json',JSON.stringify(p,null,2)+'\n')"
npm ci --no-audit --no-fund
npx gulp build --modules=appnexusBidAdapter,rubiconBidAdapter,ixBidAdapter,openxBidAdapter,pubmaticBidAdapter,tripleliftBidAdapter,sharedIdSystem,id5IdSystem,uid2IdSystem,consentManagementTcf,consentManagementUsp,tcfControl,currency
# → build/dist/prebid.js
```

Then in this repo: copy to `vendor/prebid-adw-<NEW_TAG>.js`, update this file (tag, date, SRI, sizes), update `vendor/prebid-adw.js` symlink/reference if used by the concat step, bump the SDK version, re-run `npm run build:check`. Verify the new tag still exposes the listed module names and that the bundle writes `window._adwPbjs`.

## License

Prebid.js is Apache-2.0 (compatible with this SDK's Apache-2.0, D31). The artifact's leading banner preserves Prebid's version + module attribution; do not strip it.
