import { validDay } from "./domain";
import { CalendarOptions } from "./ui";

/** 校验日历代码块属性，不 silently 猜测错误输入 */
export function calendarOptions(
  fields: Record<string, unknown>,
): CalendarOptions {
  // 空或 current 跟随创建实例时的当前月
  const options: CalendarOptions = {};
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const key of Object.keys(fields))
    if (
      ![
        "month",
        "project",
        "show-holidays",
        "show-completed",
        "interactive",
      ].includes(key)
    )
      throw new Error(`不支持的日历配置：${key}`);
  if (fields.month !== undefined && fields.month !== "current") {
    if (typeof fields.month !== "string" || !validDay(`${fields.month}-01`))
      throw new Error("month 应为 YYYY-MM 或 current");
    options.month = fields.month;
  }
  if (fields.project !== undefined) {
    if (typeof fields.project !== "string")
      throw new Error("project 应为项目名称文本");
    options.project = fields.project;
  }
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const [field, option] of [
    ["show-holidays", "showHolidays"],
    ["show-completed", "showCompleted"],
    ["interactive", "interactive"],
  ] as const) {
    if (fields[field] === undefined) continue;
    if (typeof fields[field] !== "boolean")
      throw new Error(`${field} 应为 true 或 false`);
    options[option] = fields[field];
  }
  return options;
}
