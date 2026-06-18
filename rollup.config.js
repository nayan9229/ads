import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const buildTime = new Date().toISOString();
const commitSha = (process.env.GITHUB_SHA || process.env.GIT_COMMIT || "").slice(0, 7) || "local";

const banner = `/*! ${pkg.name} v${pkg.version} | build ${buildTime} | commit ${commitSha} | (c) ${new Date().getFullYear()} ${pkg.license || ""} */`;

const plugins = [
  nodeResolve({ browser: true }),
  commonjs(),
  typescript({
    tsconfig: "./tsconfig.build.json",
    sourceMap: true,
    inlineSources: false,
  }),
  terser({
    ecma: 2017,
    compress: { passes: 2 },
    format: {
      // Strip every comment EXCEPT the leading legal banner (/*! ... */).
      comments: (_node, comment) => comment.type === "comment2" && /^\s*!/.test(comment.value),
    },
  }),
];

export default [
  // SDK core only. The vendored renamed-global Prebid build (D62/ADR-0005) is
  // concatenated ahead of these by scripts/inline-prebid.mjs to produce the
  // final shipped dist/pubads.mini.* files. Core is size-gated at 30 KB gz.
  {
    input: "src/index.ts",
    output: {
      file: "dist/pubads.core.js",
      format: "iife",
      name: "AdWrapperBundle",
      sourcemap: true,
      banner,
    },
    plugins,
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/pubads.core.esm.js",
      format: "esm",
      sourcemap: true,
      banner,
    },
    plugins,
  },
];
