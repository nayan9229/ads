import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import terser from "@rollup/plugin-terser";

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
    format: { comments: false },
  }),
];

export default [
  {
    input: "src/index.ts",
    output: {
      file: "dist/sdk.js",
      format: "iife",
      name: "AdWrapperBundle",
      sourcemap: true,
    },
    plugins,
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/sdk.esm.js",
      format: "esm",
      sourcemap: true,
    },
    plugins,
  },
];
