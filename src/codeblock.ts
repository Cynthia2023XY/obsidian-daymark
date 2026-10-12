import { validDay } from "./domain";
import { CalendarOptions } from "./ui";
/** 内嵌月历只保留月份与交互控制，旧展示配置忽略以兼容笔记 */
export function calendarOptions(
  fields: Record<string, unknown>,
): CalendarOptions {
  // 保存当前日历实例的配置，不改动其他实例状态
  const options: CalendarOptions = {};
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const key of Object.keys(fields))
    if (
      ![
        "month",
        "interactive",
        "project",
        "show-holidays",
        "show-completed",
      ].includes(key)
    )
      throw new Error("不支持的日历配置：" + key);
  if (fields.month !== undefined && fields.month !== "current") {
    if (typeof fields.month !== "string" || !validDay(fields.month + "-01"))
      throw new Error("month 应为 YYYY-MM 或 current");
    options.month = fields.month;
  }
  if (fields.interactive !== undefined) {
    if (typeof fields.interactive !== "boolean")
      throw new Error("interactive 应为 true 或 false");
    options.interactive = fields.interactive;
  }
  return options;
}
