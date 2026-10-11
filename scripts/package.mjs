import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** 打包脚本所属独立仓库根目录 */
const root = fileURLToPath(new URL("../", import.meta.url));
/** 与 Obsidian manifest 一致的发行版本 */
const manifest = JSON.parse(
  await readFile(path.join(root, "manifest.json"), "utf8"),
);
/** 与 npm 元信息比较，避免错发版本 */
const metadata = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
if (manifest.version !== metadata.version)
  throw new Error("manifest 与 package.json 版本不同");
/** 可直接复制安装的发行目录 */
const target = path.join(root, "dist", "daylane");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
/** 逐项处理当前业务集合，保留每项自己的状态与结果 */
for (const file of ["main.js", "manifest.json", "styles.css", "LICENSE"]) {
  if (!(await stat(path.join(root, file))).size)
    throw new Error(`发行文件为空：${file}`);
  await cp(path.join(root, file), path.join(target, file));
}
/** 打包归档只覆盖本脚本生成的发行文件 */
const archive = path.join(root, "dist", `daylane-${manifest.version}.zip`);
await rm(archive, { force: true });
execFileSync("zip", ["-rq", archive, "daylane"], {
  cwd: path.join(root, "dist"),
});
process.stdout.write(`已生成 ${archive}\n`);
