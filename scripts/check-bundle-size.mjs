import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

// Split size budget (CONTEXT D62, amends D19): the SDK core and the vendored
// Prebid artifact are gated separately on the PRE-CONCAT inputs — once merged
// into dist/pubads.mini.js the two halves can't be measured apart.
const CORE = "dist/pubads.core.js";
const CORE_MAX_GZ = 30 * 1024;

const VENDOR_DIR = "vendor";
// Empirical ceiling for the lean-correct 6-bidder Prebid build (measured ~108.5
// KB gz at v9.53.5). Set with headroom; tighten/raise deliberately on rebuild.
const PREBID_MAX_GZ = 120 * 1024;

let failed = false;

function report(label, file, maxBytes) {
  const raw = readFileSync(file);
  const gz = gzipSync(raw, { level: 9 });
  const gzKb = (gz.length / 1024).toFixed(2);
  const capKb = (maxBytes / 1024).toFixed(2);
  console.log(`${label}: ${file}`);
  console.log(`  raw:  ${(raw.length / 1024).toFixed(2)} KB`);
  console.log(`  gzip: ${gzKb} KB  (cap ${capKb} KB)`);
  if (gz.length > maxBytes) {
    console.error(`  FAIL: ${gzKb} KB exceeds cap ${capKb} KB`);
    failed = true;
  } else {
    console.log(`  OK: ${((maxBytes - gz.length) / 1024).toFixed(2)} KB headroom`);
  }
}

report("SDK core", CORE, CORE_MAX_GZ);

const artifacts = readdirSync(VENDOR_DIR).filter((f) => /^prebid-adw-.*\.js$/.test(f));
if (artifacts.length !== 1) {
  console.error(`FAIL: expected exactly one vendor/prebid-adw-*.js, found ${artifacts.length}`);
  process.exit(1);
}
report("Prebid artifact", join(VENDOR_DIR, artifacts[0]), PREBID_MAX_GZ);

if (failed) process.exit(1);
console.log("OK: all budgets under cap");
