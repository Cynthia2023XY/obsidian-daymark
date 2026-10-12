import { parse, stringify } from "yaml";
import { ItemDraft } from "../src/domain";
import {
  ItemRepository,
  noteContent,
  splitNote,
  VaultPort,
} from "../src/repository";
/** 测试仅替换文件边界，业务层无测试属性 */
export class MemoryVault implements VaultPort {
  /** 文档原文 */
  files = new Map<string, string>();
  /** 非 Markdown 备份 */
  backups = new Map<string, string>();
  /** 文件夹占名 */
  folders = new Set<string>();
  /** 真实读取次数 */
  readCount = 0;
  /** 实际写入次数 */
  updates = 0;
  /** 模拟读取故障 */
  failRead = false;
  /** 模拟写入故障 */
  failWrite = false;
  /** 写入前外部修改 */
  beforeUpdate?: (path: string) => void;
  /** 同步进程创建重名的模拟 */
  beforeCreate?: (path: string) => void;
  /** 当前 Markdown 文件 */
  paths(): string[] {
    return [...this.files.keys()].filter((path) => path.endsWith(".md"));
  }
  /** 任意文件或目录都不能覆盖 */
  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }
  /** 读取失败不伪装成空文档 */
  async read(path: string): Promise<string> {
    this.readCount++;
    if (this.failRead) throw new Error("读取失败");
    // 保留文件原文，用于解析、指纹校验与正文完整性检查
    const content = this.files.get(path);
    if (content === undefined) throw new Error("文件不存在");
    return content;
  }
  /** YAML 边界使用同等语义解析器 */
  parseYaml(source: string): Record<string, unknown> {
    return parse(source) ?? {};
  }
  /** 目录不纳入 Markdown 索引 */
  async ensureFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
  /** 占名冲突抛错，I/O 失败不能被当成占名 */
  async create(path: string, content: string): Promise<void> {
    this.beforeCreate?.(path);
    if (this.failWrite) throw new Error("写入失败");
    if (this.exists(path)) throw new Error("路径存在");
    this.files.set(path, content);
  }
  /** 在最新原文上修改属性 */
  async update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void> {
    if (this.failWrite) throw new Error("写入失败");
    this.beforeUpdate?.(path);
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await this.read(path), this.parseYaml);
    operation(note.fields);
    // 计算后续日期或新路径，不沿用已失效的状态
    const next = "---\n" + stringify(note.fields) + "---\n" + note.body;
    if (next !== this.files.get(path)) this.updates++;
    this.files.set(path, next);
  }
  /** 最新文本转换模拟宿主原子处理 */
  async process(
    path: string,
    operation: (content: string) => string,
  ): Promise<void> {
    if (this.failWrite) throw new Error("写入失败");
    this.beforeUpdate?.(path);
    this.files.set(path, operation(await this.read(path)));
    this.updates++;
  }
  /** 回收失败保留文件 */
  async trash(path: string): Promise<void> {
    if (this.failWrite) throw new Error("回收失败");
    this.files.delete(path);
  }
  /** 更名不能覆盖 */
  async rename(path: string, target: string): Promise<void> {
    if (this.exists(target)) throw new Error("重名");
    this.files.set(target, await this.read(path));
    this.files.delete(path);
  }
  /** 保存原文，便于证明迁移前备份 */
  async backup(path: string, content: string): Promise<string> {
    // 确定本次操作目标，避免写入未知日期或错误路径
    const target = "backups/" + this.backups.size + ".json";
    this.backups.set(target, JSON.stringify({ path, content }));
    return target;
  }
}
/** 单日创建不需要配置额外排期属性 */
export function todo(date = "2026-10-09"): ItemDraft {
  return { title: "整理接口文档", date };
}
/** 已有原文首扫不依赖仓库创建时的内存缓存 */
export async function fixture(
  limited = true,
): Promise<{ vault: MemoryVault; repository: ItemRepository }> {
  // 模拟公开文件边界，业务实现无需加入测试分支
  const vault = new MemoryVault();
  vault.files.set(
    "Daylane/Items/整理接口文档.md",
    noteContent(
      {
        "daylane-type": "important-event",
        "daylane-date": "2026-10-09",
        "daylane-status": "open",
        "daylane-rollover-count": 0,
        custom: "保留",
        "date created": "原创建时间",
      },
      "\n## 原文\n\n完整说明。\n",
    ),
  );
  // 提供 Markdown 事实仓库，验证索引与写入契约
  const repository = new ItemRepository(vault, "Daylane/Items", limited);
  await repository.scan();
  return { vault, repository };
}
