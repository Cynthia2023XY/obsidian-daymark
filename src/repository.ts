import {
  draftFields,
  Item,
  ItemDraft,
  ITEM_FIELDS,
  legacyItem,
  parseItem,
  safeFolder,
  safeTitle,
  Signal,
} from "./domain";

/** 文件边界隔离 Obsidian 缓存与事实读写 */
export interface VaultPort {
  /** 列出所有 Markdown */
  paths(): string[];
  /** 文件或目录是否占用路径 */
  exists(path: string): boolean;
  /** 读取原始文档 */
  read(path: string): Promise<string>;
  /** 解析属性 */
  parseYaml(source: string): Record<string, unknown>;
  /** 创建缺失目录 */
  ensureFolder(path: string): Promise<void>;
  /** 新建但不覆盖文件 */
  create(path: string, content: string): Promise<void>;
  /** 在最新属性上修改，保留正文 */
  update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void>;
  /** 原子转换最新原文，迁移时防止覆盖外部编辑 */
  process(path: string, operation: (content: string) => string): Promise<void>;
  /** 按宿主配置回收文档 */
  trash(path: string): Promise<void>;
  /** 宿主重命名并维护关联链接 */
  rename(path: string, target: string): Promise<void>;
  /** 原文保存到不会被事项扫描的 JSON 备份 */
  backup(path: string, content: string): Promise<string>;
}
/** 只解析开头 YAML，正文中的分隔线保持原样 */
export function splitNote(
  content: string,
  parseYaml: VaultPort["parseYaml"],
): { fields: Record<string, unknown>; body: string } {
  // 只识别文件开头的 YAML 区域，保留正文分隔线
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
    content,
  );
  return match
    ? {
        fields: parseYaml(match[1]) ?? {},
        body: content.slice(match[0].length),
      }
    : { fields: {}, body: content };
}
/** 新建属性的日期始终以字符串保存 */
export function noteContent(
  fields: Record<string, unknown>,
  body: string,
): string {
  return (
    "---\n" +
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => key + ": " + JSON.stringify(value))
      .join("\n") +
    "\n---\n" +
    body
  );
}
/** 明确置空时删除指定键，不触及未知属性 */
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
/** 路径和专属标记决定事项身份，日期缺失进入待办箱 */
export class ItemRepository {
  /** 宿主共用变化通知 */
  readonly changes = new Signal();
  /** 路径到有效事项的索引 */
  private entries = new Map<string, Item>();
  /** 最新读取标记，防止删除后被旧结果恢复 */
  private reads = new Map<string, symbol>();
  /** 原文读取与结构异常 */
  readonly issues = new Map<string, string>();
  /** 首次扫描进度 */
  progress = { active: false, completed: 0, total: 0 };
  /** 范围变化使旧扫描失效 */
  private generation = 0;
  /** 卸载后不接受任何回调 */
  private stopped = false;
  /** 新建文档目标目录 */
  private folder: string;
  /** 是否仅读取该目录 */
  private limited: boolean;
  /** 注入文件边界与范围 */
  constructor(
    readonly port: VaultPort,
    folder: string,
    limited = true,
  ) {
    this.folder = safeFolder(folder);
    this.limited = limited;
  }
  /** 有效事项快照 */
  items(): Item[] {
    return [...this.entries.values()];
  }
  /** 无日期的事项是待办箱 */
  inbox(): Item[] {
    return this.items().filter((item) => !item.date);
  }
  /** 目录仅控制读取范围，标记由解析器校验 */
  contains(path: string): boolean {
    return (
      path.endsWith(".md") &&
      !path.split("/").some((part) => part.startsWith(".")) &&
      (!this.limited || path.startsWith(this.folder + "/"))
    );
  }
  /** 只重建读取范围，不移动原文 */
  async configure(folder: string, limited = this.limited): Promise<void> {
    this.folder = safeFolder(folder);
    this.limited = limited;
    this.entries.clear();
    this.reads.clear();
    this.issues.clear();
    await this.scan();
  }
  /** 首次扫描分批读取，避免大 Vault 阻塞界面 */
  async scan(): Promise<void> {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const generation = ++this.generation;
    // 收集当前目录的文件路径，检查删除与迁移范围
    const paths = this.port.paths().filter((path) => this.contains(path));
    // 记录已存在的文件或来源，避免覆盖和重复导入
    const existing = new Set(paths);
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const path of new Set([...this.entries.keys(), ...this.issues.keys()]))
      if (!existing.has(path)) this.remove(path);
    this.progress = { active: true, completed: 0, total: paths.length };
    this.changes.emit();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (let index = 0; index < paths.length; index += 16) {
      if (this.stopped || generation !== this.generation) return;
      await Promise.all(
        paths.slice(index, index + 16).map((path) => this.refresh(path)),
      );
      if (generation !== this.generation) return;
      this.progress.completed = Math.min(index + 16, paths.length);
      if (index % 256 === 0 || this.progress.completed === paths.length)
        this.changes.emit();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (generation === this.generation) {
      this.progress.active = false;
      this.changes.emit();
    }
  }
  /** 原文而非缓存决定事实，旧格式确认前只读展示 */
  async refresh(path: string): Promise<void> {
    if (!this.contains(path) || this.stopped) {
      this.remove(path);
      return;
    }
    // 标识当前读取请求，使较早返回的结果失效
    const token = Symbol(path);
    this.reads.set(path, token);
    try {
      // 保留文件原文，用于解析、指纹校验与正文完整性检查
      const content = await this.port.read(path);
      if (
        this.reads.get(path) !== token ||
        this.stopped ||
        !this.contains(path)
      )
        return;
      try {
        // 读取文件或配置属性，不把元数据缓存当作唯一事实
        const fields = splitNote(content, this.port.parseYaml).fields;
        // 读取当前事项快照，核对操作对象与排期状态
        const item = parseItem(fields, path) ?? legacyItem(fields, path);
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
      if (this.reads.get(path) === token && !this.stopped)
        this.issues.set(
          path,
          error instanceof Error ? error.message : String(error),
        );
    } finally {
      if (
        this.reads.get(path) === token &&
        !this.stopped &&
        !this.progress.active
      )
        this.changes.emit();
    }
  }
  /** 删除后立即使相关后代读取失效 */
  remove(path: string): void {
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const candidate of new Set([
      ...this.entries.keys(),
      ...this.reads.keys(),
      ...this.issues.keys(),
    ]))
      if (candidate === path || candidate.startsWith(path + "/")) {
        this.entries.delete(candidate);
        this.reads.delete(candidate);
        this.issues.delete(candidate);
      }
    this.changes.emit();
  }
  /** 更名仅刷新影响范围，不能每次重扫整个库 */
  async renamed(path: string, oldPath: string): Promise<void> {
    this.remove(oldPath);
    if (path.endsWith(".md")) {
      await this.refresh(path);
      return;
    }
    await Promise.all(
      this.port
        .paths()
        .filter(
          (candidate) =>
            candidate.startsWith(path + "/") && this.contains(candidate),
        )
        .map((candidate) => this.refresh(candidate)),
    );
  }
  /** 标题加可读编号，不覆盖任意已有文件或目录 */
  availablePath(title: string, directory = this.folder): string {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const name = safeTitle(title);
    // 根目录文件也必须保持 Vault 相对路径
    const prefix = directory ? directory + "/" : "";
    // 保存当前处理阶段的事实结果，供后续校验与展示
    let suffix = 0;
    while (
      this.port.exists(prefix + name + (suffix ? " " + suffix : "") + ".md")
    )
      suffix++;
    return prefix + name + (suffix ? " " + suffix : "") + ".md";
  }
  /** 新建只写四项属性与二级正文标题 */
  async create(draft: ItemDraft): Promise<Item> {
    // 读取文件或配置属性，不把元数据缓存当作唯一事实
    const fields = draftFields(draft);
    await this.port.ensureFolder(this.folder);
    // 使用明确的 Vault 相对路径，定位本次读写对象
    let path = this.availablePath(draft.title);
    while (true) {
      try {
        await this.port.create(
          path,
          noteContent(fields, "\n## " + draft.title.trim() + "\n\n"),
        );
        break;
      } catch (error) {
        if (!this.port.exists(path)) throw error;
        path = this.availablePath(draft.title);
      }
    }
    await this.refresh(path);
    // 读取当前事项快照，核对操作对象与排期状态
    const item = this.entries.get(path);
    if (!item) throw new Error("文档已创建但索引失败：" + path);
    return item;
  }
  /** 在最新文件属性上重新校验，避免覆盖外部完成与改期 */
  async mutate(
    item: Item,
    operation: (fields: Record<string, unknown>, current: Item) => boolean,
  ): Promise<boolean> {
    if (item.legacy) throw new Error("旧事项请先在设置中预览迁移");
    if (!this.contains(item.path)) throw new Error("事项已移出当前扫描范围");
    // 标记最新校验后是否实际更新，区分成功与跳过
    let changed = false;
    await this.port.update(item.path, (fields) => {
      // 保留最新事实状态，避免旧操作覆盖后续修改
      const current = parseItem(fields, item.path);
      if (!current) throw new Error("此文档已不再是重要事项");
      changed = operation(fields, current);
    });
    await this.refresh(item.path);
    return changed;
  }
  /** 切换完成状态，不改累计记录 */
  async status(item: Item, status: Item["status"]): Promise<void> {
    await this.mutate(item, (fields) => {
      fields["daylane-status"] = status;
      return true;
    });
  }
  /** 手动改期和移入待办箱均不清零计数 */
  async schedule(item: Item, date?: string): Promise<void> {
    draftFields({ title: item.title, date });
    await this.mutate(item, (fields) => {
      assignFields(fields, { "daylane-date": date });
      return true;
    });
  }
  /** 删除模式明确区分回收文档与移除事项身份 */
  async removeItem(item: Item, preserve: boolean): Promise<void> {
    if (item.legacy)
      throw new Error("旧事项请先完成迁移，以明确需要移除的属性");
    if (preserve)
      await this.mutate(item, (fields) => {
        // 逐项处理当前业务集合，保留每项自己的状态与结果
        for (const key of ITEM_FIELDS) delete fields[key];
        return true;
      });
    else {
      await this.port.trash(item.path);
      this.remove(item.path);
    }
  }
  /** 停止后不接受过期扫描结果 */
  dispose(): void {
    this.stopped = true;
    this.generation++;
    this.reads.clear();
    this.changes.clear();
  }
}
