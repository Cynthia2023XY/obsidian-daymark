import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { MigrationService } from "../src/migration";
import { ItemRepository, noteContent, splitNote } from "../src/repository";
import { MemoryVault } from "./helpers";
/** 摘要边界使用公开浏览器算法 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});
/** 迁移先备份，未知属性与正文不能被清理 */
describe("旧格式原地迁移", () => {
  it("只读预览，执行先备份，再保留正文和其他笔记元信息", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Daylane/Items/旧事项.md";
    // 保留操作前原文，用于验证不会破坏源内容
    const original = noteContent(
      {
        "calendar-plus-type": "important-event",
        date: "2026-10-12",
        status: "open",
        title: "旧事项",
        color: "red",
        "date created": "原时间",
        tags: ["日记"],
      },
      "\n## 原始细节\n保留原文",
    );
    vault.files.set(path, original);
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    await repository.scan();
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview();
    expect(vault.files.get(path)).toBe(original);
    expect(vault.backups.size).toBe(0);
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result = await service.execute([
      { candidate: preview.candidates[0], date: "2026-10-12", status: "open" },
    ]);
    expect(result.changed).toBe(1);
    expect(vault.backups.size).toBe(1);
    expect(JSON.parse([...vault.backups.values()][0]).content).toBe(original);
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await vault.read(path), vault.parseYaml);
    expect(note.fields.color).toBeUndefined();
    expect(note.fields["date created"]).toBe("原时间");
    expect(note.fields.tags).toEqual(["日记"]);
    expect(note.body).toContain("保留原文");
    expect(repository.items()[0].legacy).toBe(false);
    expect((await service.preview()).candidates).toHaveLength(0);
  });
  it("跨日和取消状态必须明确选择，不自动猜测状态", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Daylane/Items/复杂.md";
    vault.files.set(
      path,
      noteContent(
        {
          "daylane-schema": 1,
          "daylane-kind": "event",
          status: "cancelled",
          start: "2026-10-12",
          end: "2026-10-20",
          "rollover-count": 5,
        },
        "细节",
      ),
    );
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview();
    expect(preview.candidates[0]).toMatchObject({
      date: undefined,
      status: undefined,
    });
    expect(preview.candidates[0].reason).toContain("跨日");
    await service.execute([
      { candidate: preview.candidates[0], status: "open" },
    ]);
    expect(repository.inbox()[0].rolloverCount).toBe(5);
  });
  it("预览后外部修改或备份失败不改原文", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Daylane/Items/旧.md";
    vault.files.set(
      path,
      noteContent(
        {
          "calendar-plus-type": "important-event",
          status: "open",
          date: "2026-10-12",
        },
        "细节",
      ),
    );
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview();
    vault.files.set(path, vault.files.get(path)! + "\n外部修改");
    expect(
      (
        await service.execute([
          {
            candidate: preview.candidates[0],
            date: "2026-10-12",
            status: "open",
          },
        ])
      ).errors[0],
    ).toContain("已改变");
    expect(vault.backups.size).toBe(0);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const latest = await service.preview();
    vault.backup = async () => {
      throw new Error("备份失败");
    };
    expect(
      (
        await service.execute([
          {
            candidate: latest.candidates[0],
            date: "2026-10-12",
            status: "open",
          },
        ])
      ).errors[0],
    ).toContain("备份失败");
    expect(vault.files.get(path)).toContain("calendar-plus-type");
  });
  it("只规范可验证随机后缀及原生成标题，重名使用数字", async () => {
    // 模拟公开文件边界，业务实现无需加入测试分支
    const vault = new MemoryVault();
    // 使用明确的 Vault 相对路径，定位本次读写对象
    const path = "Daylane/Items/测试b-12345678.md";
    vault.files.set(
      path,
      noteContent(
        {
          "daylane-schema": 1,
          "daylane-id": "12345678-abcd",
          "daylane-kind": "todo",
          title: "测试b",
          status: "open",
          scheduled: "2026-10-12",
          "rollover-count": 3,
        },
        "\n# 测试b\n\n# 用户自写的其他标题\n",
      ),
    );
    vault.files.set("Daylane/Items/测试b.md", "普通文档");
    // 提供 Markdown 事实仓库，验证索引与写入契约
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = await service.preview();
    await service.execute(
      [
        {
          candidate: preview.candidates[0],
          date: "2026-10-12",
          status: "open",
        },
      ],
      true,
      true,
    );
    expect(vault.files.get("Daylane/Items/测试b 1.md")).toContain("## 测试b");
    expect(vault.files.get("Daylane/Items/测试b 1.md")).toContain(
      "# 用户自写的其他标题",
    );
    expect(vault.files.get("Daylane/Items/测试b.md")).toBe("普通文档");
    expect(repository.items()[0].rolloverCount).toBe(3);
  });
  it("全库根目录旧事项规范文件名保持相对路径", async () => {
    // 在库根目录模拟可验证的旧版随机后缀
    const vault = new MemoryVault();
    // 根目录路径不包含斜杠
    const path = "测试b-12345678.md";
    vault.files.set(
      path,
      noteContent(
        {
          "daylane-schema": 1,
          "daylane-id": "12345678-abcd",
          "daylane-kind": "todo",
          title: "测试b",
          scheduled: "2026-10-12",
          status: "open",
        },
        "\n# 测试b\n",
      ),
    );
    // 关闭目录限制后仍通过事项标签识别文件
    const repository = new ItemRepository(vault, "Daylane/Items", false);
    // 迁移沿用原始目录位置
    const service = new MigrationService(repository);
    // 执行前取得原文快照
    const preview = await service.preview();
    // 迁移并选择规范旧文件名
    const result = await service.execute(
      [
        {
          candidate: preview.candidates[0],
          date: "2026-10-12",
          status: "open",
        },
      ],
      true,
      true,
    );
    expect(result.errors).toEqual([]);
    expect(vault.files.has("测试b.md")).toBe(true);
    expect(repository.items()[0].path).toBe("测试b.md");
  });
  it("属性转换成功但重命名失败时如实报告部分结果", async () => {
    // 模拟可迁移的旧版文件
    const vault = new MemoryVault();
    // 文件名与旧 ID 对应才允许规范
    const path = "Daylane/Items/测试b-12345678.md";
    vault.files.set(
      path,
      noteContent(
        {
          "daylane-schema": 1,
          "daylane-id": "12345678-abcd",
          "daylane-kind": "todo",
          title: "测试b",
          scheduled: "2026-10-12",
          status: "open",
        },
        "\n# 测试b\n",
      ),
    );
    vault.rename = async () => {
      throw new Error("重命名失败");
    };
    // 转换后的事项仍须出现在索引中
    const repository = new ItemRepository(vault, "Daylane/Items");
    // 通过迁移服务区分属性转换与文件更名结果
    const service = new MigrationService(repository);
    // 写入前生成可核验候选
    const preview = await service.preview();
    // 部分失败不得误报零项转换
    const result = await service.execute(
      [
        {
          candidate: preview.candidates[0],
          date: "2026-10-12",
          status: "open",
        },
      ],
      true,
      true,
    );
    expect(result.changed).toBe(1);
    expect(result.errors[0]).toContain("重命名失败");
    expect(vault.backups.size).toBe(1);
    expect(repository.items()[0].legacy).toBe(false);
  });
});
