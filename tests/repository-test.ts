import { describe, expect, it } from "vitest";
import { ItemRepository, noteContent, splitNote } from "../src/repository";
import { fixture, MemoryVault, todo } from "./helpers";

/** 存储契约覆盖冷启动、异步竞争与原文保留 */
describe("Markdown 事项仓库", () => {
  it("冷启动直接读取原文并保存正文和未知属性", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    expect(item.title).toBe("整理接口文档");
    await repository.edit(item, { ...item, title: "新的标题" });
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await vault.read(item.path), vault.parseYaml);
    expect(note.fields.custom).toBe("保持原值");
    expect(note.body).toContain("保留所有原始说明");
    expect(repository.items()[0].path).toBe(item.path);
  });
  it("日期流转或标题修改不会重命名文件", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    await repository.edit(item, { ...item, scheduled: "2027-01-01" });
    expect(repository.items()[0].path).toBe(item.path);
    expect(repository.items()[0].originalScheduled).toBe("2026-10-09");
  });
  it("读取失败保留已有索引，恢复重扫可以重试", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.failRead = true;
    await repository.scan();
    expect(repository.items()).toHaveLength(1);
    expect(repository.issues.size).toBe(1);
    vault.failRead = false;
    await repository.scan();
    expect(repository.issues.size).toBe(0);
  });
  it("显式损坏 frontmatter 移出可操作索引并报告问题", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    vault.files.set(item.path, noteContent({ "daylane-schema": 1 }, "坏数据"));
    await repository.refresh(item.path);
    expect(repository.items()).toHaveLength(0);
    expect(repository.issues.size).toBe(1);
  });
  it("较早的读取结果不能覆盖最新修改", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    // 保留操作前原文，用于验证不会破坏源内容
    const original = await vault.read(item.path);
    // 显式释放延迟读取，验证旧结果不能覆盖新事实
    let release!: (content: string) => void;
    // 控制异步读取返回顺序，复现冷启动与删除竞态
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    // 保存原始读取边界，模拟部分请求延迟
    const read = vault.read.bind(vault);
    // 记录起始边界或首次请求状态，验证顺序与竞态
    let first = true;
    vault.read = (path) => {
      if (first) {
        first = false;
        return pending;
      }
      return read(path);
    };
    // 保留较早读取任务，验证最新请求优先
    const oldRead = repository.refresh(item.path);
    vault.files.set(
      item.path,
      original.replace("整理接口文档", "同步后的标题"),
    );
    await repository.refresh(item.path);
    release(original);
    await oldRead;
    expect(repository.items()[0].title).toBe("同步后的标题");
  });
  it("删除目录立即使全部待返回读取失效", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    // 保留操作前原文，用于验证不会破坏源内容
    const original = await vault.read(item.path);
    // 显式释放延迟读取，验证旧结果不能覆盖新事实
    let release!: (content: string) => void;
    vault.read = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    // 控制异步读取返回顺序，复现冷启动与删除竞态
    const pending = repository.refresh(item.path);
    repository.remove("Daylane/Items/2026");
    release(original);
    await pending;
    expect(repository.items()).toHaveLength(0);
  });
  it("文件更名后只保留新路径，身份保持稳定", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    // 计算后续日期或新路径，不沿用已失效的状态
    const next = "Daylane/Items/2026/renamed.md";
    vault.files.set(next, vault.files.get(item.path)!);
    vault.files.delete(item.path);
    repository.remove(item.path);
    await repository.scan();
    expect(repository.items()).toHaveLength(1);
    expect(repository.items()[0]).toMatchObject({ id: item.id, path: next });
  });
  it("重复 ID 明确报告，任何副本不能被静默改写", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    vault.files.set("Daylane/Items/2026/copy.md", await vault.read(item.path));
    await repository.scan();
    expect(repository.conflicts()).toHaveLength(1);
    await expect(repository.status(item, "completed")).rejects.toThrow("冲突");
  });
  it("回收失败保留文件与索引，旧表单不覆盖最新版本", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    vault.failWrite = true;
    await expect(repository.trash(item)).rejects.toThrow();
    expect(repository.items()).toHaveLength(1);
    vault.failWrite = false;
    await repository.status(item, "completed");
    await expect(
      repository.edit(item, { ...item, title: "旧表单" }),
    ).rejects.toThrow("已修改");
  });
  it("目录范围严格，创建新笔记独立于同名普通笔记", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    vault.files.set("Elsewhere/test.md", "普通笔记");
    await repository.scan();
    // 记录成功创建数量或对象，不将失败项计为完成
    const created = await repository.create(todo(), "原始正文");
    expect(created.path).toMatch(/^Daylane\/Items\/\d{4}\//);
    expect(created.originalScheduled).toBe("2026-10-09");
    expect(vault.files.get("Elsewhere/test.md")).toBe("普通笔记");
    repository.dispose();
    await repository.refresh(created.path);
  });
  it("外部编辑未更新时间戳时旧表单仍然不能覆盖标题", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    vault.beforeUpdate = (path) => {
      // 分离原始属性与正文，更新时保留用户原有说明
      const note = splitNote(vault.files.get(path)!, vault.parseYaml);
      note.fields.title = "外部修改后的标题";
      vault.files.set(path, noteContent(note.fields, note.body));
    };
    await expect(
      repository.edit(item, { ...item, title: "旧标题" }),
    ).rejects.toThrow("已修改");
    expect(
      splitNote(await vault.read(item.path), vault.parseYaml).fields.title,
    ).toBe("外部修改后的标题");
  });
});
