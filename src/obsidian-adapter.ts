import { App, normalizePath, parseYaml, TFile } from "obsidian";
import { VaultPort } from "./repository";
/** 只通过宿主公开 API 操作当前 Vault */
export class ObsidianVault implements VaultPort {
  /** 迁移备份存储目录，不进入 Markdown 索引 */
  private backupFolder: string;
  /** 当前插件位置用于保留升级前原文 */
  constructor(
    private app: App,
    pluginDirectory?: string,
  ) {
    this.backupFolder =
      (pluginDirectory || app.vault.configDir + "/plugins/daylane") +
      "/backups";
  }
  /** 枚举 Markdown */
  paths(): string[] {
    return this.app.vault.getMarkdownFiles().map((file) => file.path);
  }
  /** 文件夹和普通文档都属于名称占用 */
  exists(path: string): boolean {
    return Boolean(this.app.vault.getAbstractFileByPath(normalizePath(path)));
  }
  /** 删除或替换路径后明确失败 */
  private file(path: string): TFile {
    // 确认文件仍存在，避免向已删除或替换的路径写入
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error("文件不存在：" + path);
    return file;
  }
  /** 读取事实而非等待元数据缓存 */
  read(path: string): Promise<string> {
    return this.app.vault.read(this.file(path));
  }
  /** YAML 限定属性映射，防止配置数组误用 */
  parseYaml(source: string): Record<string, unknown> {
    // 读取并校验用户输入，拒绝无效配置或日期
    const value: unknown = parseYaml(source);
    if (value === null || value === undefined) return {};
    if (typeof value !== "object" || Array.isArray(value))
      throw new Error("YAML 应为属性映射");
    return value as Record<string, unknown>;
  }
  /** 仅创建缺失目录，保留既有内容 */
  async ensureFolder(path: string): Promise<void> {
    // 保留最新事实状态，避免旧操作覆盖后续修改
    let current = "";
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const segment of path.split("/")) {
      current = current ? current + "/" + segment : segment;
      if (!this.exists(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch (error) {
          if (!this.exists(current)) throw error;
        }
      }
    }
  }
  /** 宿主创建 API 禁止覆盖 */
  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }
  /** 正文保持原样，仅修改最新 frontmatter */
  async update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void> {
    await this.app.fileManager.processFrontMatter(this.file(path), operation);
  }
  /** 原子原文修改用于明确确认的迁移 */
  async process(
    path: string,
    operation: (content: string) => string,
  ): Promise<void> {
    await this.app.vault.process(this.file(path), operation);
  }
  /** 使用用户回收站配置 */
  async trash(path: string): Promise<void> {
    await this.app.fileManager.trashFile(this.file(path));
  }
  /** 重命名由宿主维护笔记链接 */
  async rename(path: string, target: string): Promise<void> {
    await this.app.fileManager.renameFile(this.file(path), target);
  }
  /** 原文 JSON 备份不带事项标记文件扩展名 */
  async backup(path: string, content: string): Promise<string> {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const adapter = this.app.vault.adapter;
    // 按创建年份归档，后续流转不移动事项文件
    let directory = "";
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const part of this.backupFolder.split("/")) {
      directory = directory ? directory + "/" + part : part;
      if (!(await adapter.exists(directory))) await adapter.mkdir(directory);
    }
    // 确定本次操作目标，避免写入未知日期或错误路径
    const target =
      this.backupFolder + "/" + globalThis.crypto.randomUUID() + ".json";
    await adapter.write(
      target,
      JSON.stringify(
        { path, content, savedAt: new Date().toISOString() },
        null,
        2,
      ),
    );
    return target;
  }
}
