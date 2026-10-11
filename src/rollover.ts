import { Item, localDay, Preferences, RolloverRecord, text } from "./domain";
import { HolidayService } from "./holidays";
import { ItemRepository } from "./repository";

/** 流转或撤回的逐项结果 */
export interface BatchResult {
  /** 实际成功处理的事项数 */
  changed: number;
  /** 因最新状态或外部更改而跳过的数量 */
  skipped: number;
  /** 可理解的失败或暂缓原因 */
  errors: string[];
}
/** 判断未完成待办是否应按本地当天顺延 */
export function shouldRoll(
  item: Item,
  today: string,
  settings: Preferences,
): boolean {
  return (
    item.kind === "todo" &&
    item.status === "open" &&
    Boolean(item.scheduled && item.scheduled < today) &&
    (item.rollover === "auto" ||
      (item.rollover === "inherit" && settings.autoRollover))
  );
}
/** 插件级流转执行器，记录最近批次并检查撤回冲突 */
export class RolloverService {
  /** 合并启动、日期变化和前台检查的重复任务 */
  private running: Promise<BatchResult> | null = null;
  /** 注入共享仓库、节假日与持久化边界 */
  constructor(
    private repository: ItemRepository,
    private holidays: HolidayService,
    private settings: () => Preferences,
    private save: () => Promise<void>,
  ) {}
  /** 自动流转仅选取过去日期的待办，手动模式将过期待办移到今天 */
  run(manual = false, today = localDay()): Promise<BatchResult> {
    if (this.running) return this.running;
    this.running = this.execute(manual, today).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  /** 顺序写入每条事项，先持久化恢复意图再更新笔记 */
  private async execute(manual: boolean, today: string): Promise<BatchResult> {
    // 快照只筛选候选，最终规则在写入回调重新核对
    const result: BatchResult = { changed: 0, skipped: 0, errors: [] };
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings = this.settings();
    // 收集符合规则的目标项，最终写入前再核对事实
    const candidates = this.repository
      .items()
      .filter((item) =>
        manual
          ? item.kind === "todo" &&
            item.status === "open" &&
            Boolean(item.scheduled && item.scheduled < today)
          : shouldRoll(item, today, settings),
      );
    if (!candidates.length) return result;
    // 确定本次操作目标，避免写入未知日期或错误路径
    const target =
      !manual && settings.rolloverMode === "workday"
        ? this.holidays.nextWorkday(today)
        : today;
    if (!target) {
      result.errors.push(
        `未收录 ${today.slice(0, 4)} 年或后续年度正式节假日，工作日流转暂缓`,
      );
      return result;
    }
    // 仅有候选时才创建批次，空检查不会抹掉撤回记录
    const previousBatch = settings.lastBatch;
    // 收集本批实际流转轨迹，支持重启后核对与撤回
    const records: RolloverRecord[] = [];
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of candidates) {
      try {
        // 保存单条事项流转前后状态，供持久化恢复使用
        const record: RolloverRecord = {
          id: item.id,
          path: item.path,
          from: item.scheduled!,
          to: target,
          previousCount: item.rolloverCount,
          updated: new Date().toISOString(),
          applied: false,
        };
        records.push(record);
        settings.lastBatch = records;
        await this.save();
        // 标记最新校验后是否实际更新，区分成功与跳过
        const changed = await this.repository.mutate(
          item,
          (fields, current) => {
            if (
              current.status !== "open" ||
              current.kind !== "todo" ||
              current.scheduled !== record.from ||
              (!manual && !shouldRoll(current, today, this.settings()))
            )
              return false;
            record.previousCount = current.rolloverCount;
            record.previousFrom =
              text(fields["last-rollover-from"]) || undefined;
            record.previousTo = text(fields["last-rollover-to"]) || undefined;
            fields.scheduled = target;
            fields["original-scheduled"] ??= record.from;
            fields["rollover-count"] = current.rolloverCount + 1;
            fields["last-rollover-from"] = record.from;
            fields["last-rollover-to"] = target;
            fields.updated = record.updated;
            return true;
          },
        );
        if (changed) {
          record.applied = true;
          record.fingerprint = await this.repository.digest(item.path);
          result.changed++;
        } else {
          records.splice(records.indexOf(record), 1);
          result.skipped++;
        }
        await this.save();
      } catch (error) {
        result.errors.push(
          `${item.title}：${error instanceof Error ? error.message : error}`,
        );
      }
    }
    if (!records.some((record) => record.applied)) {
      settings.lastBatch = previousBatch;
      try {
        await this.save();
      } catch (error) {
        result.errors.push(`恢复上一批撤回记录失败：${String(error)}`);
      }
    }
    return result;
  }
  /** 只撤回仍与流转后完整文件内容一致的事项 */
  undo(): Promise<BatchResult> {
    if (this.running) throw new Error("流转正在执行，请稍后撤回");
    this.running = this.restore().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  /** 与自动执行共享批次资源，恢复期间不重复写同一事项 */
  private async restore(): Promise<BatchResult> {
    // 保留未能恢复的记录，便于用户处理后重试
    const result: BatchResult = { changed: 0, skipped: 0, errors: [] };
    // 保留尚未安全恢复的事项记录，供后续处理
    const remaining: RolloverRecord[] = [];
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const record of this.settings().lastBatch) {
      try {
        // 读取当前事项快照，核对操作对象与排期状态
        const item = this.repository
          .items()
          .find(
            (entry) => entry.id === record.id && entry.path === record.path,
          );
        if (
          !item ||
          !record.applied ||
          !record.fingerprint ||
          (await this.repository.digest(record.path)) !== record.fingerprint
        ) {
          result.skipped++;
          remaining.push(record);
          continue;
        }
        // 标记最新校验后是否实际更新，区分成功与跳过
        const changed = await this.repository.mutate(
          item,
          (fields, current) => {
            if (
              current.status !== "open" ||
              current.kind !== "todo" ||
              current.scheduled !== record.to ||
              current.updated !== record.updated
            )
              return false;
            fields.scheduled = record.from;
            fields["rollover-count"] = record.previousCount;
            if (record.previousFrom)
              fields["last-rollover-from"] = record.previousFrom;
            else delete fields["last-rollover-from"];
            if (record.previousTo)
              fields["last-rollover-to"] = record.previousTo;
            else delete fields["last-rollover-to"];
            fields.updated = new Date().toISOString();
            return true;
          },
        );
        if (changed) result.changed++;
        else {
          result.skipped++;
          remaining.push(record);
        }
      } catch (error) {
        remaining.push(record);
        result.errors.push(
          `${record.path}：${error instanceof Error ? error.message : error}`,
        );
      }
    }
    this.settings().lastBatch = remaining;
    await this.save();
    return result;
  }
}
