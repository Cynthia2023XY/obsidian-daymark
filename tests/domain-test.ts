import { describe, expect, it } from "vitest";
import {
  addDays,
  DEFAULTS,
  draftFields,
  legacyItem,
  localDay,
  midnightDelay,
  monthDays,
  parseItem,
  safeFolder,
  shiftMonth,
} from "../src/domain";
import { HolidayService } from "../src/holidays";
import { calendarOptions } from "../src/codeblock";
/** 日期、专属标记与工作日边界 */
describe("单日领域模型", () => {
  it("闰年、跨月跨年与本地午夜", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(() => addDays("2026-02-29", 1)).toThrow();
    expect(localDay(new Date(2026, 9, 12, 0, 1))).toBe("2026-10-12");
    expect(midnightDelay(new Date(2026, 9, 12, 23, 59))).toBe(60_050);
    expect(monthDays("2026-10", true)).toHaveLength(42);
    expect(monthDays("2026-10", true)[0]).toBe("2026-09-28");
  });
  it("标记是必要条件，日期缺失就是待办箱", () => {
    expect(parseItem({ title: "普通笔记" }, "note.md")).toBeNull();
    expect(
      parseItem({ "daylane-type": "important-event" }, "note.md"),
    ).toMatchObject({
      title: "note",
      date: undefined,
      status: "open",
      rolloverCount: 0,
    });
    expect(() =>
      parseItem(
        { "daylane-type": "important-event", "daylane-date": "乱日期" },
        "note.md",
      ),
    ).toThrow();
    expect(() =>
      parseItem(
        { "daylane-type": "important-event", "daylane-status": "cancelled" },
        "note.md",
      ),
    ).toThrow();
  });
  it("新建只写四个字段，累计次数不接受负数或小数", () => {
    expect(
      Object.keys(draftFields({ title: "测试b", date: "2026-10-12" })),
    ).toHaveLength(4);
    expect(() => draftFields({ title: "", date: "2026-10-12" })).toThrow();
    expect(() =>
      parseItem(
        { "daylane-type": "important-event", "daylane-rollover-count": -1 },
        "n.md",
      ),
    ).toThrow();
  });
  it("旧单日兼容只读，取消和跨日不能猜测转换", () => {
    expect(
      legacyItem(
        {
          "calendar-plus-type": "important-event",
          date: "2026-10-12",
          title: "旧事项",
          status: "open",
        },
        "old.md",
      ),
    ).toMatchObject({ legacy: true, title: "旧事项" });
    expect(() =>
      legacyItem(
        {
          "daylane-schema": 1,
          "daylane-kind": "event",
          start: "2026-10-12",
          end: "2026-10-15",
          status: "open",
        },
        "old.md",
      ),
    ).toThrow("跨日");
    expect(() =>
      legacyItem(
        {
          "calendar-plus-type": "important-event",
          date: "2026-10-12",
          status: "cancelled",
        },
        "old.md",
      ),
    ).toThrow("取消");
  });
  it("补班覆盖周末，未收录年度不推测", () => {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const holidays = new HolidayService();
    expect(holidays.isWorkday("2026-10-10")).toBe(true);
    expect(holidays.isWorkday("2026-10-01")).toBe(false);
    expect(holidays.nextWorkday("2026-10-11")).toBe("2026-10-12");
    expect(holidays.nextWorkday("2027-01-01")).toBeNull();
  });
  it("旧代码块配置兼容忽略，新界面没有项目或颜色开关", () => {
    expect(
      calendarOptions({
        month: "2026-10",
        project: "旧项目",
        "show-holidays": false,
        "show-completed": false,
        interactive: false,
      }),
    ).toEqual({ month: "2026-10", interactive: false });
    expect(() => calendarOptions({ month: "2026-13" })).toThrow();
    expect(() => calendarOptions({ interactive: "false" })).toThrow();
    expect(DEFAULTS.rolloverMode).toBe("workday");
    expect(DEFAULTS.sound).toBe(true);
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const folder of ["../x", "/Users/me", ".obsidian/plugins", "a/../b"])
      expect(() => safeFolder(folder)).toThrow();
  });
});
