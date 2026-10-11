import { fingerprint, ItemDraft, text, validDay } from "./domain";
import { ItemRepository, splitNote } from "./repository";

/** 旧事项导入预览，不改写源文件 */
export interface ImportCandidate {
  /** 旧笔记文件路径 */
  path: string;
  /** 源内容指纹，执行前验证与预览一致 */
  digest: string;
  /** 旧笔记原始内容 */
  content: string;
  /** 待导入业务字段 */
  draft: ItemDraft;
}
/** 将旧事项复制为独立的固定日程 */
export class MigrationService {
  /** 注入新插件事项仓库 */
  constructor(private repository: ItemRepository) {}
  /** 扫描指定旧目录，过滤新文件并提供可读失败信息 */
  async preview(folder: string): Promise<{
    candidates: ImportCandidate[];
    errors: string[];
    duplicates: number;
  }> {
    // 依据现有目标文件中的来源与指纹查重，不另建事实数据库
    const existing = new Set<string>();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of this.repository.items()) {
      // 读取文件或配置属性，不把元数据缓存当作唯一事实
      const fields = splitNote(
        await this.repository.port.read(item.path),
        this.repository.port.parseYaml,
      ).fields;
      if (fields["daylane-import-path"])
        existing.add(`path:${fields["daylane-import-path"]}`);
      if (fields["daylane-import-hash"])
        existing.add(`hash:${fields["daylane-import-hash"]}`);
    }
    // 收集符合规则的目标项，最终写入前再核对事实
    const candidates: ImportCandidate[] = [];
    // 逐项记录可解释的失败，不把部分失败报告成全部成功
    const errors: string[] = [];
    // 统计已导入来源，避免重复生成相同事项
    let duplicates = 0;
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const path of this.repository.port
      .paths()
      .filter((path) => path.startsWith(`${folder}/`))) {
      try {
        // 保留文件原文，用于解析、指纹校验与正文完整性检查
        const content = await this.repository.port.read(path);
        // 读取文件或配置属性，不把元数据缓存当作唯一事实
        const fields = splitNote(
          content,
          this.repository.port.parseYaml,
        ).fields;
        if (fields["calendar-plus-type"] !== "important-event") continue;
        // 记录源内容指纹，执行时确认仍与预览一致
        const digest = await fingerprint(content);
        if (existing.has(`path:${path}`) || existing.has(`hash:${digest}`)) {
          duplicates++;
          continue;
        }
        if (
          !validDay(fields.date) ||
          !text(fields.title).trim() ||
          !["open", "completed"].includes(text(fields.status))
        ) {
          errors.push(`${path}：日期、标题或状态不完整`);
          continue;
        }
        candidates.push({
          path,
          digest,
          content,
          draft: {
            title: text(fields.title),
            kind: "event",
            status: fields.status as "open" | "completed",
            start: fields.date,
            end: fields.date,
            project: "",
            color: text(fields.color) || "blue",
            rollover: "off",
          },
        });
        existing.add(`hash:${digest}`);
      } catch (error) {
        errors.push(
          `${path}：${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return { candidates, errors, duplicates };
  }
  /** 按预览逐条复制，源文件有变化则要求重新预览 */
  async execute(
    candidates: ImportCandidate[],
  ): Promise<{ created: number; errors: string[] }> {
    // 执行前重新扫描，避免重复点击或外部同步导致重复导入
    let created = 0;
    // 逐项记录可解释的失败，不把部分失败报告成全部成功
    const errors: string[] = [];
    // 按来源路径与内容指纹识别重复导入
    const imported = new Set<string>();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of this.repository.items()) {
      // 读取文件或配置属性，不把元数据缓存当作唯一事实
      const fields = splitNote(
        await this.repository.port.read(item.path),
        this.repository.port.parseYaml,
      ).fields;
      imported.add(text(fields["daylane-import-path"]));
      imported.add(text(fields["daylane-import-hash"]));
    }
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const candidate of candidates) {
      try {
        if (imported.has(candidate.path) || imported.has(candidate.digest))
          continue;
        // 保留文件原文，用于解析、指纹校验与正文完整性检查
        const content = await this.repository.port.read(candidate.path);
        if ((await fingerprint(content)) !== candidate.digest)
          throw new Error("源文件已改变，请重新预览");
        // 分离原始属性与正文，更新时保留用户原有说明
        const note = splitNote(content, this.repository.port.parseYaml);
        // 复制正文与未知属性，移除旧插件识别标记
        const extra: Record<string, unknown> = {
          ...note.fields,
          "daylane-import-path": candidate.path,
          "daylane-import-hash": candidate.digest,
        };
        delete extra["calendar-plus-type"];
        await this.repository.create(candidate.draft, note.body, extra);
        imported.add(candidate.path);
        imported.add(candidate.digest);
        created++;
      } catch (error) {
        errors.push(
          `${candidate.path}：${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return { created, errors };
  }
}
