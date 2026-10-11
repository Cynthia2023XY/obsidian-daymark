import { addDays, validDay } from "./domain";

/** 官方放假或调休上班的日期标记 */
export interface Holiday {
  /** 日历日期 */
  date: string;
  /** 对外展示的节日名称 */
  name: string;
  /** 放假与补班明确区分 */
  type: "holiday" | "workday";
}
/** 年度官方安排的元数据与日期集合 */
export interface HolidayYear {
  /** 安排适用年份 */
  year: number;
  /** 国务院公告来源 */
  source: string;
  /** 公告落款日期 */
  published: string;
  /** 节日名称、开始、结束、补班日期 */
  periods: [string, string, string, string[]][];
}
/** 从 2025 与 2026 年国务院公告独立录入的离线安排 */
export const HOLIDAY_YEARS: HolidayYear[] = [
  {
    year: 2025,
    source: "https://www.gov.cn/zhengce/zhengceku/202411/content_6986383.htm",
    published: "2024-11-12",
    periods: [
      ["元旦", "2025-01-01", "2025-01-01", []],
      ["春节", "2025-01-28", "2025-02-04", ["2025-01-26", "2025-02-08"]],
      ["清明节", "2025-04-04", "2025-04-06", []],
      ["劳动节", "2025-05-01", "2025-05-05", ["2025-04-27"]],
      ["端午节", "2025-05-31", "2025-06-02", []],
      [
        "国庆节、中秋节",
        "2025-10-01",
        "2025-10-08",
        ["2025-09-28", "2025-10-11"],
      ],
    ],
  },
  {
    year: 2026,
    source: "https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm",
    published: "2025-11-04",
    periods: [
      ["元旦", "2026-01-01", "2026-01-03", ["2026-01-04"]],
      ["春节", "2026-02-15", "2026-02-23", ["2026-02-14", "2026-02-28"]],
      ["清明节", "2026-04-04", "2026-04-06", []],
      ["劳动节", "2026-05-01", "2026-05-05", ["2026-05-09"]],
      ["端午节", "2026-06-19", "2026-06-21", []],
      ["中秋节", "2026-09-25", "2026-09-27", []],
      ["国庆节", "2026-10-01", "2026-10-07", ["2026-09-20", "2026-10-10"]],
    ],
  },
];
/** 离线节假日查表与工作日顺延 */
export class HolidayService {
  /** 指定日期对应的官方休假或补班 */
  private days = new Map<string, Holiday>();
  /** 将公告的连续范围展开为查表条目 */
  constructor() {
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const year of HOLIDAY_YEARS) {
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (const [name, start, end, workdays] of year.periods) {
        // 逐项处理当前业务集合，保留每项自己的状态与结果
        for (let date = start; date <= end; date = addDays(date, 1))
          this.days.set(date, { date, name, type: "holiday" });
        // 逐项处理当前业务集合，保留每项自己的状态与结果
        for (const date of workdays)
          this.days.set(date, { date, name: `${name}调休`, type: "workday" });
      }
    }
  }
  /** 判断该日期所在年度是否已收录正式安排 */
  covered(date: string): boolean {
    return (
      validDay(date) &&
      HOLIDAY_YEARS.some((entry) => entry.year === Number(date.slice(0, 4)))
    );
  }
  /** 返回公告标记，普通周末不伪装成正式假期 */
  get(date: string): Holiday | undefined {
    return this.days.get(date);
  }
  /** 严格区分未知年份与已知工作日 */
  isWorkday(date: string): boolean | null {
    if (!this.covered(date)) return null;
    // 官方标记优先于普通星期规则
    const holiday = this.get(date);
    if (holiday) return holiday.type === "workday";
    // 根据本地星期计算周排列或普通工作日
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return weekday !== 0 && weekday !== 6;
  }
  /** 从当天向后寻找已确认工作日，缺少年度数据时停止 */
  nextWorkday(date: string): string | null {
    while (this.covered(date)) {
      if (this.isWorkday(date)) return date;
      date = addDays(date, 1);
    }
    return null;
  }
}
