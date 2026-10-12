import { Item, localDay, Preferences } from "./domain";
import { HolidayService } from "./holidays";
import { ItemRepository } from "./repository";
/** 批量操作的实际成功、入箱、跳过与错误 */
export interface BatchResult {
  /** 实际修改数量 */
  changed: number;
  /** 其中达到上限进入待办箱的数量 */
  inbox: number;
  /** 写入时状态已经变化的数量 */
  skipped: number;
  /** 每条失败原因 */
  errors: string[];
}
/** 旧事项、待办箱、完成项与未来项不自动写入 */
export function shouldRoll(item: Item, today: string): boolean {
  return (
    !item.legacy &&
    item.status === "open" &&
    Boolean(item.date && item.date < today)
  );
}
/** 自动处理只累计真实成功改期，不虚构离线历史 */
export class RolloverService {
  /** 合并启动、午夜和恢复前台的同一批自动检查 */
  private running: Promise<BatchResult> | null = null;
  /** 共享事实仓库与正式工作日规则 */
  constructor(
    private repository: ItemRepository,
    private holidays: HolidayService,
    private settings: () => Preferences,
  ) {}
  /** 第六次需要顺延时只删除日期，次数仍为五 */
  run(today = localDay()): Promise<BatchResult> {
    if (this.running) return this.running;
    this.running = this.execute("auto", today).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  /** 手动批量改到今天，累计次数保持原值 */
  async moveToToday(today = localDay()): Promise<BatchResult> {
    if (this.running) await this.running;
    return this.execute("today", today);
  }
  /** 批量完成今天的事项，不触碰未来与待办箱 */
  async completeToday(today = localDay()): Promise<BatchResult> {
    if (this.running) await this.running;
    return this.execute("complete", today);
  }
  /** 每次写入重新校验最新日期与状态 */
  private async execute(
    mode: "auto" | "today" | "complete",
    today: string,
  ): Promise<BatchResult> {
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result: BatchResult = {
      changed: 0,
      inbox: 0,
      skipped: 0,
      errors: [],
    };
    // 收集符合规则的目标项，最终写入前再核对事实
    const candidates = this.repository
      .items()
      .filter((item) =>
        mode === "complete"
          ? !item.legacy && item.status === "open" && item.date === today
          : shouldRoll(item, today),
      );
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of candidates) {
      try {
        // 保存当前处理阶段的事实结果，供后续校验与展示
        let movedToInbox = false;
        // 标记最新校验后是否实际更新，区分成功与跳过
        const changed = await this.repository.mutate(
          item,
          (fields, current) => {
            if (current.date !== item.date || current.status !== "open")
              return false;
            if (mode === "complete") {
              fields["daylane-status"] = "completed";
              return true;
            }
            if (!shouldRoll(current, today)) return false;
            if (mode === "today") {
              fields["daylane-date"] = today;
              return true;
            }
            if (current.rolloverCount >= this.settings().maxRollovers) {
              delete fields["daylane-date"];
              movedToInbox = true;
              return true;
            }
            // 确定本次操作目标，避免写入未知日期或错误路径
            const target =
              this.settings().rolloverMode === "workday"
                ? this.holidays.nextWorkday(today)
                : today;
            if (!target)
              throw new Error("该年度正式节假日未收录，工作日流转暂缓");
            fields["daylane-date"] = target;
            fields["daylane-rollover-count"] = current.rolloverCount + 1;
            return true;
          },
        );
        if (changed) {
          result.changed++;
          if (movedToInbox) result.inbox++;
        } else result.skipped++;
      } catch (error) {
        result.errors.push(
          item.title +
            "：" +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return result;
  }
}
