import { context } from "esbuild";

/** 是否持续监视源码并重新构建插件 */
const watching = process.argv.includes("--watch");
/** Obsidian 插件的浏览器兼容构建上下文 */
const builder = await context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  target: "es2022",
  platform: "browser",
  external: ["obsidian"],
  sourcemap: watching ? "inline" : false,
  minify: false,
  logLevel: "info",
  banner: {
    js: "/* Daymark - MIT License, Copyright (c) 2026 Cynthia Ding */",
  },
});
if (watching) await builder.watch();
else {
  await builder.rebuild();
  await builder.dispose();
}
