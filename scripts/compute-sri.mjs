#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BUNDLES = ["dist/pubads.mini.js", "dist/pubads.mini.esm.js"];
const ALGO = "sha384";

const lines = ["# Subresource Integrity hashes", ""];

for (const file of BUNDLES) {
  const buf = readFileSync(file);
  const digest = createHash(ALGO).update(buf).digest("base64");
  const sri = `${ALGO}-${digest}`;
  console.log(file + "  " + sri);
  lines.push(`- \`${file}\` — \`${sri}\``);
}

lines.push("");
lines.push('Embed in `<script integrity="..." crossorigin="anonymous">` to pin against tampering.');
writeFileSync("dist/sri.txt", lines.join("\n") + "\n");
console.log("wrote dist/sri.txt");
