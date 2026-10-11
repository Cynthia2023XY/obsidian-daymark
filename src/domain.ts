/** 单条事项的类型：待办可以流转，固定日程保持排期 */
export type ItemKind = "todo" | "event";
/** 事项生命周期，取消与完成均停止自动流转 */
export type ItemStatus = "open" | "completed" | "cancelled";
/** 单条待办对全局自动流转设置的覆盖方式 */
export type RolloverPolicy = "inherit" | "auto" | "off";
/** 事项允许使用的主题兼容颜色名称 */
export const COLORS = [
  "blue",
  "green",
  "orange",
  "red",
  "purple",
  "gray",
] as const;
/** 在文件与内存之间传递的重要事项 */
export interface Item {
  /** 稳定事项身份，文件更名后仍保持不变 */
  id: string;
  /** 当前 Markdown 文件路径 */
  path: string;
  /** 用户可读的事项标题 */
  title: string;
  /** 待办或固定日程 */
  kind: ItemKind;
  /** 完成与取消状态 */
  status: ItemStatus;
  /** 待办的计划执行日期 */
  scheduled?: string;
  /** 首次计划日期，自动顺延不改动 */
  originalScheduled?: string;
  /** 待办的固定截止日期 */
  deadline?: string;
  /** 固定日程开始日期 */
  start?: string;
  /** 固定日程结束日期，包含当天 */
  end?: string;
  /** 所属项目，用于日历筛选 */
  project: string;
  /** 受控颜色名称 */
  color: string;
  /** 自动流转覆盖方式 */
  rollover: RolloverPolicy;
  /** 实际成功顺延次数 */
  rolloverCount: number;
  /** 最近修改时间，用于检测撤回冲突 */
  updated: string;
}
/** 创建或编辑表单提供的业务字段 */
export type ItemDraft = Omit<
  Item,
  "id" | "path" | "originalScheduled" | "rolloverCount" | "updated"
>;
/** 单条流转的可恢复记录 */
export interface RolloverRecord {
  /** 流转目标事项身份 */
  id: string;
  /** 稳定笔记路径 */
  path: string;
  /** 原计划日期 */
  from: string;
  /** 本次流转后的计划日期 */
  to: string;
  /** 本次流转前的次数 */
  previousCount: number;
  /** 写入版本标记，撤回时校验 */
  updated: string;
  /** 流转后原始文件指纹，外部修改后不自动撤回 */
  fingerprint?: string;
  /** 是否已完成笔记写入 */
  applied: boolean;
  /** 前一次来源日期，供恢复流转痕迹使用 */
  previousFrom?: string;
  /** 前一次目标日期，供恢复流转痕迹使用 */
  previousTo?: string;
}
/** 插件持久化偏好与最近一次流转批次 */
export interface Preferences {
  /** 只在指定目录管理事项 */
  folder: string;
  /** 新事项默认颜色 */
  color: string;
  /** 星期是否从周一开始 */
  mondayFirst: boolean;
  /** 是否展示完成和取消事项 */
  showCompleted: boolean;
  /** 是否展示放假与调休标记 */
  showHolidays: boolean;
  /** 默认是否自动顺延待办 */
  autoRollover: boolean;
  /** 顺延到自然日或工作日 */
  rolloverMode: "calendar" | "workday";
  /** 是否启用独立番茄钟 */
  timerEnabled: boolean;
  /** 默认专注分钟数 */
  focusMinutes: number;
  /** 默认休息分钟数 */
  breakMinutes: number;
  /** 到时是否播放短提示音 */
  sound: boolean;
  /** 最近一次流转批次，支持重启后撤回 */
  lastBatch: RolloverRecord[];
}
/** 新安装默认关闭自动写入，不恢复番茄钟运行会话 */
export const DEFAULTS: Preferences = {
  folder: "Daylane/Items",
  color: "blue",
  mondayFirst: true,
  showCompleted: true,
  showHolidays: true,
  autoRollover: false,
  rolloverMode: "calendar",
  timerEnabled: true,
  focusMinutes: 25,
  breakMinutes: 5,
  sound: false,
  lastBatch: [],
};

/** 以本地日历语义输出日期，避免 UTC 解析偏移 */
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** 校验真实日期，包括月份天数与闰年 */
export function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  // 中午构造本地日期，避开午夜夏令时转换
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDay(date) === value;
}
/** 在本地日历日期上增加天数 */
export function addDays(value: string, days: number): string {
  if (!validDay(value)) throw new Error("日期无效");
  // 保留本地年月日，跨 DST 时不按固定毫秒相加
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
}
/** 在月初日期上移动月份 */
export function shiftMonth(month: string, count: number): string {
  if (!validDay(`${month}-01`)) throw new Error("月份无效");
  // 月初避免月底溢出
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + count);
  return localDay(date).slice(0, 7);
}
/** 生成含相邻月份日期的完整六周月历 */
export function monthDays(month: string, mondayFirst: boolean): string[] {
  if (!validDay(`${month}-01`)) throw new Error("月份无效");
  // 从所在周第一天开始填满六周
  const weekday = new Date(`${month}-01T12:00:00`).getDay();
  // 计算月初距当前周起点的天数，填入相邻月日期
  const offset = mondayFirst ? (weekday + 6) % 7 : weekday;
  // 记录起始边界或首次请求状态，验证顺序与竞态
  const first = addDays(`${month}-01`, -offset);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}
/** 计算下一次本地午夜的间隔，兼容夏令时 */
export function midnightDelay(now = new Date()): number {
  // 构造下一自然日午夜而非固定加一天毫秒数
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 50;
}
/** 判断事项是否覆盖指定日期 */
export function onDay(item: Item, date: string): boolean {
  return item.kind === "todo"
    ? item.scheduled === date
    : Boolean(item.start && item.end && item.start <= date && item.end >= date);
}
/** 将未知文本属性转换为明确的字符串 */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
/** 校验表单，不以猜测方式修复错误日期 */
export function validateDraft(draft: ItemDraft): void {
  if (!draft.title.trim()) throw new Error("请填写事项标题");
  if (draft.kind === "todo") {
    if (!validDay(draft.scheduled)) throw new Error("请填写有效的计划日期");
    if (draft.deadline && !validDay(draft.deadline))
      throw new Error("截止日期无效");
  } else if (
    !validDay(draft.start) ||
    !validDay(draft.end) ||
    draft.end < draft.start
  ) {
    throw new Error("日程结束日期不能早于开始日期");
  }
}
/** 从 frontmatter 读取受控事项字段，无标记的笔记保持原状 */
export function parseItem(
  fields: Record<string, unknown>,
  path: string,
): Item | null {
  if (fields["daylane-schema"] !== 1) return null;
  if (!text(fields["daylane-id"])) throw new Error("事项缺少身份 ID");
  if (!["todo", "event"].includes(text(fields["daylane-kind"])))
    throw new Error("事项类型无效");
  if (!["open", "completed", "cancelled"].includes(text(fields.status)))
    throw new Error("事项状态无效");
  // 限定可写字段，保留其他属性由存储层维护
  const item: Item = {
    id: text(fields["daylane-id"]),
    path,
    title: text(fields.title),
    kind: fields["daylane-kind"] as ItemKind,
    status: fields.status as ItemStatus,
    scheduled: text(fields.scheduled) || undefined,
    originalScheduled: text(fields["original-scheduled"]) || undefined,
    deadline: text(fields.deadline) || undefined,
    start: text(fields.start) || undefined,
    end: text(fields.end) || undefined,
    project: text(fields.project),
    color: COLORS.includes(fields.color as (typeof COLORS)[number])
      ? text(fields.color)
      : "blue",
    rollover: ["inherit", "auto", "off"].includes(text(fields.rollover))
      ? (fields.rollover as RolloverPolicy)
      : "inherit",
    rolloverCount:
      typeof fields["rollover-count"] === "number"
        ? fields["rollover-count"]
        : 0,
    updated: text(fields.updated),
  };
  validateDraft(item);
  return item;
}
/** 将事项编辑映射为属性更新，仅编辑业务字段 */
export function draftFields(draft: ItemDraft): Record<string, unknown> {
  validateDraft(draft);
  return {
    title: draft.title.trim(),
    "daylane-kind": draft.kind,
    status: draft.status,
    scheduled: draft.kind === "todo" ? draft.scheduled : undefined,
    deadline: draft.kind === "todo" ? draft.deadline : undefined,
    start: draft.kind === "event" ? draft.start : undefined,
    end: draft.kind === "event" ? draft.end : undefined,
    rollover: draft.kind === "todo" ? draft.rollover : "off",
    project: draft.project.trim(),
    color: COLORS.includes(draft.color as (typeof COLORS)[number])
      ? draft.color
      : "blue",
  };
}
/** 规范并校验事项管理目录，不允许遍历 Vault */
export function safeFolder(value: string): string {
  // 不替用户猜测绝对路径的相对含义
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /[:\x00-\x1f]/.test(normalized) ||
    normalized
      .split("/")
      .some(
        (part) =>
          !part || part === "." || part === ".." || part.startsWith("."),
      )
  ) {
    throw new Error("请输入 Vault 内的普通相对目录，例如 Daylane/Items");
  }
  return normalized;
}
/** 清理文件名中的路径符号，保留标题可读性 */
export function safeTitle(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|#\[\]\x00-\x1f]/g, "-")
      .trim()
      .slice(0, 70)
      .replace(/\.+$/g, "") || "事项"
  );
}
/** 为外部编辑冲突与迁移计算完整内容摘要 */
export async function fingerprint(content: string): Promise<string> {
  // 使用浏览器公开摘要接口，不依赖 Node 或原生桥
  const bytes = new TextEncoder().encode(content);
  // 保存原文摘要，防止错误恢复或重复迁移
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
/** 为同一插件实例的不同视图发布变化 */
export class Signal {
  /** 仅保存仍挂载的视图订阅 */
  private listeners = new Set<() => void>();
  /** 注册变化通知并返回卸载方法 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** 通知各视图重读事实数据 */
  emit(): void {
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const listener of this.listeners) listener();
  }
  /** 插件停止时释放订阅 */
  clear(): void {
    this.listeners.clear();
  }
}
