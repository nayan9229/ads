import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const MAX_GZ_BYTES = 30 * 1024;
const BUNDLE = "dist/sdk.js";

const raw = readFileSync(BUNDLE);
const gz = gzipSync(raw, { level: 9 });

const rawKb = (raw.length / 1024).toFixed(2);
const gzKb = (gz.length / 1024).toFixed(2);
const capKb = (MAX_GZ_BYTES / 1024).toFixed(2);

console.log(`bundle: ${BUNDLE}`);
console.log(`  raw:  ${raw.length} bytes (${rawKb} KB)`);
console.log(`  gzip: ${gz.length} bytes (${gzKb} KB)`);
console.log(`  cap:  ${MAX_GZ_BYTES} bytes (${capKb} KB)`);

if (gz.length > MAX_GZ_BYTES) {
  console.error(`FAIL: gzipped bundle ${gzKb} KB exceeds cap ${capKb} KB`);
  process.exit(1);
}
console.log(`OK: under cap (${((MAX_GZ_BYTES - gz.length) / 1024).toFixed(2)} KB headroom)`);
