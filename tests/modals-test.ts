import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DateModal, ItemModal, ImportModal } from "../src/modals";
import { hostFixture } from "./ui-host";
import { addDays, localDay } from "../src/domain";
/** 迁移摘要由浏览器标准接口提供 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
/** 新建不能重新引入复杂配置 */
describe("名称输入和独立日期选择", () => {
  it("新建只有名称输入和创建按钮，Enter 提交原文", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ItemModal({} as never, host, "2026-10-15");
    modal.onOpen();
    expect(modal.contentEl.querySelectorAll("input")).toHaveLength(1);
    expect(modal.contentEl.querySelectorAll("select")).toHaveLength(0);
    expect(modal.contentEl.querySelectorAll("button")).toHaveLength(1);
    (modal.contentEl.querySelector("input") as HTMLInputElement).value =
      "测试b";
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(
        host.repository.items().find((item) => item.title === "测试b")?.date,
      ).toBe("2026-10-15"),
    );
    expect(await host.repository.port.read("Daylane/Items/测试b.md")).toContain(
      "## 测试b",
    );
  });
  it("空名称失败保留输入，连续提交不能创建重复事项", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ItemModal({} as never, host);
    modal.onOpen();
    // 组织单次事项编辑，成功写入后才关闭表单
    const form = modal.contentEl.querySelector("form")!;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(modal.contentEl.textContent).toContain("名称"),
    );
    expect(host.repository.items()).toHaveLength(1);
    (modal.contentEl.querySelector("input") as HTMLInputElement).value =
      "箱中事项";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(host.repository.inbox()).toHaveLength(1));
  });
  it("手动日期弹窗只有日期，不出现状态和项目字段", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 保存或模拟持久化边界，检查写入成功后再确认完成
    const save = vi.fn(async () => undefined);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new DateModal({} as never, host.repository.items()[0], save);
    modal.onOpen();
    expect(modal.contentEl.querySelectorAll("input")).toHaveLength(1);
    expect(modal.contentEl.querySelectorAll("select")).toHaveLength(0);
    (modal.contentEl.querySelector("input") as HTMLInputElement).value =
      "2026-10-20";
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("2026-10-20"));
  });
  it("迁移先显示原文保护选项，不在打开时写文件", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await hostFixture();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ImportModal({} as never, host, async () => undefined);
    modal.onOpen();
    expect(modal.contentEl.textContent).toContain("备份原文");
    expect(host.repository.items()).toHaveLength(1);
  });
  it("月历点击只修改草稿，跨年浏览不改日期，确认后才保存", async () => {
    // 模拟当前事项，初始安排在年底以验证跨年切换
    const host = await hostFixture();
    // 记录实际保存边界，浏览与选择不能提前持久化
    const save = vi.fn(async () => undefined);
    // 确保年底日期属于未来，避免测试随执行年份失效
    const year = new Date().getFullYear() + 1;
    // 当前弹窗初始日期独立于今天
    const modal = new DateModal(
      {} as never,
      { ...host.repository.items()[0], date: `${year}-12-20` },
      save,
    );
    modal.onOpen();
    // 文本输入不再使用原生分段日期控件
    const input = modal.contentEl.querySelector("input")!;
    expect(input.type).toBe("text");
    modal.contentEl
      .querySelector<HTMLButtonElement>('[aria-label="下个月"]')!
      .click();
    expect(input.value).toBe(`${year}-12-20`);
    expect(modal.contentEl.textContent).toContain(`${year + 1} 年 1 月`);
    modal.contentEl
      .querySelector<HTMLButtonElement>(`[data-date="${year + 1}-01-05"]`)!
      .click();
    expect(input.value).toBe(`${year + 1}-01-05`);
    expect(save).not.toHaveBeenCalled();
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledWith(`${year + 1}-01-05`),
    );
  });
  it("过去日期不能点击，快捷选择同步月历，失败后保留日期以便重试", async () => {
    // 使用真实业务事项构造独立弹窗
    const host = await hostFixture();
    // 模拟保存失败，不丢弃用户已经选择的日期
    const save = vi.fn(async () => {
      throw new Error("保存失败");
    });
    // 从今天开始，确保过去日期状态可验证
    const modal = new DateModal(
      {} as never,
      { ...host.repository.items()[0], date: localDay() },
      save,
    );
    modal.onOpen();
    // 月历中所有过去日期都必须禁用
    const past = [
      ...modal.contentEl.querySelectorAll<HTMLButtonElement>("[data-date]"),
    ].filter((day) => day.dataset.date! < localDay());
    expect(past.every((day) => day.disabled)).toBe(true);
    modal.contentEl
      .querySelector<HTMLButtonElement>(
        ".daylane-date-shortcuts button:nth-child(2)",
      )!
      .click();
    // 明天快捷操作同步文本输入及月历选中标记
    const tomorrow = addDays(localDay(), 1);
    expect(
      modal.contentEl.querySelector<HTMLInputElement>("input")!.value,
    ).toBe(tomorrow);
    expect(
      modal.contentEl.querySelector<HTMLElement>(".is-selected")!.dataset.date,
    ).toBe(tomorrow);
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(modal.contentEl.textContent).toContain("保存失败"),
    );
    expect(
      modal.contentEl.querySelector<HTMLInputElement>("input")!.value,
    ).toBe(tomorrow);
    expect(
      modal.contentEl.querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(false);
  });
});
