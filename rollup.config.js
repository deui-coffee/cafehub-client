import dts from "rollup-plugin-dts";
import esbuild from "rollup-plugin-esbuild";

function bundle(config) {
  return {
    ...config,
    external: ["events"],
  };
}

export default [
  bundle({
    input: "src/index.ts",
    plugins: [esbuild()],
    output: [
      {
        file: `index.mjs`,
        format: "es",
      },
    ],
  }),
  bundle({
    input: "src/index.ts",
    plugins: [dts()],
    output: [
      {
        file: `index.d.ts`,
        format: "es",
      },
    ],
  }),
  bundle({
    input: "src/types.ts",
    plugins: [esbuild()],
    output: [
      {
        file: `types.mjs`,
        format: "es",
      },
    ],
  }),
  bundle({
    input: "src/types.ts",
    plugins: [dts()],
    output: [
      {
        file: `types.d.ts`,
        format: "es",
      },
    ],
  }),
];
