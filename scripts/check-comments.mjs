import ts from "typescript";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** 枚举独立仓库源码与测试，不扫描构建产物和依赖 */
async function sources(directory) {
  // 只检查团队可维护的源码文件
  const entries = await readdir(directory, { withFileTypes: true });
  // 逐目录收集待校验文件
  const result = [];
  // 每个子目录仅遍历一次，不进入 node_modules
  for (const entry of entries) {
    // 保留相对仓库路径，错误提示可直接定位
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await sources(filename)));
    else if (/\.(ts|mjs)$/.test(entry.name)) result.push(filename);
  }
  return result;
}

/** 校验声明前有中文用途注释，函数内部允许行注释 */
function check(filename, content) {
  // 使用 TypeScript AST 避免把字符串中的代码当成声明
  const tree = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  // 汇总各声明位置，不因首个错误停止检查
  const problems = [];
  // 遍历声明节点并检查其前置说明
  function visit(node) {
    // 类型属性只检查正式 interface，内联返回类型由函数说明涵盖
    const declaration =
      ts.isVariableStatement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      (ts.isPropertySignature(node) && ts.isInterfaceDeclaration(node.parent));
    // 循环变量的中文说明放在循环语句之前
    const loop =
      (ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForStatement(node)) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.initializer);
    if (declaration || loop) {
      // 只认可紧邻声明的实际注释，不把上一个节点的说明算入
      const comments = ts.getLeadingCommentRanges(content, node.pos) ?? [];
      if (
        !comments.some((comment) =>
          /[\u4e00-\u9fff]/.test(content.slice(comment.pos, comment.end)),
        )
      ) {
        // 一基行号便于编辑器直接定位
        const location = tree.getLineAndCharacterOfPosition(
          node.getStart(tree),
        );
        problems.push(
          `${filename}:${location.line + 1} 声明前缺少中文用途注释`,
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return problems;
}

/** 按工作区约定检查运行代码、测试与构建脚本 */
const files = [
  ...(await sources("src")),
  ...(await sources("tests")),
  ...(await sources("preview")),
  ...(await sources("scripts")),
  "esbuild.config.mjs",
  "vitest.config.ts",
];
/** 完整错误列表，构建失败时保留所有定位信息 */
const errors = [];
/** 文件之间独立检查，确保新增模块也覆盖 */
for (const filename of files)
  errors.push(...check(filename, await readFile(filename, "utf8")));
if (errors.length) {
  process.stderr.write(errors.join("\n") + "\n");
  process.exitCode = 1;
} else process.stdout.write(`中文声明注释检查通过：${files.length} 个文件\n`);
