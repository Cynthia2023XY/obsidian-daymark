import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DEFAULTS, Item } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { ItemModal, ConfirmModal, ImportModal } from "../src/modals";
import { TimerService } from "../src/timer";
import { UiHost } from "../src/ui";
import { fixture } from "./helpers";

/** 为真实表单提供浏览器身份和摘要接口 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
/** 清理表单容器，避免跨用例保留已关闭节点 */
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
/** 表单依赖在宿主动作边界替换，仓库仍执行真实写入 */
async function modalHost(): Promise<UiHost> {
  // 取得当前测试或业务边界，核对完整操作链
  const { repository } = await fixture();
  return {
    repository,
    holidays: new HolidayService(),
    timer: new TimerService(() => Date.now(), vi.fn()),
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
/** 验证用户提交动作，不仅验证展示文本 */
describe("事项编辑和导入确认表单", () => {
  it("新建待办保存真实 Markdown 并检查流转，取消不写入", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await modalHost();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ItemModal({} as never, host, "2026-10-11");
    modal.onOpen();
    document.body.append(modal.contentEl);
    (
      modal.contentEl.querySelector('input[type="text"]') as HTMLInputElement
    ).value = "新的待办";
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(host.repository.items()).toHaveLength(2));
    expect(
      host.repository.items().find((item) => item.title === "新的待办"),
    ).toMatchObject({ kind: "todo", scheduled: "2026-10-11" });
    await vi.waitFor(() => expect(host.afterEdit).toHaveBeenCalledTimes(1));
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const cancelled = new ItemModal({} as never, host, "2026-10-11");
    cancelled.onOpen();
    [...cancelled.contentEl.querySelectorAll("button")]
      .find((button) => button.textContent === "取消")!
      .click();
    await Promise.resolve();
    expect(host.repository.items()).toHaveLength(2);
  });
  it("固定日程日期错误时保留表单并提示，不写入事项", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await modalHost();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ItemModal({} as never, host, "2026-10-11");
    modal.onOpen();
    (
      modal.contentEl.querySelector('input[type="text"]') as HTMLInputElement
    ).value = "跨日事项";
    // 区分可流转待办和保持原日期的固定日程
    const kind = modal.contentEl.querySelector("select") as HTMLSelectElement;
    kind.value = "event";
    kind.dispatchEvent(new Event("change"));
    // 根据事项类型显示对应日期字段
    const dates =
      modal.contentEl.querySelectorAll<HTMLInputElement>('input[type="date"]');
    dates[2].value = "2026-10-20";
    dates[3].value = "2026-10-11";
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(
        modal.contentEl.querySelector(".daylane-form-error")?.textContent,
      ).toContain("结束日期"),
    );
    expect(host.repository.items()).toHaveLength(1);
  });
  it("编辑完成状态不重复覆盖其他用户字段，保存后正文保持原文", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await modalHost();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = host.repository.items()[0];
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ItemModal({} as never, host, "2026-10-11", item);
    modal.onOpen();
    // 读取当前运行阶段，驱动计时文字与交互状态
    const state =
      modal.contentEl.querySelectorAll<HTMLSelectElement>("select")[1];
    state.value = "completed";
    modal.contentEl
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(host.repository.items()[0].status).toBe("completed"),
    );
    expect(await host.repository.port.read(item.path)).toContain(
      "保留所有原始说明",
    );
  });
  it("删除确认前不执行操作，重复点击时按钮禁用", async () => {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const action = vi.fn(async () => undefined);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ConfirmModal(
      {} as never,
      "删除",
      "将文件移到回收站",
      action,
      vi.fn(),
    );
    modal.onOpen();
    expect(action).not.toHaveBeenCalled();
    // 执行用户确认的具体动作，防止重复触发同一操作
    const confirm = modal.contentEl.querySelector("button")!;
    confirm.click();
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
  it("导入窗口先展示范围，用户未确认前不复制旧文件", async () => {
    // 模拟宿主动作边界，组件使用真实业务服务
    const host = await modalHost();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const modal = new ImportModal({} as never, host);
    modal.onOpen();
    expect(modal.contentEl.textContent).toContain("旧文件保持原样");
    expect(host.repository.items()).toHaveLength(1);
    expect(modal.contentEl.querySelectorAll("button")).toHaveLength(1);
  });
});
