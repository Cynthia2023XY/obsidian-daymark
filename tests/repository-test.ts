import { describe, expect, it } from "vitest";
import { ItemRepository, noteContent, splitNote } from "../src/repository";
import { fixture, MemoryVault, todo } from "./helpers";
/** 原文保留、范围识别、文件名与已知异步竞态 */
describe("单日文档仓库", () => {
  it("高亮持久化且完成改期入箱均保留，取消或移除身份清理标记", async () => {
    // 使用真实仓库操作验证专属属性和原文保护
    const { repository, vault } = await fixture();
    // 保存目标路径，后续每次读取最新事项状态
    const path = repository.items()[0].path;
    expect(repository.items()[0].highlighted).toBe(false);
    await repository.highlight(repository.items()[0], true);
    await repository.scan();
    expect(repository.items()[0].highlighted).toBe(true);
    await repository.status(repository.items()[0], "completed");
    await repository.schedule(repository.items()[0], "2026-10-15");
    await repository.schedule(repository.items()[0]);
    expect(repository.inbox()[0].highlighted).toBe(true);
    expect(
      splitNote(await vault.read(path), vault.parseYaml).fields.custom,
    ).toBe("保留");
    expect(await vault.read(path)).toContain("完整说明");
    await repository.highlight(repository.items()[0], false);
    expect(repository.items()[0].highlighted).toBe(false);
    expect(
      splitNote(await vault.read(path), vault.parseYaml).fields,
    ).not.toHaveProperty("daylane-highlighted");
    await repository.highlight(repository.items()[0], true);
    await repository.removeItem(repository.items()[0], true);
    expect(
      splitNote(await vault.read(path), vault.parseYaml).fields,
    ).not.toHaveProperty("daylane-highlighted");
  });
  it("普通同名文档保持原文，新建使用数字且正文为二级标题", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.files.set("Daylane/Items/测试b.md", "普通文档");
    // 记录起始边界或首次请求状态，验证顺序与竞态
    const first = await repository.create({ ...todo(), title: "测试b" });
    // 创建第二个独立视图或请求，核对共享状态与资源清理
    const second = await repository.create({ ...todo(), title: "测试b" });
    expect(first.path).toBe("Daylane/Items/测试b 1.md");
    expect(second.path).toBe("Daylane/Items/测试b 2.md");
    expect(vault.files.get("Daylane/Items/测试b.md")).toBe("普通文档");
    expect(await vault.read(first.path)).toContain("## 测试b");
    expect(
      Object.keys(
        splitNote(await vault.read(first.path), vault.parseYaml).fields,
      ),
    ).toHaveLength(4);
  });
  it("无重名直接用标题；文件夹占名及同步抢占同样处理", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.folders.add("Daylane/Items/文件夹.md");
    expect((await repository.create({ ...todo(), title: "文件夹" })).path).toBe(
      "Daylane/Items/文件夹 1.md",
    );
    vault.beforeCreate = (path) => {
      vault.beforeCreate = undefined;
      vault.files.set(path, "同步占名");
    };
    expect((await repository.create({ ...todo(), title: "冲突" })).path).toBe(
      "Daylane/Items/冲突 1.md",
    );
    expect(vault.files.get("Daylane/Items/冲突.md")).toBe("同步占名");
  });
  it("I/O 失败不冒充重名无限重试", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.failWrite = true;
    await expect(repository.create(todo())).rejects.toThrow("写入失败");
  });
  it("手动改期、完成、入箱均保留累计次数和正文", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    await repository.mutate(item, (fields) => {
      fields["daylane-rollover-count"] = 5;
      return true;
    });
    await repository.schedule(repository.items()[0], "2026-10-15");
    await repository.status(repository.items()[0], "completed");
    await repository.schedule(repository.items()[0]);
    expect(repository.inbox()[0]).toMatchObject({
      status: "completed",
      rolloverCount: 5,
    });
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await vault.read(item.path), vault.parseYaml);
    expect(note.body).toContain("完整说明");
    expect(note.fields.custom).toBe("保留");
  });
  it("文件重命名只更新目标索引且不丢失身份，正文标题不参与识别", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const old = repository.items()[0].path;
    vault.files.set(
      "Daylane/Items/新标题.md",
      (await vault.read(old)).replace("## 原文", "## 正文修改"),
    );
    vault.files.delete(old);
    await repository.renamed("Daylane/Items/新标题.md", old);
    expect(repository.items()).toHaveLength(1);
    expect(repository.items()[0].title).toBe("新标题");
    await repository.renamed("Other/新标题.md", "Daylane/Items/新标题.md");
    expect(repository.items()).toHaveLength(0);
  });
  it("目录外标记默认不读取，开启全库仍不把普通文档当成事项", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.files.set(
      "Other/事项.md",
      noteContent({ "daylane-type": "important-event" }, "正文"),
    );
    vault.files.set("Other/普通.md", "普通笔记");
    await repository.scan();
    expect(repository.items()).toHaveLength(1);
    await repository.configure("Daylane/Items", false);
    expect(repository.items()).toHaveLength(2);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const reads = vault.readCount;
    await repository.renamed("Other/事项.md", "Other/旧名称.md");
    expect(vault.readCount - reads).toBe(1);
  });
  it("较早读取不能覆盖最新修改，删除目录使旧读取失效", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = repository.items()[0].path;
    // 保留操作前原文，用于验证不会破坏源内容
    const original = await vault.read(path);
    // 显式释放延迟读取，验证旧结果不能覆盖新事实
    let release!: (value: string) => void;
    // 记录起始边界或首次请求状态，验证顺序与竞态
    const first = new Promise<string>((resolve) => {
      release = resolve;
    });
    // 保存原始读取边界，模拟部分请求延迟
    const read = vault.read.bind(vault);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    let delayed = true;
    vault.read = (target) => {
      if (delayed) {
        delayed = false;
        return first;
      }
      return read(target);
    };
    // 控制异步读取返回顺序，复现冷启动与删除竞态
    const pending = repository.refresh(path);
    vault.files.set(path, original.replace('"open"', '"completed"'));
    await repository.refresh(path);
    release(original);
    await pending;
    expect(repository.items()[0].status).toBe("completed");
    vault.read = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const deleted = repository.refresh(path);
    repository.remove("Daylane/Items");
    release(original);
    await deleted;
    expect(repository.items()).toHaveLength(0);
  });
  it("读取失败保留旧索引，明确结构错误移出索引", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    vault.failRead = true;
    await repository.scan();
    expect(repository.items()).toHaveLength(1);
    vault.failRead = false;
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = repository.items()[0].path;
    vault.files.set(
      path,
      noteContent(
        { "daylane-type": "important-event", "daylane-date": "bad" },
        "原文",
      ),
    );
    await repository.refresh(path);
    expect(repository.items()).toHaveLength(0);
    expect(repository.issues.size).toBe(1);
  });
  it("保留文档删除只移除四项，不影响通用 YAML 与正文", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    await repository.removeItem(item, true);
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await vault.read(item.path), vault.parseYaml);
    expect(note.fields).toEqual({
      custom: "保留",
      "date created": "原创建时间",
    });
    expect(note.body).toContain("完整说明");
    expect(repository.items()).toHaveLength(0);
  });
  it("默认回收失败保持索引，成功后文档和索引一起移除", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { repository, vault } = await fixture();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = repository.items()[0];
    vault.failWrite = true;
    await expect(repository.removeItem(item, false)).rejects.toThrow();
    expect(repository.items()).toHaveLength(1);
    vault.failWrite = false;
    await repository.removeItem(item, false);
    expect(repository.items()).toHaveLength(0);
    expect(vault.exists(item.path)).toBe(false);
  });
  it("全库首次扫描分批完成，删除普通文件不触发全量读取", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (let index = 0; index < 50; index++)
      vault.files.set("Any/" + index + ".md", "普通文档");
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items", false);
    await repository.scan();
    expect(repository.progress).toEqual({
      active: false,
      completed: 50,
      total: 50,
    });
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const reads = vault.readCount;
    repository.remove("Any/0.md");
    expect(vault.readCount).toBe(reads);
    repository.dispose();
  });
  it("全库扫描最多十六个并发读取，进度不会逐文件重绘", async () => {
    // 构造超过一批的原文，观察实际文件边界并发
    const vault = new MemoryVault();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (let index = 0; index < 64; index++)
      vault.files.set("Other/" + index + ".md", "普通文档");
    // 读取仅延迟到下一微任务，能够测量同批并发
    const original = vault.read.bind(vault);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    let active = 0;
    // 保存当前处理阶段的事实结果，供后续校验与展示
    let maximum = 0;
    vault.read = async (path) => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      // 保留文件原文，用于解析、指纹校验与正文完整性检查
      const content = await original(path);
      active--;
      return content;
    };
    // 进度只在批次边界发布，不做六十四次完整月历重建
    const repository = new ItemRepository(vault, "Daylane/Items", false);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    let renders = 0;
    repository.changes.subscribe(() => {
      renders++;
    });
    await repository.scan();
    expect(maximum).toBeLessThanOrEqual(16);
    expect(renders).toBeLessThanOrEqual(4);
  });
});
