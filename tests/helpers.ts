import { parse, stringify } from "yaml";
import { ItemDraft } from "../src/domain";
import {
  ItemRepository,
  noteContent,
  splitNote,
  VaultPort,
} from "../src/repository";

/** 在测试中模拟 Vault 文件事实，业务代码不增加测试分支 */
export class MemoryVault implements VaultPort {
  /** 当前存在的 Markdown 原文 */
  files = new Map<string, string>();
  /** 写入调用次数，用于验证同日重复检查 */
  updates = 0;
  /** 下次读取失败时模拟真实 I/O 异常 */
  failRead = false;
  /** 下次写入失败时保留文件原状 */
  failWrite = false;
  /** 在真实写入前注入外部编辑 */
  beforeUpdate?: (path: string) => void;
  /** 返回当前文件集合 */
  paths(): string[] {
    return [...this.files.keys()];
  }
  /** 读取失败不伪造空 frontmatter */
  async read(path: string): Promise<string> {
    if (this.failRead) throw new Error("读取失败");
    // 保留文件原文，用于解析、指纹校验与正文完整性检查
    const content = this.files.get(path);
    if (content === undefined) throw new Error("文件不存在");
    return content;
  }
  /** 使用标准 YAML 库模拟 Obsidian 的解析边界 */
  parseYaml(source: string): Record<string, unknown> {
    return parse(source) ?? {};
  }
  /** 内存存储不需要磁盘目录 */
  async ensureFolder(_path: string): Promise<void> {}
  /** 模拟同名文件不允许覆盖 */
  async create(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error("同名文件");
    this.files.set(path, content);
  }
  /** 在最新原文上修改属性并保留正文 */
  async update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void> {
    if (this.failWrite) throw new Error("写入失败");
    this.beforeUpdate?.(path);
    this.updates++;
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await this.read(path), this.parseYaml);
    operation(note.fields);
    this.files.set(path, `---\n${stringify(note.fields)}---\n${note.body}`);
  }
  /** 模拟回收站删除 */
  async trash(path: string): Promise<void> {
    if (this.failWrite) throw new Error("回收失败");
    this.files.delete(path);
  }
}
/** 构造待办业务草稿，不包含存储身份 */
export function todo(date = "2026-10-09"): ItemDraft {
  return {
    title: "整理接口文档",
    kind: "todo",
    status: "open",
    scheduled: date,
    deadline: "2026-10-10",
    project: "工作",
    color: "blue",
    rollover: "inherit",
  };
}
/** 为测试预置一条真实 Markdown 事项 */
export async function fixture(): Promise<{
  vault: MemoryVault;
  repository: ItemRepository;
}> {
  // 手动构造文件证明首次扫描直接读取原文，而非依赖 create 的内存写入
  const vault = new MemoryVault();
  vault.files.set(
    "Daylane/Items/2026/example.md",
    noteContent(
      {
        "daylane-schema": 1,
        "daylane-id": "fixture-id",
        "daylane-kind": "todo",
        title: "整理接口文档",
        status: "open",
        scheduled: "2026-10-09",
        "original-scheduled": "2026-10-09",
        deadline: "2026-10-10",
        rollover: "inherit",
        "rollover-count": 0,
        updated: "2026-10-09T00:00:00Z",
        project: "工作",
        color: "blue",
        custom: "保持原值",
      },
      "\n# 正文\n\n保留所有原始说明。\n",
    ),
  );
  // 提供 Markdown 事实仓库，验证索引与写入契约
  const repository = new ItemRepository(vault, "Daylane/Items");
  await repository.scan();
  return { vault, repository };
}
