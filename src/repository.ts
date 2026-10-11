import {
  draftFields,
  fingerprint,
  Item,
  ItemDraft,
  parseItem,
  safeFolder,
  safeTitle,
  Signal,
  text,
} from "./domain";

/** 把 Obsidian 文件操作隔离为可验证的存储边界 */
export interface VaultPort {
  /** 列出 Vault 中的 Markdown 路径 */
  paths(): string[];
  /** 从文件事实读取原始内容 */
  read(path: string): Promise<string>;
  /** 将 YAML 文本转换为属性记录 */
  parseYaml(source: string): Record<string, unknown>;
  /** 创建所需目录 */
  ensureFolder(path: string): Promise<void>;
  /** 创建 Markdown 文件，不覆盖同名文件 */
  create(path: string, content: string): Promise<void>;
  /** 在最新 frontmatter 上执行属性修改 */
  update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void>;
  /** 移到 Obsidian 配置的回收站 */
  trash(path: string): Promise<void>;
}
/** 从 Markdown 中抽取 YAML 与正文，避免等待元数据缓存 */
export function splitNote(
  content: string,
  parseYaml: VaultPort["parseYaml"],
): { fields: Record<string, unknown>; body: string } {
  // 仅识别文件开头的 frontmatter，不吞掉正文分隔线
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    content,
  );
  if (!match) return { fields: {}, body: content };
  return {
    fields: parseYaml(match[1]) ?? {},
    body: content.slice(match[0].length),
  };
}
/** 序列化新建笔记属性，字符串始终保留引号 */
export function noteContent(
  fields: Record<string, unknown>,
  body: string,
): string {
  return `---\n${Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n${body}`;
}
/** 根据属性补丁更新字段并删除明确置空的可选属性 */
export function assignFields(
  fields: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete fields[key];
    else fields[key] = value;
  }
}
/** 原始 Markdown 事实驱动的事项索引与写入服务 */
export class ItemRepository {
  /** 所有宿主共享的变化通知 */
  readonly changes = new Signal();
  /** 最新有效事项，按文件路径定位 */
  private entries = new Map<string, Item>();
  /** 标识每个文件最新一次异步读取 */
  private reads = new Map<string, symbol>();
  /** 可见读取、结构和重复 ID 错误 */
  readonly issues = new Map<string, string>();
  /** 配置目录 */
  private folder: string;
  /** 防止插件卸载后晚到的读取更新视图 */
  private stopped = false;
  /** 注入 Vault 边界并校验目录 */
  constructor(
    readonly port: VaultPort,
    folder: string,
  ) {
    this.folder = safeFolder(folder);
  }
  /** 获取当前目录下的有效事项快照 */
  items(): Item[] {
    return [...this.entries.values()].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }
  /** 检查文件属于指定事项范围 */
  contains(path: string): boolean {
    return path.startsWith(`${this.folder}/`) && path.endsWith(".md");
  }
  /** 切换目录重建索引，不移动用户文件 */
  async configure(folder: string): Promise<void> {
    this.folder = safeFolder(folder);
    this.entries.clear();
    this.reads.clear();
    this.issues.clear();
    await this.scan();
  }
  /** 首次与手动重扫不依赖 Obsidian 缓存完成时机 */
  async scan(): Promise<void> {
    // 删除已不在 Vault 的历史路径，保持失败文件的旧有效项
    const paths = this.port.paths().filter((path) => this.contains(path));
    // 记录已存在的文件或来源，避免覆盖和重复导入
    const existing = new Set(paths);
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const path of this.entries.keys())
      if (!existing.has(path)) this.entries.delete(path);
    await Promise.all(paths.map((path) => this.refresh(path)));
    this.changes.emit();
  }
  /** 只接纳仍然有效的最新异步读取结果 */
  async refresh(path: string): Promise<void> {
    if (!this.contains(path) || this.stopped) return;
    // 读取令牌只解决文件修改和删除已知竞态
    const token = Symbol(path);
    this.reads.set(path, token);
    try {
      // 即使 Metadata Cache 为空也读取真实 Markdown
      const content = await this.port.read(path);
      if (
        this.reads.get(path) !== token ||
        this.stopped ||
        !this.contains(path)
      )
        return;
      try {
        // 明确无效的文件不能继续作为可流转事项；仅读取失败保留旧项
        const fields = splitNote(content, this.port.parseYaml).fields;
        // 读取当前事项快照，核对操作对象与排期状态
        const item = parseItem(fields, path);
        if (item) this.entries.set(path, item);
        else this.entries.delete(path);
        this.issues.delete(path);
      } catch (error) {
        this.entries.delete(path);
        this.issues.set(
          path,
          error instanceof Error ? error.message : String(error),
        );
      }
    } catch (error) {
      if (this.reads.get(path) !== token || this.stopped) return;
      this.issues.set(
        path,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (this.reads.get(path) === token && !this.stopped) this.changes.emit();
    }
  }
  /** 文件或目录删除立即使待返回的读取失效 */
  remove(path: string): void {
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const candidate of new Set([
      ...this.entries.keys(),
      ...this.reads.keys(),
      ...this.issues.keys(),
    ])) {
      if (candidate === path || candidate.startsWith(`${path}/`)) {
        this.entries.delete(candidate);
        this.reads.delete(candidate);
        this.issues.delete(candidate);
      }
    }
    this.changes.emit();
  }
  /** 查询重复身份，不默默覆盖两份文件 */
  conflicts(): string[] {
    // 保留所有文件，按身份聚合报告冲突
    const counts = new Map<string, string[]>();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of this.items())
      counts.set(item.id, [...(counts.get(item.id) ?? []), item.path]);
    return [...counts.values()]
      .filter((paths) => paths.length > 1)
      .map((paths) => `重复事项 ID：${paths.join("、")}`);
  }
  /** 判断该项是否拥有唯一身份 */
  unique(item: Item): boolean {
    return this.items().filter((entry) => entry.id === item.id).length === 1;
  }
  /** 创建新事项并保留正文和额外迁移属性 */
  async create(
    draft: ItemDraft,
    body = "",
    extra: Record<string, unknown> = {},
  ): Promise<Item> {
    // 路径按创建年份归档，日期流转不搬动文件
    const id = globalThis.crypto.randomUUID();
    // 记录当前时间，用于真实截止时间和修改标记
    const now = new Date().toISOString();
    // 按创建年份归档，后续流转不移动事项文件
    const directory = `${this.folder}/${new Date().getFullYear()}`;
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = `${directory}/${safeTitle(draft.title)}-${id.slice(0, 8)}.md`;
    // 读取文件或配置属性，不把元数据缓存当作唯一事实
    const fields = {
      ...extra,
      ...draftFields(draft),
      "daylane-schema": 1,
      "daylane-id": id,
      "original-scheduled": draft.kind === "todo" ? draft.scheduled : undefined,
      "rollover-count": 0,
      created: now,
      updated: now,
    };
    await this.port.ensureFolder(directory);
    await this.port.create(
      path,
      noteContent(fields, body || `\n# ${draft.title.trim()}\n\n`),
    );
    await this.refresh(path);
    // 写入成功后仍要求完整业务模型，失败不返回虚假事项
    const item = this.entries.get(path);
    if (!item) throw new Error(`事项已写入但索引失败，请重扫：${path}`);
    return item;
  }
  /** 在最新属性上校验身份并修改，返回是否实际生效 */
  async mutate(
    item: Item,
    operation: (fields: Record<string, unknown>, current: Item) => boolean,
  ): Promise<boolean> {
    if (!this.unique(item))
      throw new Error("事项身份存在冲突，请先处理重复文件");
    // 校验发生在真实更新回调内，避免先读后写丢失最新完成状态
    let changed = false;
    await this.port.update(item.path, (fields) => {
      // 身份变化或不再属于事项时停止写入
      const current = parseItem(fields, item.path);
      if (!current || current.id !== item.id)
        throw new Error("事项已被替换，请重新打开");
      changed = operation(fields, current);
    });
    await this.refresh(item.path);
    return changed;
  }
  /** 保存编辑草稿，旧表单不能覆盖外部更新 */
  async edit(item: Item, draft: ItemDraft): Promise<void> {
    // 先校验草稿，防止更新后才发现无效内容
    const patch = draftFields(draft);
    await this.mutate(item, (fields, current) => {
      if (JSON.stringify(current) !== JSON.stringify(item))
        throw new Error("事项已修改，请关闭并重新打开编辑框");
      assignFields(fields, patch);
      if (draft.kind === "todo" && !fields["original-scheduled"])
        fields["original-scheduled"] = draft.scheduled;
      fields.updated = new Date().toISOString();
      if (draft.status === "completed")
        fields["completed-at"] ??= fields.updated;
      else delete fields["completed-at"];
      return true;
    });
  }
  /** 快捷切换状态不覆盖计划日期和正文 */
  async status(item: Item, status: Item["status"]): Promise<void> {
    await this.mutate(item, (fields) => {
      fields.status = status;
      fields.updated = new Date().toISOString();
      if (status === "completed") fields["completed-at"] = fields.updated;
      else delete fields["completed-at"];
      return true;
    });
  }
  /** 删除前不清理索引，回收站操作成功后再移除 */
  async trash(item: Item): Promise<void> {
    await this.port.trash(item.path);
    this.remove(item.path);
  }
  /** 返回文件事实的完整摘要用于流转恢复 */
  async digest(path: string): Promise<string> {
    return fingerprint(await this.port.read(path));
  }
  /** 释放已知读取和变化订阅 */
  dispose(): void {
    this.stopped = true;
    this.reads.clear();
    this.changes.clear();
  }
}
