#!/usr/bin/env node
// Concatenate the vendored, renamed-global Prebid build ahead of the rollup SDK
// core output, producing the final shipped bundles (CONTEXT D62, ADR-0005).
// Prebid IIFE runs first → window._adwPbjs is ready before the SDK's init().
// The Prebid artifact is already minified by its own gulp build — we concat raw
// (no re-minify) to avoid mangling its IIFE.
//
// Sourcemaps: the SDK core's map is shifted down by the number of lines the
// Prebid prefix adds (prepend one `;` per leading line to `mappings`) and the
// trailing sourceMappingURL comment is repointed to the final file.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VENDOR_DIR = "vendor";
const SEP = "\n;\n";
const PAIRS = [
  {
    core: "dist/pubads.core.js",
    coreMapName: "pubads.core.js.map",
    out: "dist/pubads.mini.js",
    outMapName: "pubads.mini.js.map",
  },
  {
    core: "dist/pubads.core.esm.js",
    coreMapName: "pubads.core.esm.js.map",
    out: "dist/pubads.mini.esm.js",
    outMapName: "pubads.mini.esm.js.map",
  },
];

const artifacts = readdirSync(VENDOR_DIR).filter((f) => /^prebid-adw-.*\.js$/.test(f));
if (artifacts.length !== 1) {
  console.error(
    `FAIL: expected exactly one vendor/prebid-adw-*.js, found ${artifacts.length}: ${artifacts.join(", ")}`,
  );
  process.exit(1);
}
const prebidPath = join(VENDOR_DIR, artifacts[0]);
const prebid = readFileSync(prebidPath, "utf8");
console.log(`inlining ${prebidPath} (${(prebid.length / 1024).toFixed(1)} KB)`);

// Lines the Prebid prefix + separator add before the SDK core's first char.
const prefixLines = (prebid.match(/\n/g)?.length ?? 0) + (SEP.match(/\n/g)?.length ?? 0);

for (const { core, coreMapName, out, outMapName } of PAIRS) {
  let sdk = readFileSync(core, "utf8");
  // Repoint the trailing //# sourceMappingURL comment to the final map.
  sdk = sdk.replace(`sourceMappingURL=${coreMapName}`, `sourceMappingURL=${outMapName}`);
  writeFileSync(out, prebid + SEP + sdk);
  console.log(`wrote ${out} (${(readFileSync(out).length / 1024).toFixed(1)} KB)`);

  // Shift the core sourcemap down by prefixLines so SDK frames resolve.
  const map = JSON.parse(readFileSync(join("dist", coreMapName), "utf8"));
  map.file = out.replace(/^dist\//, "");
  map.mappings = ";".repeat(prefixLines) + map.mappings;
  writeFileSync(out + ".map", JSON.stringify(map));
  console.log(`wrote ${out}.map (offset ${prefixLines} lines)`);
}
