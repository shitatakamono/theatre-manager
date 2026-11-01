import { build } from "esbuild";
import { resolve } from "node:path";

await build({
  entryPoints: [resolve("src/index.ts")],
  outfile: resolve("lib/index.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  alias: {
    "server-only": resolve("src/server-only.ts"),
  },
  external: [
    "firebase-admin",
    "firebase-admin/*",
    "firebase-functions",
    "firebase-functions/*",
  ],
});
