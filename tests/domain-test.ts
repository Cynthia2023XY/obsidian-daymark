import { describe, expect, it } from "vitest";
import {
  addDays,
  DEFAULTS,
  localDay,
  midnightDelay,
  monthDays,
  onDay,
  parseItem,
  safeFolder,
  shiftMonth,
} from "../src/domain";
import { HolidayService } from "../src/holidays";
import { calendarOptions } from "../src/codeblock";
import { fixture } from "./helpers";

/** 日历边界与正式节假日决定实际排期 */
describe("日期、配置与中国正式节假日", () => {
  it("闰年、跨月、跨年按本地自然日计算", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(() => addDays("2026-02-29", 1)).toThrow();
    expect(localDay(new Date(2026, 9, 11, 0, 1))).toBe("2026-10-11");
  });
  it("月历第一行按周一或周日排列，涵盖跨月日期", () => {
    expect(monthDays("2026-10", true)).toHaveLength(42);
    expect(monthDays("2026-10", true)[0]).toBe("2026-09-28");
    expect(monthDays("2026-10", false)[0]).toBe("2026-09-27");
    expect(midnightDelay(new Date(2026, 9, 11, 23, 59))).toBe(60_050);
  });
  it("跨日固定日程包含结束日期，待办只显示计划日", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    expect(onDay(item, "2026-10-09")).toBe(true);
    expect(
      onDay(
        { ...item, kind: "event", start: "2026-09-30", end: "2026-10-02" },
        "2026-10-02",
      ),
    ).toBe(true);
    expect(
      onDay(
        { ...item, kind: "event", start: "2026-09-30", end: "2026-10-02" },
        "2026-10-03",
      ),
    ).toBe(false);
  });
  it("调休上班覆盖周末，工作日放假覆盖星期规则", () => {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const holidays = new HolidayService();
    expect(holidays.isWorkday("2026-10-10")).toBe(true);
    expect(holidays.isWorkday("2026-10-01")).toBe(false);
    expect(holidays.nextWorkday("2026-10-01")).toBe("2026-10-08");
    expect(holidays.nextWorkday("2026-10-11")).toBe("2026-10-12");
    expect(holidays.isWorkday("2027-01-01")).toBeNull();
    expect(holidays.get("2025-10-11")?.type).toBe("workday");
  });
  it("未知年度不推测，工作日跨年遇到缺失数据也暂缓", () => {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const holidays = new HolidayService();
    expect(holidays.nextWorkday("2027-01-01")).toBeNull();
    expect(holidays.covered("2030-10-11")).toBe(false);
  });
  it("目录不能逃逸 Vault 或指向插件配置目录", () => {
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const value of [
      "../其他目录",
      "/Users/me",
      "a/../b",
      ".obsidian/plugins",
      "a//b",
    ])
      expect(() => safeFolder(value)).toThrow();
    expect(safeFolder(" 我的事项/2026/ ")).toBe("我的事项/2026");
  });
  it("配置错误明确报告，不接受字符串伪装成布尔值", () => {
    expect(
      calendarOptions({
        month: "2026-10",
        interactive: false,
        "show-holidays": true,
      }),
    ).toEqual({ month: "2026-10", interactive: false, showHolidays: true });
    expect(() => calendarOptions({ month: "2026-13" })).toThrow();
    expect(() => calendarOptions({ interactive: "false" })).toThrow();
    expect(() => calendarOptions({ unexpected: true })).toThrow();
    expect(DEFAULTS.autoRollover).toBe(false);
  });
  it("普通笔记不被识别成事项，损坏事项也不能参与排期", () => {
    expect(parseItem({ title: "普通笔记" }, "note.md")).toBeNull();
    expect(() => parseItem({ "daylane-schema": 1 }, "bad.md")).toThrow("身份");
  });
});
