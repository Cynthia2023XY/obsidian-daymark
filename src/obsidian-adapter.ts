import { App, normalizePath, parseYaml, TFile } from "obsidian";
import { VaultPort } from "./repository";

/** 用公开 Obsidian API 实现文件事实读写边界 */
export class ObsidianVault implements VaultPort {
  /** 注入当前插件所处 Vault */
  constructor(private app: App) {}
  /** 枚举 Markdown 文件，不访问 Vault 外的路径 */
  paths(): string[] {
    return this.app.vault.getMarkdownFiles().map((file) => file.path);
  }
  /** 把路径解析为仍然存在的 Markdown 文件 */
  private file(path: string): TFile {
    // 删除或同步替换后明确失败，避免写入错误对象
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`文件不存在：${path}`);
    return file;
  }
  /** 直接读取 Markdown 而非使用元数据缓存 */
  read(path: string): Promise<string> {
    return this.app.vault.read(this.file(path));
  }
  /** 限制 frontmatter 为映射对象 */
  parseYaml(source: string): Record<string, unknown> {
    // 库提供 YAML 解析，插件仅允许属性映射
    const value: unknown = parseYaml(source);
    if (value === null || value === undefined) return {};
    if (typeof value !== "object" || Array.isArray(value))
      throw new Error("YAML 配置应为属性映射");
    return value as Record<string, unknown>;
  }
  /** 顺序创建缺失的各级目录 */
  async ensureFolder(path: string): Promise<void> {
    // 不用文件系统原生路径，始终走 Vault API
    let current = "";
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const segment of path.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current))
        await this.app.vault.createFolder(current);
    }
  }
  /** 同名文件冲突交给 Vault API 明确返回 */
  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }
  /** 只修改 frontmatter，让正文留在原文件 */
  async update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file(path), operation);
  }
  /** 按用户设置回收，不直接永久删除 */
  async trash(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.file(path));
  }
}
