# Rollback Runbook

How to roll back a bad `@nayan9229/ads` release.

## Principle

**Pinned URLs are immutable.** A published version on GitHub Packages and the corresponding `cdn.jsdelivr.net/npm/@nayan9229/ads@X.Y.Z/dist/sdk.js` URL must never serve different bytes than the original publish. Rollback works by redirecting the **floating** URL (`@1`, `@1.x`) to a known-good prior version, then deprecating the bad one.

---

## When to roll back

| Signal                                                                          | Severity | Action                                  |
| ------------------------------------------------------------------------------- | -------- | --------------------------------------- |
| `adRenderFail` rate >5% on production traffic for two consecutive 5-min windows | P0       | Immediate rollback                      |
| `E_PREBID_LOAD_FAIL` >1% above baseline                                         | P0       | Immediate rollback                      |
| Bundle size regression caught post-release                                      | P1       | Patch release within 24h, no rollback   |
| Reported visual / layout regression                                             | P2       | Triage; rollback only if scope is broad |

The SLO dashboards listed in `docs/slo.md` (issue #15) are the source of truth for these signals.

---

## Procedure

### 1. Identify last known-good version

```sh
gh release list --repo nayan9229/ads --limit 10
```

Pick the most recent tag whose post-deploy SLO window stayed green.

### 2. Deprecate the bad version on GitHub Packages

```sh
npm deprecate @nayan9229/ads@X.Y.Z \
  "Rolled back due to <issue summary>. Use @nayan9229/ads@A.B.C instead." \
  --registry=https://npm.pkg.github.com
```

This adds a `deprecated` field to the version's `package.json` on the registry. Consumers running `npm install @nayan9229/ads` will see a warning but the version remains resolvable (necessary — pinned URLs must keep working).

### 3. Re-publish the prior version as the new floating-tag head

```sh
git checkout vA.B.C
git tag -f v1
git push origin v1 --force-with-lease
```

Then trigger a workflow run to refresh `dist-tag: latest` on the registry:

```sh
npm dist-tag add @nayan9229/ads@A.B.C latest --registry=https://npm.pkg.github.com
```

### 4. Purge jsDelivr cache for the floating URL

```sh
curl -sf "https://purge.jsdelivr.net/npm/@nayan9229/ads@1/dist/sdk.js"
```

(`https://purge.jsdelivr.net/...` is the API form documented at https://www.jsdelivr.com/tools/purge.) Purge clears the floating-URL cache; pinned-version URLs are unaffected.

### 5. Verify

```sh
curl -sI "https://cdn.jsdelivr.net/npm/@nayan9229/ads@1/dist/sdk.js" | grep -i etag
```

ETag should match the rolled-back version's bundle hash. Cross-check with the SRI hash recorded in the release notes for `vA.B.C`.

### 6. Communicate

Open a GitHub Issue titled `Rollback: vX.Y.Z → vA.B.C` containing:

- Affected version range
- Trigger signal (with dashboard link)
- Deprecation message text
- New floating-tag head SHA + SRI hash
- Post-mortem owner

---

## What NOT to do

- **Do not** `npm unpublish`. GitHub Packages permits it for the first 72h but unpublishing breaks pinned-URL guarantees. Always deprecate.
- **Do not** edit a prior tag in-place. Tags are signed and immutable in CI.
- **Do not** rely on jsDelivr to pull the change without the explicit purge call — the floating-URL cache TTL can run hours.
- **Do not** delete the bad release on GitHub. The release notes (with SRI) are evidence for the rollback decision.

---

## Drills

Run a rollback drill **before** the first 1.0.0 release and **once per quarter** thereafter using the `rc` channel. Drill is successful if steps 1–5 complete in under 15 minutes.

---

## Related

- `docs/releases.md` — canary + RC soak process
- `CHANGELOG.md` — versioned change log
- Issue #14 — release pipeline (this runbook is an output of that issue)
