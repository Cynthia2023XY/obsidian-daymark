import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { MigrationService } from "../src/migration";
import { ItemRepository, noteContent, splitNote } from "../src/repository";
import { MemoryVault } from "./helpers";

/** 在内存边界使用真实内容指纹 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
/** 旧数据导入必须复制并保留原文 */
describe("旧 Calendar Plus 事项迁移", () => {
  it("预览不写文件，导入为不流转固定日程并保留正文", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Old/2026/item.md";
    // 保留操作前原文，用于验证不会破坏源内容
    const original = noteContent(
      {
        "calendar-plus-type": "important-event",
        date: "2026-10-11",
        title: "重要上线",
        status: "completed",
        color: "red",
        unknown: "保留",
      },
      "\n完整原文\n",
    );
    vault.files.set(path, original);
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview("Old");
    expect(vault.files.size).toBe(1);
    expect(preview.candidates).toHaveLength(1);
    expect((await service.execute(preview.candidates)).created).toBe(1);
    expect(repository.items()[0]).toMatchObject({
      kind: "event",
      start: "2026-10-11",
      end: "2026-10-11",
      status: "completed",
      rollover: "off",
    });
    expect(vault.files.get(path)).toBe(original);
    // 按来源路径与内容指纹识别重复导入
    const imported = splitNote(
      await vault.read(repository.items()[0].path),
      vault.parseYaml,
    );
    expect(imported.fields.unknown).toBe("保留");
    expect(imported.body).toContain("完整原文");
    expect(imported.fields["calendar-plus-type"]).toBeUndefined();
  });
  it("重复导入与来源文件更名都通过路径或指纹识别", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Old/item.md";
    vault.files.set(
      path,
      noteContent(
        {
          "calendar-plus-type": "important-event",
          date: "2026-10-11",
          title: "重要事项",
          status: "open",
        },
        "正文",
      ),
    );
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview("Old");
    await service.execute(preview.candidates);
    expect((await service.execute(preview.candidates)).created).toBe(0);
    vault.files.set("Old/renamed.md", vault.files.get(path)!);
    vault.files.delete(path);
    expect((await service.preview("Old")).duplicates).toBe(1);
    expect(repository.items()).toHaveLength(1);
  });
  it("预览后源文件改变或内容无效时不会导入猜测数据", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Old/item.md";
    vault.files.set(
      path,
      noteContent(
        {
          "calendar-plus-type": "important-event",
          date: "2026-10-11",
          title: "重要事项",
          status: "open",
        },
        "正文",
      ),
    );
    vault.files.set(
      "Old/bad.md",
      noteContent(
        { "calendar-plus-type": "important-event", date: "错误日期" },
        "坏数据",
      ),
    );
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview("Old");
    expect(preview.errors).toHaveLength(1);
    vault.files.set(path, vault.files.get(path)! + "外部修改");
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result = await service.execute(preview.candidates);
    expect(result.created).toBe(0);
    expect(result.errors[0]).toContain("已改变");
  });
});
