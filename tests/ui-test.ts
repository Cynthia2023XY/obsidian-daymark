import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DEFAULTS, localDay } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { TimerService } from "../src/timer";
import { CalendarPanel, TimerPanel, UiHost } from "../src/ui";
import { fixture } from "./helpers";

/** 固定本地当天并提供真实浏览器摘要 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 11, 10));
});
/** 测试结束清理 DOM 与日期模拟 */
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
/** 使用实际仓库与计时服务，宿主动作在边界模拟 */
async function hostFixture(): Promise<UiHost> {
  // 取得当前测试或业务边界，核对完整操作链
  const { repository } = await fixture();
  // 建立独立计时状态机，不依赖事项数据
  const timer = new TimerService(() => Date.now(), vi.fn());
  return {
    repository,
    timer,
    holidays: new HolidayService(),
    getPreferences: () => ({ ...DEFAULTS, lastBatch: [] }),
    edit: vi.fn(),
    open: vi.fn(async () => undefined),
    trash: vi.fn(),
    status: vi.fn(async () => undefined),
    afterEdit: vi.fn(async () => undefined),
    notify: vi.fn(),
    prepareSound: vi.fn(),
  };
}
/** 用户操作验证共享数据与独立视图状态 */
describe("原生日历与番茄钟面板", () => {
  it("显示中国放假与调休上班，点击事项通知编辑宿主", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    document.body.append(root);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { month: "2026-10" });
    expect(
      root.querySelector('[data-date="2026-10-01"]')?.textContent,
    ).toContain("休");
    expect(
      root.querySelector('[data-date="2026-10-10"]')?.textContent,
    ).toContain("班");
    (
      root.querySelector(
        '[data-date="2026-10-09"] .daylane-chip',
      ) as HTMLButtonElement
    ).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.edit).toHaveBeenCalled();
    panel.dispose();
  });
  it("跨周日程显示多个连续片段，但数据中只有一个事项", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    await host.repository.create({
      title: "跨周联调",
      kind: "event",
      status: "open",
      start: "2026-10-09",
      end: "2026-10-14",
      rollover: "off",
      color: "green",
      project: "",
    });
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { month: "2026-10" });
    expect(root.querySelectorAll(".daylane-span")).toHaveLength(2);
    expect(host.repository.items()).toHaveLength(2);
    panel.dispose();
  });
  it("共享仓库刷新不改变各实例月份，卸载后不重新挂载", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 记录起始边界或首次请求状态，验证顺序与竞态
    const first = document.createElement("div");
    // 创建第二个独立视图或请求，核对共享状态与资源清理
    const second = document.createElement("div");
    // 挂载首个组件实例，验证状态独立与卸载行为
    const left = new CalendarPanel(first, host, { month: "2026-09" });
    // 挂载另一个组件实例，验证共享数据仍然刷新
    const right = new CalendarPanel(second, host, { month: "2026-10" });
    await host.repository.status(host.repository.items()[0], "completed");
    expect(
      (first.querySelector('input[type="month"]') as HTMLInputElement).value,
    ).toBe("2026-09");
    expect(
      (second.querySelector('input[type="month"]') as HTMLInputElement).value,
    ).toBe("2026-10");
    left.dispose();
    host.repository.changes.emit();
    expect(first.childElementCount).toBe(0);
    right.dispose();
  });
  it("展示模式不提供修改入口，也不会把标题当 HTML", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    await host.repository.edit(host.repository.items()[0], {
      ...host.repository.items()[0],
      title: '<img src="x" onerror="alert(1)">',
    });
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, {
      month: "2026-10",
      interactive: false,
    });
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).not.toContain("＋ 新建事项");
    expect(
      [...root.querySelectorAll("button")].some(
        (button) => button.textContent === "删除",
      ),
    ).toBe(false);
    panel.dispose();
  });
  it("日期双击只通知新建，不创建周期笔记", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { month: "2026-10" });
    root
      .querySelector('[data-date="2026-10-15"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.edit).toHaveBeenCalledWith("2026-10-15");
    expect(host.repository.items()).toHaveLength(1);
    panel.dispose();
  });
  it("自定义番茄钟时长启动，两个面板共享状态且不操作事项", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 记录起始边界或首次请求状态，验证顺序与竞态
    const first = document.createElement("div");
    // 创建第二个独立视图或请求，核对共享状态与资源清理
    const second = document.createElement("div");
    // 挂载首个组件实例，验证状态独立与卸载行为
    const left = new TimerPanel(first, host);
    // 挂载另一个组件实例，验证共享数据仍然刷新
    const right = new TimerPanel(second, host);
    // 创建或读取可操作表单控件，保留尚未提交的输入
    const input = first.querySelector(
      'input[type="number"]',
    ) as HTMLInputElement;
    input.value = "42";
    [...first.querySelectorAll("button")]
      .find((button) => button.textContent === "开始")!
      .click();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.timer.snapshot()).toMatchObject({
      status: "running",
      minutes: 42,
    });
    expect(second.querySelector(".daylane-timer-display")?.textContent).toBe(
      "42:00",
    );
    left.dispose();
    vi.advanceTimersByTime(60_000);
    host.timer.tick();
    expect(second.querySelector(".daylane-timer-display")?.textContent).toBe(
      "41:00",
    );
    expect(host.repository.items()).toHaveLength(1);
    right.dispose();
  });
  it("未知年度明确提示，不以普通周末假装正式假期", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { month: "2030-01" });
    expect(root.textContent).toContain("正式节假日安排未收录");
    expect(root.querySelectorAll(".daylane-holiday")).toHaveLength(0);
    panel.dispose();
  });
  it("切换休息模式立即显示休息默认值，完成后下一轮使用最新默认值", async () => {
    // 使用可更改偏好验证每轮覆盖与默认设置的边界
    const host = await hostFixture();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const preferences = { ...DEFAULTS, lastBatch: [] };
    host.getPreferences = () => preferences;
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new TimerPanel(root, host);
    // 确定本轮专注或休息模式，与事项业务保持独立
    const mode = root.querySelector("select") as HTMLSelectElement;
    // 校验本轮分钟数，允许临时覆盖而不更改默认设置
    const minutes = root.querySelector("input") as HTMLInputElement;
    mode.value = "break";
    mode.dispatchEvent(new Event("change"));
    expect(minutes.value).toBe("5");
    host.timer.start();
    preferences.breakMinutes = 9;
    vi.advanceTimersByTime(300_000);
    host.timer.tick();
    expect(host.timer.snapshot().status).toBe("finished");
    expect(minutes.value).toBe("9");
    panel.dispose();
  });
});
