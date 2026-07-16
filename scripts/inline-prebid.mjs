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

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const buildTime = new Date().toISOString();
const commitSha = (process.env.GITHUB_SHA || process.env.GIT_COMMIT || "").slice(0, 7) || "local";
// Own live-build banner, hoisted ahead of the vendored Prebid artifact's frozen
// "Updated: <vendor date>" header (which stays put — it documents when Prebid
// itself was pinned/vendored, per D62/ADR-0005, not when this bundle shipped).
const BUILD_BANNER = `/*! ${pkg.name} v${pkg.version} | Updated: ${buildTime} | commit ${commitSha} | (c) ${new Date().getFullYear()} ${pkg.license || ""} */\n`;

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
let prebid = readFileSync(prebidPath, "utf8");
console.log(`inlining ${prebidPath} (${(prebid.length / 1024).toFixed(1)} KB)`);

// Relabel the vendor header's "Updated:" (Prebid's own gulp-stamped build date,
// frozen at vendor time) to "Built:" so it can't be mistaken for this bundle's
// live "Updated:" banner above it. Header-only: rewrite within the leading
// comment block, never the code body. Same char count not required — the label
// sits on its own line, so line offsets (sourcemap math) are unchanged.
const headerEnd = prebid.indexOf("*/");
if (headerEnd !== -1) {
  const header = prebid.slice(0, headerEnd).replace(/^Updated:/m, "Built:");
  prebid = header + prebid.slice(headerEnd);
}

// Lines the build banner + Prebid prefix + separator add before the SDK core's first char.
const prefixLines =
  (BUILD_BANNER.match(/\n/g)?.length ?? 0) +
  (prebid.match(/\n/g)?.length ?? 0) +
  (SEP.match(/\n/g)?.length ?? 0);

for (const { core, coreMapName, out, outMapName } of PAIRS) {
  let sdk = readFileSync(core, "utf8");
  // Repoint the trailing //# sourceMappingURL comment to the final map.
  sdk = sdk.replace(`sourceMappingURL=${coreMapName}`, `sourceMappingURL=${outMapName}`);
  writeFileSync(out, BUILD_BANNER + prebid + SEP + sdk);
  console.log(`wrote ${out} (${(readFileSync(out).length / 1024).toFixed(1)} KB)`);

  // Shift the core sourcemap down by prefixLines so SDK frames resolve.
  const map = JSON.parse(readFileSync(join("dist", coreMapName), "utf8"));
  map.file = out.replace(/^dist\//, "");
  map.mappings = ";".repeat(prefixLines) + map.mappings;
  writeFileSync(out + ".map", JSON.stringify(map));
  console.log(`wrote ${out}.map (offset ${prefixLines} lines)`);
}
