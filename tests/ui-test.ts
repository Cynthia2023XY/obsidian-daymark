import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { TimerService } from "../src/timer";
import { CalendarPanel, TimerPanel, UiHost } from "../src/ui";
import { hostFixture } from "./ui-host";
/** 本地日期固定，不让分批 I/O 的让步计时器挂起 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 10));
});
/** 卸载测试模拟 */
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});
/** 参考样式的交互契约，不使用视觉快照模拟成功 */
describe("红点月历和单日事项列表", () => {
  it("保留宿主滚动类，完成项折叠后仍可展开且新增入口可用", async () => {
    // 真实仓库承载当天未完成与已完成事项
    const host = await hostFixture();
    await host.repository.schedule(host.repository.items()[0], "2026-10-12");
    await host.repository.create({
      title: "已完成重点",
      date: "2026-10-12",
      status: "completed",
    });
    // 宿主负责通过 view-content 设置可滚动的内容区
    const root = document.createElement("div");
    root.className = "view-content custom-host-class";
    // 挂载后每次刷新都必须保留宿主样式
    const panel = new CalendarPanel(root, host, { compact: true });
    expect(root.classList.contains("view-content")).toBe(true);
    expect(root.classList.contains("custom-host-class")).toBe(true);
    expect(root.querySelector(".daylane-completed-group")).toBeNull();
    expect(root.querySelector(".daylane-inbox-link")?.parentElement).toBe(
      root.querySelector(".daylane-completed-toggle")?.parentElement,
    );
    (
      root.querySelector(".daylane-completed-toggle") as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
      expect(root.querySelector(".daylane-completed-group")).not.toBeNull(),
    );
    // 原生 details 的关闭状态隐藏完成行，未完成行留在普通列表
    const group = root.querySelector(
      ".daylane-completed-group",
    ) as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.querySelector("summary")?.textContent).toBe("已完成（1）");
    expect(group.querySelectorAll(".is-completed")).toHaveLength(1);
    expect(
      root.querySelector(".daylane-items")?.querySelectorAll(".daylane-item"),
    ).toHaveLength(1);
    expect(root.classList.contains("view-content")).toBe(true);
    (root.querySelector(".daylane-add") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(host.create).toHaveBeenCalledWith("2026-10-12"),
    );
    // 数据刷新沿用折叠模式，并更新完成事项的数量
    await host.repository.status(
      host.repository.items().find((item) => item.status === "open")!,
      "completed",
    );
    expect(
      root.querySelector(".daylane-completed-group summary")?.textContent,
    ).toBe("已完成（2）");
    (
      root.querySelector(".daylane-completed-toggle") as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
      expect(root.querySelector(".daylane-completed-group")).toBeNull(),
    );
    expect(root.querySelectorAll(".daylane-item")).toHaveLength(2);
    panel.dispose();
  });
  it("折叠模式在待办箱中沿用，其他实例和只读日历独立", async () => {
    // 无日期事项用于验证待办箱同样支持折叠
    const host = await hostFixture();
    await host.repository.create({
      title: "完成的入箱项",
      status: "completed",
    });
    // 首个日历切换模式，第二个只读实例不受影响
    const root = document.createElement("div");
    // 只读仅限制写入，不限制折叠查看
    const readonlyRoot = document.createElement("div");
    // 交互日历实例保存自己的折叠状态
    const panel = new CalendarPanel(root, host);
    // 独立只读实例默认展开
    const readonlyPanel = new CalendarPanel(readonlyRoot, host, {
      interactive: false,
      inbox: true,
    });
    (
      root.querySelector(".daylane-completed-toggle") as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
      expect(
        root
          .querySelector(".daylane-completed-toggle")
          ?.getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(root.querySelector(".daylane-completed-group")).toBeNull();
    (root.querySelector(".daylane-inbox-link") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(
        root.querySelector(".daylane-completed-group summary")?.textContent,
      ).toBe("已完成（1）"),
    );
    expect(readonlyRoot.querySelector(".daylane-completed-group")).toBeNull();
    expect(readonlyRoot.querySelector(".daylane-add")).toBeNull();
    (
      readonlyRoot.querySelector(
        ".daylane-completed-toggle",
      ) as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
      expect(
        readonlyRoot.querySelector(".daylane-completed-group"),
      ).not.toBeNull(),
    );
    panel.dispose();
    readonlyPanel.dispose();
  });

  it("高亮行与蓝点同步更新，同日多条高亮只显示一个蓝点", async () => {
    // 当前日期同时安排普通事项与高亮事项
    const host = await hostFixture();
    await host.repository.schedule(host.repository.items()[0], "2026-10-12");
    // 第二条事项用于验证同日圆点不会按事项重复
    const second = await host.repository.create({
      title: "重点事项",
      date: "2026-10-12",
    });
    // 挂载可交互和只读两个日历，验证共享变化通知
    const root = document.createElement("div");
    // 只读日历也应展示高亮样式
    const readonlyRoot = document.createElement("div");
    // 交互日历订阅同一仓库
    const panel = new CalendarPanel(root, host);
    // 只读日历仅禁用编辑操作
    const readonlyPanel = new CalendarPanel(readonlyRoot, host, {
      interactive: false,
    });
    expect(root.querySelector(".daylane-highlight-dot")).toBeNull();
    await host.repository.highlight(host.repository.items()[0], true);
    await host.repository.highlight(second, true);
    expect(root.querySelectorAll(".daylane-item.is-highlighted")).toHaveLength(
      2,
    );
    expect(
      readonlyRoot.querySelectorAll(".daylane-item.is-highlighted"),
    ).toHaveLength(2);
    expect(
      root.querySelectorAll(
        '[data-date="2026-10-12"] .daylane-dots .daylane-dot',
      ),
    ).toHaveLength(2);
    await host.repository.highlight(host.repository.items()[0], false);
    expect(root.querySelectorAll(".daylane-highlight-dot")).toHaveLength(1);
    await host.repository.highlight(second, false);
    expect(root.querySelector(".daylane-highlight-dot")).toBeNull();
    expect(
      root.querySelectorAll('[data-date="2026-10-12"] .daylane-dot'),
    ).toHaveLength(1);
    expect(root.querySelector(".daylane-item.is-highlighted")).toBeNull();
    panel.dispose();
    readonlyPanel.dispose();
  });
  it("格子只有红点和休班，不显示任务卡片；所有状态可见", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    await host.repository.create({
      title: "完成项",
      date: "2026-10-12",
      status: "completed",
    });
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { month: "2026-10" });
    expect(root.querySelectorAll(".daylane-day")).toHaveLength(42);
    expect(
      root.querySelector('[data-date="2026-10-10"]')?.textContent,
    ).toContain("班");
    expect(
      root.querySelector('[data-date="2026-10-01"]')?.textContent,
    ).toContain("休");
    expect(
      root.querySelector('[data-date="2026-10-12"] .daylane-dot'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-date="2026-10-12"]')?.textContent,
    ).not.toContain("完成项");
    expect(root.querySelector(".daylane-items")?.textContent).toContain(
      "完成项",
    );
    expect(root.querySelector(".daylane-item-title")?.textContent).toBe(
      "完成项",
    );
    panel.dispose();
  });
  it("单击选择、双击或添加调用名称弹窗，点击标题只打开文档", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { month: "2026-10" });
    (
      root.querySelector('[data-date="2026-10-09"]') as HTMLButtonElement
    ).click();
    expect(root.querySelector(".daylane-items")?.textContent).toContain(
      "整理接口文档",
    );
    (root.querySelector(".daylane-item-title") as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.open).toHaveBeenCalled();
    root
      .querySelector('[data-date="2026-10-15"]')!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(host.create).toHaveBeenCalledWith("2026-10-15");
    panel.dispose();
  });
  it("右键触发宿主面板，列表不添加常驻改期按钮", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    await host.repository.schedule(host.repository.items()[0], "2026-10-12");
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host);
    root
      .querySelector(".daylane-item")!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    expect(host.context).toHaveBeenCalled();
    expect(root.textContent).not.toContain("移到明天");
    expect(
      root.querySelector(".daylane-item")?.querySelectorAll("button"),
    ).toHaveLength(2);
    panel.dispose();
  });
  it("待办箱在同面板切换，完成项不被隐藏", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    await host.repository.create({ title: "暂缓事项", status: "completed" });
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host);
    (root.querySelector(".daylane-inbox-link") as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelectorAll(".daylane-day")).toHaveLength(0);
    expect(root.textContent).toContain("暂缓事项");
    expect(root.textContent).toContain("返回日历");
    panel.dispose();
  });
  it("多个实例月份独立且卸载后不会复活", async () => {
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
      first.querySelector(".daylane-month-heading")?.textContent,
    ).toContain("9月");
    expect(
      second.querySelector(".daylane-month-heading")?.textContent,
    ).toContain("10月");
    left.dispose();
    host.repository.changes.emit();
    expect(first.childElementCount).toBe(0);
    right.dispose();
  });
  it("只读代码块禁用复选与删除，新输入不能注入 HTML", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    await host.repository.create({
      title: "<img onerror=x>",
      date: "2026-10-12",
    });
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new CalendarPanel(root, host, { interactive: false });
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".daylane-delete")).toBeNull();
    expect(root.querySelector(".daylane-add")).toBeNull();
    panel.dispose();
  });
  it("自定义计时和休息默认值，关闭面板不停止计时", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 创建第二个独立视图或请求，核对共享状态与资源清理
    const second = document.createElement("div");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const panel = new TimerPanel(root, host);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const other = new TimerPanel(second, host);
    (root.querySelector("input") as HTMLInputElement).value = "37";
    [...root.querySelectorAll("button")]
      .find((button) => button.textContent === "开始")!
      .click();
    await Promise.resolve();
    await Promise.resolve();
    expect(host.timer.snapshot()).toMatchObject({
      status: "running",
      minutes: 37,
    });
    panel.dispose();
    expect(host.timer.snapshot().status).toBe("running");
    // 确定本轮专注或休息模式，与事项业务保持独立
    const mode = second.querySelector("select")!;
    mode.value = "break";
    mode.dispatchEvent(new Event("change"));
    expect((second.querySelector("input") as HTMLInputElement).value).toBe("5");
    other.dispose();
  });
});
