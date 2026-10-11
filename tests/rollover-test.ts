import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { DEFAULTS, Preferences } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { noteContent, splitNote } from "../src/repository";
import { RolloverService, shouldRoll } from "../src/rollover";
import { fixture } from "./helpers";

/** 使用真实摘要接口覆盖撤回完整文件校验 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
/** 用稳定日期验证自动写入边界，避免只测试实现内部字段 */
describe("待办流转与安全撤回", () => {
  it("默认关闭，仅单条 auto 可覆盖，固定日程与今天待办不流转", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    expect(shouldRoll(item, "2026-10-11", DEFAULTS)).toBe(false);
    expect(
      shouldRoll({ ...item, rollover: "auto" }, "2026-10-11", DEFAULTS),
    ).toBe(true);
    expect(
      shouldRoll(
        { ...item, rollover: "auto", kind: "event" },
        "2026-10-11",
        DEFAULTS,
      ),
    ).toBe(false);
    expect(
      shouldRoll(
        { ...item, rollover: "auto", scheduled: "2026-10-11" },
        "2026-10-11",
        DEFAULTS,
      ),
    ).toBe(false);
    expect(
      shouldRoll(
        { ...item, rollover: "auto", status: "completed" },
        "2026-10-11",
        DEFAULTS,
      ),
    ).toBe(false);
  });
  it("离线多天直接补到今天，只增加一次且不改变截止日期", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    // 保存或模拟持久化边界，检查写入成功后再确认完成
    const save = vi.fn(async () => undefined);
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      save,
    );
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result = await service.run(false, "2026-10-16");
    expect(result.changed).toBe(1);
    expect(repository.items()[0]).toMatchObject({
      scheduled: "2026-10-16",
      originalScheduled: "2026-10-09",
      deadline: "2026-10-10",
      rolloverCount: 1,
    });
    // 记录实际写入数量，验证空检查与重复触发不改动文件
    const writes = vault.updates;
    await service.run(false, "2026-10-16");
    expect(vault.updates).toBe(writes);
    expect(settings.lastBatch).toHaveLength(1);
    expect(save).toHaveBeenCalled();
  });
  it("工作日模式跳过普通周末，缺失年度不写入", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      rolloverMode: "workday",
      lastBatch: [],
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    expect((await service.run(false, "2026-10-11")).changed).toBe(1);
    expect(repository.items()[0].scheduled).toBe("2026-10-12");
    // 记录实际写入数量，验证空检查与重复触发不改动文件
    const writes = vault.updates;
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result = await service.run(false, "2027-01-01");
    expect(result.errors[0]).toContain("未收录");
    expect(vault.updates).toBe(writes);
  });
  it("写入时重新核对完成状态，不覆盖候选扫描后的外部完成", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    vault.beforeUpdate = (path) => {
      // 分离原始属性与正文，更新时保留用户原有说明
      const note = splitNote(vault.files.get(path)!, vault.parseYaml);
      note.fields.status = "completed";
      vault.files.set(path, noteContent(note.fields, note.body));
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    expect((await service.run(false, "2026-10-11")).skipped).toBe(1);
    expect(repository.items()[0]).toMatchObject({
      status: "completed",
      scheduled: "2026-10-09",
    });
  });
  it("完成和关闭单条流转的事项不被自动移动，手动仍可改期", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    await repository.edit(item, { ...item, rollover: "off" });
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    expect((await service.run(false, "2026-10-11")).changed).toBe(0);
    expect((await service.run(true, "2026-10-11")).changed).toBe(1);
  });
  it("恢复服务实例后仍可撤回，正文和截止日期不改变", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    await new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    ).run(false, "2026-10-11");
    // 模拟重启后的持久化记录，验证恢复边界
    const restored = structuredClone(settings);
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => restored,
      async () => undefined,
    );
    expect((await service.undo()).changed).toBe(1);
    expect(repository.items()[0]).toMatchObject({
      scheduled: "2026-10-09",
      rolloverCount: 0,
      deadline: "2026-10-10",
    });
    expect(await vault.read(repository.items()[0].path)).toContain(
      "保留所有原始说明",
    );
  });
  it("流转后有外部正文更改时撤回必须跳过", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    await service.run(false, "2026-10-11");
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    vault.files.set(item.path, (await vault.read(item.path)) + "外部新说明\n");
    expect((await service.undo()).skipped).toBe(1);
    expect(repository.items()[0].scheduled).toBe("2026-10-11");
  });
  it("写入和恢复日志失败有明确出口，不伪报成功", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    vault.failWrite = true;
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    expect((await service.run(false, "2026-10-11")).errors[0]).toContain(
      "写入失败",
    );
    expect(repository.items()[0].scheduled).toBe("2026-10-09");
    vault.failWrite = false;
    // 模拟恢复日志保存失败，验证未写入时不伪报成功
    const failedJournal = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => {
        throw new Error("恢复日志保存失败");
      },
    );
    expect((await failedJournal.run(false, "2026-10-11")).changed).toBe(0);
    expect(repository.items()[0].scheduled).toBe("2026-10-09");
  });
  it("启动与前台同时检查只处理一批", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    // 记录起始边界或首次请求状态，验证顺序与竞态
    const first = service.run(false, "2026-10-11");
    // 创建第二个独立视图或请求，核对共享状态与资源清理
    const second = service.run(false, "2026-10-11");
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(repository.items()[0].rolloverCount).toBe(1);
  });
  it("新一批全部写入失败时保留上一批可撤回记录", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings: Preferences = {
      ...DEFAULTS,
      autoRollover: true,
      lastBatch: [],
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => settings,
      async () => undefined,
    );
    await service.run(false, "2026-10-11");
    // 保存修改前的事实快照，失败时恢复或验证变化边界
    const previous = structuredClone(settings.lastBatch);
    vault.failWrite = true;
    await service.run(false, "2026-10-12");
    expect(settings.lastBatch).toEqual(previous);
    vault.failWrite = false;
    expect((await service.undo()).changed).toBe(1);
  });
});
