import { Signal } from "./domain";

/** 番茄钟模式，不关联事项或项目 */
export type TimerMode = "focus" | "break";
/** 独立计时生命周期 */
export type TimerStatus = "idle" | "running" | "paused" | "finished";
/** 给面板与状态栏读取的计时快照 */
export interface TimerSnapshot {
  /** 专注或休息 */
  mode: TimerMode;
  /** 当前运行状态 */
  status: TimerStatus;
  /** 本轮分钟数 */
  minutes: number;
  /** 当前剩余秒数 */
  seconds: number;
}
/** 校验用户自定义的专注与休息时长 */
export function validMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 240;
}
/** 用真实截止时间计时，不在后台靠每秒递减 */
export class TimerService {
  /** 计时变化通知，多个面板共享 */
  readonly changes = new Signal();
  /** 当前模式 */
  private mode: TimerMode = "focus";
  /** 当前阶段 */
  private status: TimerStatus = "idle";
  /** 本轮默认或临时指定时长 */
  private minutes = 25;
  /** 暂停时冻结的毫秒数 */
  private remaining = 25 * 60_000;
  /** 运行阶段截止时间 */
  private deadline = 0;
  /** 注入时间源与完成通知以测试后台恢复 */
  constructor(
    private now: () => number,
    private finished: (mode: TimerMode) => void,
  ) {}
  /** 返回统一计时显示状态 */
  snapshot(): TimerSnapshot {
    return {
      mode: this.mode,
      status: this.status,
      minutes: this.minutes,
      seconds: Math.ceil(
        Math.max(
          0,
          this.status === "running"
            ? this.deadline - this.now()
            : this.remaining,
        ) / 1000,
      ),
    };
  }
  /** 切换模式会放弃当前轮并重置为指定时长 */
  select(mode: TimerMode, minutes: number): void {
    if (!validMinutes(minutes)) throw new Error("时长应为 1—240 的整数分钟");
    this.mode = mode;
    this.minutes = minutes;
    this.status = "idle";
    this.remaining = minutes * 60_000;
    this.changes.emit();
  }
  /** 空闲开始或从暂停继续，不自动开始下一阶段 */
  start(): void {
    if (this.status === "running") return;
    if (this.status === "finished") this.remaining = this.minutes * 60_000;
    this.deadline = this.now() + this.remaining;
    this.status = "running";
    this.changes.emit();
  }
  /** 暂停时保存真实剩余时间，已结束的轮次不再暂停 */
  pause(): void {
    this.tick();
    if (this.status !== "running") return;
    this.remaining = Math.max(0, this.deadline - this.now());
    this.status = "paused";
    this.changes.emit();
  }
  /** 放弃当前轮并回到本轮时长 */
  reset(): void {
    this.status = "idle";
    this.remaining = this.minutes * 60_000;
    this.changes.emit();
  }
  /** 轮询与回到前台都校验截止时间，每轮只完成一次 */
  tick(): void {
    if (this.status !== "running") return;
    if (this.deadline <= this.now()) {
      this.status = "finished";
      this.remaining = 0;
      this.finished(this.mode);
    }
    this.changes.emit();
  }
}
