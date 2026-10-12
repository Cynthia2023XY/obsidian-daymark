/** 单日事项只有未完成与完成两种状态 */
export type ItemStatus = "open" | "completed";
/** 日历和待办箱共享同一文档；没有日期时属于待办箱 */
export interface Item {
  /** 当前文档路径，更名由文件事件重新关联 */
  path: string;
  /** 文件名是展示标题，不依赖正文标题识别 */
  title: string;
  /** 计划日期；缺失表示未安排 */
  date?: string;
  /** 事项完成状态 */
  status: ItemStatus;
  /** 累计实际自动改期次数，手动操作永不清零 */
  rolloverCount: number;
  /** 旧格式仅兼容展示，确认迁移前不自动写入 */
  legacy: boolean;
}
/** 新建单日事项所需的最少业务信息 */
export interface ItemDraft {
  /** 事项名称 */
  title: string;
  /** 计划日期或待办箱空日期 */
  date?: string;
  /** 初始状态，默认未完成 */
  status?: ItemStatus;
}
/** 精简设置；番茄钟与事项配置完全独立 */
export interface Preferences {
  /** 新文档写入目录 */
  folder: string;
  /** 默认只扫描该目录及后代 */
  limitToFolder: boolean;
  /** 自然日或中国正式工作日 */
  rolloverMode: "calendar" | "workday";
  /** 允许的累计自动改期次数 */
  maxRollovers: number;
  /** 实验性：删除时仅移除专属属性 */
  preserveOnDelete: boolean;
  /** 是否启用独立计时 */
  timerEnabled: boolean;
  /** 专注默认分钟数 */
  focusMinutes: number;
  /** 休息默认分钟数 */
  breakMinutes: number;
  /** 是否播放本地短音 */
  sound: boolean;
}
/** 新版本固定周一、红点、显示所有状态，工作日流转默认启用 */
export const DEFAULTS: Preferences = {
  folder: "Daylane/Items",
  limitToFolder: true,
  rolloverMode: "workday",
  maxRollovers: 5,
  preserveOnDelete: false,
  timerEnabled: true,
  focusMinutes: 25,
  breakMinutes: 5,
  sound: true,
};
/** 只管理这些专属属性，删除事项不会误伤通用笔记元信息 */
export const ITEM_FIELDS = [
  "daylane-type",
  "daylane-date",
  "daylane-status",
  "daylane-rollover-count",
] as const;
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
/** 判断单日事项是否属于当前日期 */
export function onDay(item: Item, date: string): boolean {
  return item.date === date;
}
/** 只将真实字符串视为文本属性 */
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
/** 兼容旧 YAML 日期对象，但新版本只写规范字符串 */
export function dateText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  // 按本地自然日计算排期，避开 UTC 解析偏移
  const date = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (!validDay(date)) throw new Error("日期无效，请使用 YYYY-MM-DD");
  return date;
}
/** 累计次数是客观记录，不接受负数、小数或隐式截断 */
export function countValue(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0)
    throw new Error("自动流转次数应为非负整数");
  return value;
}
/** 从文件路径派生展示名称，正文标题变化不影响身份 */
export function itemTitle(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}
/** 识别新模型；日期缺失是待办箱而非错误 */
export function parseItem(
  fields: Record<string, unknown>,
  path: string,
): Item | null {
  if (fields["daylane-type"] !== "important-event") return null;
  // 明确生命周期状态，决定是否允许自动流转
  const status = fields["daylane-status"] ?? "open";
  if (status !== "open" && status !== "completed")
    throw new Error("事项状态只能为 open 或 completed");
  return {
    path,
    title: itemTitle(path),
    date: dateText(fields["daylane-date"]),
    status,
    rolloverCount: countValue(fields["daylane-rollover-count"]),
    legacy: false,
  };
}
/** 旧版只读兼容，复杂或取消事项必须在迁移预览中明确处理 */
export function legacyItem(
  fields: Record<string, unknown>,
  path: string,
): Item | null {
  // 保存当前处理阶段的事实结果，供后续校验与展示
  const daylane = fields["daylane-schema"] === 1;
  if (!daylane && fields["calendar-plus-type"] !== "important-event")
    return null;
  if (fields.status !== "open" && fields.status !== "completed")
    throw new Error("旧取消或异常状态事项需要迁移确认");
  // 按本地自然日计算排期，避开 UTC 解析偏移
  const date = daylane
    ? fields["daylane-kind"] === "event"
      ? fields.start
      : fields.scheduled
    : fields.date;
  if (
    daylane &&
    fields["daylane-kind"] === "event" &&
    fields.start !== fields.end
  )
    throw new Error("旧跨日事项需要在迁移时选择单日日期");
  return {
    path,
    title: text(fields.title) || itemTitle(path),
    date: dateText(date),
    status: fields.status,
    rolloverCount: countValue(fields["rollover-count"]),
    legacy: true,
  };
}
/** 校验新建名称与单日日期，不再创建复杂排期 */
export function validateDraft(draft: ItemDraft): void {
  if (!draft.title.trim()) throw new Error("请输入重要事项名称");
  dateText(draft.date);
  if (draft.status && draft.status !== "open" && draft.status !== "completed")
    throw new Error("事项状态无效");
}
/** 构造仅包含四个专属字段的创建属性 */
export function draftFields(
  draft: ItemDraft,
  count = 0,
): Record<string, unknown> {
  validateDraft(draft);
  return {
    "daylane-type": "important-event",
    "daylane-date": draft.date || undefined,
    "daylane-status": draft.status ?? "open",
    "daylane-rollover-count": countValue(count),
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
