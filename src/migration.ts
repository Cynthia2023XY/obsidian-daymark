import {
  countValue,
  dateText,
  draftFields,
  fingerprint,
  ItemStatus,
  text,
  validDay,
} from "./domain";
import {
  assignFields,
  ItemRepository,
  splitNote,
  noteContent,
} from "./repository";

/** 旧事项在写入前提供完整的可审阅选择 */
export interface ImportCandidate {
  /** 原文路径 */
  path: string;
  /** 预览时完整原文 */
  content: string;
  /** 原文摘要 */
  digest: string;
  /** 已识别旧属性 */
  fields: Record<string, unknown>;
  /** 旧内容来源 */
  source: "Daylane 0.1.0" | "Calendar Plus";
  /** 可转换单日日期；空值为待办箱 */
  date?: string;
  /** 取消或异常状态必须由用户选择 */
  status?: ItemStatus;
  /** 多日或异常状态的解释 */
  reason?: string;
}
/** 明确选择的迁移项 */
export interface MigrationChoice {
  /** 原始预览对象 */
  candidate: ImportCandidate;
  /** 用户选定的新日期 */
  date?: string;
  /** 用户选定的完成状态 */
  status: ItemStatus;
}
/** 本版本不再写入的旧专属字段 */
const OLD_PRIVATE = [
  "daylane-schema",
  "daylane-id",
  "daylane-kind",
  "daylane-import-path",
  "daylane-import-hash",
  "calendar-plus-type",
];
/** 可预览确认清理的旧业务键，其他属性完整保留 */
const OLD_BUSINESS = [
  "title",
  "status",
  "scheduled",
  "date",
  "start",
  "end",
  "deadline",
  "project",
  "color",
  "rollover",
  "rollover-count",
  "original-scheduled",
  "last-rollover-from",
  "last-rollover-to",
  "created",
  "updated",
  "completed-at",
];
/** 原地升级旧属性；任何写入前先保存不会被索引的原文备份 */
export class MigrationService {
  /** 注入同一索引和文件边界 */
  constructor(private repository: ItemRepository) {}
  /** 只预览配置范围内的旧标记文档 */
  async preview(): Promise<{
    candidates: ImportCandidate[];
    errors: string[];
  }> {
    // 收集符合规则的目标项，最终写入前再核对事实
    const candidates: ImportCandidate[] = [];
    // 逐项记录可解释的失败，不把部分失败报告成全部成功
    const errors: string[] = [];
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const path of this.repository.port
      .paths()
      .filter((path) => this.repository.contains(path))) {
      try {
        // 保留文件原文，用于解析、指纹校验与正文完整性检查
        const content = await this.repository.port.read(path);
        // 读取文件或配置属性，不把元数据缓存当作唯一事实
        const fields = splitNote(
          content,
          this.repository.port.parseYaml,
        ).fields;
        if (fields["daylane-type"] === "important-event") continue;
        // 保存当前处理阶段的事实结果，供后续校验与展示
        const isDaylane = fields["daylane-schema"] === 1;
        if (!isDaylane && fields["calendar-plus-type"] !== "important-event")
          continue;
        // 保存当前处理阶段的事实结果，供后续校验与展示
        const reason: string[] = [];
        // 明确生命周期状态，决定是否允许自动流转
        const status =
          fields.status === "open" || fields.status === "completed"
            ? fields.status
            : undefined;
        if (!status) reason.push("旧取消或异常状态，请选择完成状态");
        // 按本地自然日计算排期，避开 UTC 解析偏移
        let date: string | undefined;
        try {
          // 保存当前处理阶段的事实结果，供后续校验与展示
          const raw = isDaylane
            ? fields["daylane-kind"] === "event"
              ? fields.start
              : fields.scheduled
            : fields.date;
          date = dateText(raw);
          if (
            isDaylane &&
            fields["daylane-kind"] === "event" &&
            fields.start !== fields.end
          ) {
            reason.push("旧跨日事项，请选择一个日期或待办箱");
            date = undefined;
          }
        } catch {
          reason.push("旧日期无效，请选择日期或待办箱");
        }
        countValue(fields["rollover-count"]);
        candidates.push({
          path,
          content,
          fields,
          digest: await fingerprint(content),
          source: isDaylane ? "Daylane 0.1.0" : "Calendar Plus",
          date,
          status,
          reason: reason.join("；") || undefined,
        });
      } catch (error) {
        errors.push(
          path +
            "：" +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return { candidates, errors };
  }
  /** 备份和事实校验后原地改属性，可选规范旧随机文件名和生成标题 */
  async execute(
    choices: MigrationChoice[],
    cleanBusiness = true,
    normalizeFiles = false,
  ): Promise<{ changed: number; errors: string[]; backups: string[] }> {
    // 标记最新校验后是否实际更新，区分成功与跳过
    let changed = 0;
    // 逐项记录可解释的失败，不把部分失败报告成全部成功
    const errors: string[] = [];
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const backups: string[] = [];
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const choice of choices) {
      try {
        // 保存当前处理阶段的事实结果，供后续校验与展示
        const candidate = choice.candidate;
        if (choice.date && !validDay(choice.date))
          throw new Error("新日期无效");
        if (choice.status !== "open" && choice.status !== "completed")
          throw new Error("请选择完成状态");
        // 保留最新事实状态，避免旧操作覆盖后续修改
        const current = await this.repository.port.read(candidate.path);
        if (current !== candidate.content)
          throw new Error("原文已改变，请重新预览");
        backups.push(
          await this.repository.port.backup(candidate.path, current),
        );
        // 保存可读标题，用于展示、表单编辑与文件命名
        const title = text(candidate.fields.title);
        // 读取旧身份，用于验证随机后缀确实来自旧插件
        const id = text(candidate.fields["daylane-id"]);
        // 保存当前处理阶段的事实结果，供后续校验与展示
        const basename = candidate.path.split("/").pop()!.slice(0, -3);
        // 保存当前处理阶段的事实结果，供后续校验与展示
        const eligible = Boolean(
          title && id && basename.endsWith("-" + id.slice(0, 8)),
        );
        await this.repository.port.process(candidate.path, (content) => {
          if (content !== candidate.content)
            throw new Error("原文已改变，已保留备份，请重新预览");
          // 分离原始属性与正文，更新时保留用户原有说明
          const note = splitNote(content, this.repository.port.parseYaml);
          // 逐项处理当前业务集合，保留每项自己的状态与结果
          for (const key of OLD_PRIVATE) delete note.fields[key];
          if (cleanBusiness)
            // 逐项处理当前业务集合，保留每项自己的状态与结果
            for (const key of OLD_BUSINESS) delete note.fields[key];
          assignFields(
            note.fields,
            draftFields(
              {
                title: title || basename,
                date: choice.date,
                status: choice.status,
              },
              countValue(candidate.fields["rollover-count"]),
            ),
          );
          if (
            normalizeFiles &&
            eligible &&
            note.body.startsWith("\n# " + title + "\n")
          )
            note.body =
              "\n## " +
              title +
              "\n" +
              note.body.slice(("\n# " + title + "\n").length);
          return noteContent(note.fields, note.body);
        });
        changed++;
        // 属性已转换；之后规范名称失败仍如实报告已转换数量
        let target = candidate.path;
        if (normalizeFiles && eligible) {
          // 保持旧文档目录，规范名称不会搬动笔记位置
          const directory = candidate.path.includes("/")
            ? candidate.path.slice(0, candidate.path.lastIndexOf("/"))
            : "";
          target = this.repository.availablePath(title, directory);
          while (true) {
            try {
              await this.repository.port.rename(candidate.path, target);
              break;
            } catch (error) {
              if (!this.repository.port.exists(target)) throw error;
              target = this.repository.availablePath(title, directory);
            }
          }
          await this.repository.renamed(target, candidate.path);
        } else await this.repository.refresh(target);
      } catch (error) {
        errors.push(
          choice.candidate.path +
            "：" +
            (error instanceof Error ? error.message : String(error)),
        );
        await this.repository.refresh(choice.candidate.path);
      }
    }
    return { changed, errors, backups };
  }
}
