import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { MemoryVault } from "./helpers";
import { noteContent } from "../src/repository";
import { notices, Plugin, TFile } from "./obsidian-mock";

/** 测试配置在 Obsidian 模块边界替换宿主，生产入口不增加测试分支 */
import DaylanePlugin from "../src/main";

/** 固定时间与浏览器摘要接口 */
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 11, 10));
  notices.length = 0;
});
/** 测试结束清理所有模拟资源 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
/** 构造真实 Markdown 到插件入口的公开 API 链 */
function pluginFixture(): {
  plugin: DaylanePlugin;
  mock: Plugin;
  storage: MemoryVault;
  order: string[];
} {
  // 保留模拟 Vault 原文，检查完整读写链与数据边界
  const storage = new MemoryVault();
  storage.files.set(
    "Daylane/Items/2026/example.md",
    noteContent(
      {
        "daylane-schema": 1,
        "daylane-id": "one",
        "daylane-kind": "todo",
        title: "测试事项",
        status: "open",
        scheduled: "2026-10-09",
        rollover: "inherit",
        updated: "old",
      },
      "原文",
    ),
  );
  // 记录宿主监听和扫描顺序，复现缓存未就绪风险
  const order: string[] = [];
  // 模拟宿主文件事件订阅，检查卸载后资源清理
  const events = new Map<string, (...args: unknown[]) => void>();
  // 取得当前工作区目标页签，承载独立视图
  const leaf = {
    setViewState: vi.fn(async () => undefined),
    openFile: vi.fn(async () => undefined),
  };
  // 提供公开 App 接口替身，生产代码不含测试条件
  const app = {
    vault: {
      getMarkdownFiles: () => {
        order.push("scan");
        return storage.paths().map((path) => new TFile(path));
      },
      getAbstractFileByPath: (path: string) =>
        storage.files.has(path) ? new TFile(path) : null,
      read: (file: TFile) => storage.read(file.path),
      on: (event: string, callback: (...args: unknown[]) => void) => {
        order.push(event);
        events.set(event, callback);
        return () => events.delete(event);
      },
      createFolder: async (_path: string) => undefined,
      create: async (path: string, content: string) => {
        await storage.create(path, content);
        return new TFile(path);
      },
    },
    fileManager: {
      processFrontMatter: (
        file: TFile,
        callback: (fields: Record<string, unknown>) => void,
      ) => storage.update(file.path, callback),
      trashFile: (file: TFile) => storage.trash(file.path),
    },
    workspace: {
      getLeaf: () => leaf,
      getRightLeaf: () => leaf,
      getLeavesOfType: () => [],
      revealLeaf: vi.fn(),
      detachLeavesOfType: vi.fn(),
      onLayoutReady: (_callback: () => void) => undefined,
    },
  };
  // 加载独立插件入口，验证公开 API 生命周期
  const plugin = new (DaylanePlugin as unknown as new (
    app: unknown,
  ) => DaylanePlugin)(app);
  return { plugin, mock: plugin as unknown as Plugin, storage, order };
}
/** 宿主生命周期覆盖组件测试无法证明的注册和保存边界 */
describe("独立插件入口与 Obsidian API 边界", () => {
  it("先注册文件事件再扫描，只注册自己的视图与代码块", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock, order } = pluginFixture();
    await plugin.onload();
    expect(order.indexOf("create")).toBeLessThan(order.indexOf("scan"));
    expect(plugin.repository.items()).toHaveLength(1);
    expect([...mock.processors.keys()]).toEqual(["daylane"]);
    expect([...mock.factories.keys()]).toEqual([
      "daylane-calendar",
      "daylane-timer",
    ]);
    expect(
      mock.registeredCommands.some((command) => command.id === "undo-rollover"),
    ).toBe(true);
    plugin.onunload();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const dispose of mock.disposers) dispose();
  });
  it("代码块非法配置就地报告，不影响其他日历实例", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    // 提供当前实例独立挂载容器，便于关闭后清理资源
    const root = document.createElement("div");
    // 保存代码块生命周期对象，显式验证挂载与卸载
    const children: { onload: () => void; onunload: () => void }[] = [];
    // 获取已注册代码块处理器，验证错误配置隔离
    const processor = mock.processors.get("daylane")!;
    processor("month: 2026-13", root, {
      addChild: (child) => children.push(child as (typeof children)[number]),
    });
    expect(root.textContent).toContain("配置错误");
    expect(children).toHaveLength(0);
    root.replaceChildren();
    processor("month: 2026-10\ninteractive: false", root, {
      addChild: (child) => children.push(child as (typeof children)[number]),
    });
    children[0].onload();
    expect(root.querySelectorAll(".daylane-day")).toHaveLength(42);
    children[0].onunload();
    expect(root.childElementCount).toBe(0);
    plugin.onunload();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const dispose of mock.disposers) dispose();
  });
  it("更改默认时长不打断正在运行的轮次，关闭番茄钟停止本轮", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    plugin.timer.select("focus", 37);
    plugin.timer.start();
    await plugin.configure({ focusMinutes: 45 });
    expect(plugin.timer.snapshot().minutes).toBe(37);
    expect((mock.data as { focusMinutes: number }).focusMinutes).toBe(45);
    await plugin.configure({ timerEnabled: false });
    expect(plugin.timer.snapshot().status).toBe("idle");
    plugin.onunload();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const dispose of mock.disposers) dispose();
  });
  it("保存设置失败回退配置，不将失败的新目录当成已切换", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    mock.saveData = async () => {
      throw new Error("磁盘写入失败");
    };
    await expect(plugin.configure({ folder: "New/Items" })).rejects.toThrow(
      "磁盘写入失败",
    );
    expect(plugin.getPreferences().folder).toBe("Daylane/Items");
    expect(plugin.repository.contains("Daylane/Items/2026/example.md")).toBe(
      true,
    );
    plugin.onunload();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const dispose of mock.disposers) dispose();
  });
});
