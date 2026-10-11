import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/preview", { recursive: true });
await build({
  entryPoints: ["preview/entry.ts"],
  bundle: true,
  outfile: "dist/preview/preview.js",
  format: "iife",
  target: "es2022",
  platform: "browser",
});
await cp("preview/index.html", "dist/preview/index.html");
await cp("styles.css", "dist/preview/styles.css");
process.stdout.write("预览已生成到 dist/preview，不属于插件发行产物。\n");
