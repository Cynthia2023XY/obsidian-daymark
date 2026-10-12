import { vi } from "vitest";
import { DEFAULTS } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { TimerService } from "../src/timer";
import { UiHost } from "../src/ui";
import { fixture } from "./helpers";
/** 只在宿主动作边界模拟，组件使用真实仓库与计时器 */
export async function hostFixture(): Promise<UiHost> {
  // 取得当前测试或业务边界，核对完整操作链
  const { repository } = await fixture();
  return {
    repository,
    holidays: new HolidayService(),
    timer: new TimerService(() => Date.now(), vi.fn()),
    getPreferences: () => ({ ...DEFAULTS }),
    create: vi.fn(),
    open: vi.fn(async () => undefined),
    remove: vi.fn(),
    status: (item, status) => repository.status(item, status),
    context: vi.fn(),
    migrate: vi.fn(),
    notify: vi.fn(),
    prepareSound: vi.fn(),
  };
}
