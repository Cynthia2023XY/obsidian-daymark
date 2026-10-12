import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DateModal, ItemModal, ImportModal } from "../src/modals";
import { hostFixture } from "./ui-host";
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
});
