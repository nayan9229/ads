#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import vm from "node:vm";

// Guards the SDK core's parse time, NOT the final mini bundle (D62): the inlined
// Prebid artifact dominates mini.js (~87%) and changes only on a deliberate
// Prebid bump, so measuring it would both fail on every bump and mask
// regressions in our own code. Prebid's payload is bounded by the size budget.
const BUNDLE = "dist/pubads.core.js";
const BASELINE = "scripts/parse-bench-baseline.json";
const ITERATIONS = 50;
const REGRESSION_THRESHOLD = 1.15; // +15% fails
const UPDATE_BASELINE = process.env.UPDATE_BASELINE === "1";

const source = readFileSync(BUNDLE, "utf8");
const samples = [];

// Warmup
for (let i = 0; i < 5; i++) new vm.Script(source, { filename: BUNDLE });

for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  // Parse-only measurement: compile the script without executing it.
  // Mirrors V8 parse cost ≈ what the browser pays before first execution.
  new vm.Script(source, { filename: BUNDLE });
  samples.push(performance.now() - t0);
}

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)];
const p95 = samples[Math.floor(samples.length * 0.95)];
const mean = samples.reduce((s, v) => s + v, 0) / samples.length;

const stats = {
  bundle: BUNDLE,
  bytes: Buffer.byteLength(source, "utf8"),
  iterations: ITERATIONS,
  median_ms: +median.toFixed(3),
  mean_ms: +mean.toFixed(3),
  p95_ms: +p95.toFixed(3),
};

console.log("parse-bench:");
console.log("  bytes:    " + stats.bytes);
console.log("  median:   " + stats.median_ms + " ms");
console.log("  mean:     " + stats.mean_ms + " ms");
console.log("  p95:      " + stats.p95_ms + " ms");

if (UPDATE_BASELINE || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify(stats, null, 2) + "\n");
  console.log("  baseline: WROTE " + BASELINE);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const ratio = stats.median_ms / baseline.median_ms;
const delta_pct = ((ratio - 1) * 100).toFixed(2);

console.log("  baseline median: " + baseline.median_ms + " ms");
console.log("  delta:    " + (delta_pct >= 0 ? "+" : "") + delta_pct + "%");

// Noise floor: when either median is sub-millisecond, V8 jitter dominates the
// measurement (compile is too fast to be meaningful). Skip the ratio check in
// that regime and reseed the baseline opportunistically. Re-engages once the
// bundle is large enough that absolute parse time crosses 1 ms.
const NOISE_FLOOR_MS = 1.0;
if (baseline.median_ms < NOISE_FLOOR_MS || stats.median_ms < NOISE_FLOOR_MS) {
  console.log(
    "  noise-floor: skipping ratio check (median < " +
      NOISE_FLOOR_MS +
      " ms — V8 jitter dominates). Bundle must grow past this absolute threshold for parse-bench to be meaningful.",
  );
  writeFileSync(BASELINE, JSON.stringify(stats, null, 2) + "\n");
  console.log("  baseline: REFRESHED " + BASELINE);
  process.exit(0);
}

if (ratio > REGRESSION_THRESHOLD) {
  console.error(
    "FAIL: parse-time regressed " +
      delta_pct +
      "% (threshold +" +
      ((REGRESSION_THRESHOLD - 1) * 100).toFixed(0) +
      "%)",
  );
  process.exit(1);
}
console.log("OK: within threshold");
