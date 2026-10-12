import { describe, expect, it, vi } from "vitest";
import { DEFAULTS } from "../src/domain";
import { HolidayService } from "../src/holidays";
import { noteContent, splitNote } from "../src/repository";
import { RolloverService, shouldRoll } from "../src/rollover";
import { fixture } from "./helpers";
/** 累计记录不可清零，入箱不伪造第六次成功改期 */
describe("自然日和工作日累计流转", () => {
  it("第五次成功加到五，第六次只删除日期，正文和文件路径保持", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    await repository.mutate(item, (fields) => {
      fields["daylane-rollover-count"] = 4;
      return true;
    });
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => ({ ...DEFAULTS, rolloverMode: "calendar" }),
    );
    expect((await service.run("2026-10-12")).inbox).toBe(0);
    expect(repository.items()[0]).toMatchObject({
      date: "2026-10-12",
      rolloverCount: 5,
    });
    expect((await service.run("2026-10-13")).inbox).toBe(1);
    expect(repository.inbox()[0]).toMatchObject({
      date: undefined,
      rolloverCount: 5,
      path: item.path,
    });
    expect(await vault.read(item.path)).toContain("完整说明");
    expect((await service.run("2026-10-14")).changed).toBe(0);
  });
  it("重新安排、移到今天和完成都不能清零五次记录", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    await repository.mutate(repository.items()[0], (fields) => {
      fields["daylane-rollover-count"] = 5;
      return true;
    });
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => DEFAULTS,
    );
    await service.moveToToday("2026-10-12");
    expect(repository.items()[0].rolloverCount).toBe(5);
    await service.run("2026-10-13");
    expect(repository.inbox()[0].rolloverCount).toBe(5);
    await repository.schedule(repository.inbox()[0], "2026-10-15");
    await service.completeToday("2026-10-15");
    expect(repository.items()[0]).toMatchObject({
      rolloverCount: 5,
      status: "completed",
    });
  });
  it("离线多天真实只改期一次，重复同日检查不加次数", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => DEFAULTS,
    );
    await service.run("2026-10-16");
    expect(repository.items()[0]).toMatchObject({
      date: "2026-10-16",
      rolloverCount: 1,
    });
    // 记录实际写入数量，验证空检查与重复触发不改动文件
    const writes = vault.updates;
    await service.run("2026-10-16");
    expect(vault.updates).toBe(writes);
  });
  it("周末与调休使用官方规则，未知年度暂缓且不计数", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => DEFAULTS,
    );
    await service.run("2026-10-10");
    expect(repository.items()[0].date).toBe("2026-10-10");
    await service.run("2026-10-11");
    expect(repository.items()[0].date).toBe("2026-10-12");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const count = repository.items()[0].rolloverCount;
    // 记录实际写入数量，验证空检查与重复触发不改动文件
    const writes = vault.updates;
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result = await service.run("2027-01-01");
    expect(result.errors[0]).toContain("未收录");
    expect(repository.items()[0].rolloverCount).toBe(count);
    expect(vault.updates).toBe(writes);
  });
  it("写入回调重新核对外部完成与改期，不能用旧候选覆盖", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.beforeUpdate = (path) => {
      // 分离原始属性与正文，更新时保留用户原有说明
      const note = splitNote(vault.files.get(path)!, vault.parseYaml);
      note.fields["daylane-status"] = "completed";
      vault.files.set(path, noteContent(note.fields, note.body));
    };
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => DEFAULTS,
    );
    expect((await service.run("2026-10-12")).skipped).toBe(1);
    expect(repository.items()[0]).toMatchObject({
      status: "completed",
      rolloverCount: 0,
    });
  });
  it("两条批量命令不触碰未来事项和待办箱", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    await repository.create({ title: "未来", date: "2026-10-15" });
    await repository.create({ title: "箱中" });
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => DEFAULTS,
    );
    expect((await service.moveToToday("2026-10-12")).changed).toBe(1);
    expect((await service.completeToday("2026-10-12")).changed).toBe(1);
    expect(
      repository.items().find((item) => item.title === "未来")?.status,
    ).toBe("open");
    expect(repository.inbox()[0].status).toBe("open");
  });
  it("写入失败不增加次数，同步触发合并成一批", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.failWrite = true;
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new RolloverService(
      repository,
      new HolidayService(),
      () => DEFAULTS,
    );
    // 记录起始边界或首次请求状态，验证顺序与竞态
    const first = service.run("2026-10-12");
    expect(service.run("2026-10-12")).toBe(first);
    expect((await first).errors).toHaveLength(1);
    expect(repository.items()[0].rolloverCount).toBe(0);
  });
  it("完成项、日期缺失和旧格式永不参与自动写入", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    expect(shouldRoll({ ...item, status: "completed" }, "2026-10-12")).toBe(
      false,
    );
    expect(shouldRoll({ ...item, date: undefined }, "2026-10-12")).toBe(false);
    expect(shouldRoll({ ...item, legacy: true }, "2026-10-12")).toBe(false);
  });
});
