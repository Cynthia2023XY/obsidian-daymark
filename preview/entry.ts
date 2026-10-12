import { DEFAULTS } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { ItemRepository } from "../src/repository";
import { TimerService } from "../src/timer";
import { CalendarPanel, TimerPanel, UiHost } from "../src/ui";
import { MemoryVault } from "../tests/helpers";
/** 真正的日历组件仅用内存演示数据，不接触 Vault */
async function mountPreview(): Promise<void> {
  // 提供 Markdown 事实仓库，验证索引与写入契约
  const repository = new ItemRepository(new MemoryVault(), "Daylane/Items");
  // 模拟宿主动作边界，组件使用真实业务服务
  const host: UiHost = {
    repository,
    holidays: new HolidayService(),
    timer: new TimerService(
      () => Date.now(),
      () => window.alert("计时结束"),
    ),
    getPreferences: () => ({ ...DEFAULTS }),
    notify: (message) => window.alert(message),
    prepareSound: () => undefined,
    create: (date) => {
      // 保存可读标题，用于展示、表单编辑与文件命名
      const title = window.prompt("事项内容");
      if (title) void repository.create({ title, date });
    },
    open: async (item) => {
      window.alert(await repository.port.read(item.path));
    },
    status: (item, status) => repository.status(item, status),
    remove: (item) => {
      void repository.removeItem(item, false);
    },
    migrate: () => window.alert("真实迁移入口位于 Obsidian 设置"),
    context: (item, event) => {
      event.preventDefault();
      // 按本地自然日计算排期，避开 UTC 解析偏移
      const date = window.prompt("安排日期，留空进入待办箱", item.date ?? "");
      if (date !== null)
        void repository
          .schedule(item, date || undefined)
          .catch((error) => window.alert(String(error)));
    },
  };
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const date of [
    "2026-09-28",
    "2026-09-29",
    "2026-10-01",
    "2026-10-02",
    "2026-10-05",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-12",
    "2026-10-13",
    "2026-10-14",
  ])
    await repository.create({ title: "重要事项 " + date, date });
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const title of [
    "优惠券兑换多种奖品-上线",
    "检查一下体验金膨胀承接的待办",
    "检查一下这堆折叠屏，到底什么节奏",
  ])
    await repository.create({ title, date: "2026-10-15" });
  await repository.create({ title: "暂时未安排的事项" });
  new CalendarPanel(document.querySelector<HTMLElement>("#calendar")!, host, {
    month: "2026-10",
  });
  new TimerPanel(document.querySelector<HTMLElement>("#timer")!, host);
  window.setInterval(() => host.timer.tick(), 1000);
}
void mountPreview();
