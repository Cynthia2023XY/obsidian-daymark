import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryVault } from "./helpers";
import { noteContent } from "../src/repository";
import { Menu, notices, Plugin, TFile } from "./obsidian-mock";
import DaymarkPlugin from "../src/main";
/** 仅模拟日期，不冻结首扫分批让步 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 12, 10));
  notices.length = 0;
});
/** 清理模拟窗口状态 */
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});
/** 公开 Obsidian API 的模拟宿主，生命周期仍调用生产入口 */
function pluginFixture(): {
  plugin: DaymarkPlugin;
  mock: Plugin;
  storage: MemoryVault;
  order: string[];
  ready: () => void;
  leaves: any[];
  expand: ReturnType<typeof vi.fn>;
} {
  // 保留模拟 Vault 原文，检查完整读写链与数据边界
  const storage = new MemoryVault();
  storage.files.set(
    "Daylane/Items/事项.md",
    noteContent(
      {
        "daylane-type": "important-event",
        "daylane-date": "2026-10-09",
        "daylane-status": "open",
        "daylane-rollover-count": 0,
      },
      "原始正文",
    ),
  );
  // 记录宿主监听和扫描顺序，复现缓存未就绪风险
  const order: string[] = [];
  // 模拟宿主文件事件订阅，检查卸载后资源清理
  const events = new Map<string, (...args: unknown[]) => void>();
  // 保存当前处理阶段的事实结果，供后续校验与展示
  const leaves: any[] = [];
  // 保存当前处理阶段的事实结果，供后续校验与展示
  const expand = vi.fn();
  // 左侧容器是默认日历的唯一归属
  const leftRoot = { expand };
  // 右侧容器用于模拟旧版本位置及独立番茄钟
  const rightRoot = { expand: vi.fn() };
  // 文件列表所在的左侧主标签组
  const leftTabs = {};
  // 旧实现拆出的左下方标签组
  const lowerTabs = {};
  // 保存当前处理阶段的事实结果，供后续校验与展示
  let ready: () => void = () => undefined;
  // 保存当前处理阶段的事实结果，供后续校验与展示
  const newLeaf = (side = "main"): any => {
    // 读取当前运行阶段，驱动计时文字与交互状态
    let state = { compact: false, inbox: false };
    // 取得当前工作区目标页签，承载独立视图
    const leaf = {
      type: "",
      parent:
        side === "left" ? leftTabs : side === "left-bottom" ? lowerTabs : {},
      getRoot: () =>
        side.startsWith("left")
          ? leftRoot
          : side === "right"
            ? rightRoot
            : null,
      detach: vi.fn(() => {
        leaves.splice(leaves.indexOf(leaf), 1);
      }),
      view: { getState: () => state },
      setViewState: vi.fn(async (next: any) => {
        leaf.type = next.type;
        state = next.state ?? state;
      }),
      openFile: vi.fn(async () => undefined),
    };
    leaves.push(leaf);
    return leaf;
  };
  // 提供公开 App 接口替身，生产代码不含测试条件
  const app = {
    vault: {
      configDir: ".obsidian",
      getMarkdownFiles: () => {
        order.push("scan");
        return storage.paths().map((path) => new TFile(path));
      },
      getAbstractFileByPath: (path: string) =>
        storage.files.has(path)
          ? new TFile(path)
          : storage.folders.has(path)
            ? { path }
            : null,
      read: (file: TFile) => storage.read(file.path),
      process: (file: TFile, operation: (content: string) => string) =>
        storage.process(file.path, operation),
      on: (event: string, callback: (...args: unknown[]) => void) => {
        order.push(event);
        events.set(event, callback);
        return () => events.delete(event);
      },
      createFolder: (path: string) => storage.ensureFolder(path),
      create: async (path: string, content: string) => {
        await storage.create(path, content);
        return new TFile(path);
      },
      adapter: {
        exists: async (path: string) => storage.exists(path),
        mkdir: (path: string) => storage.ensureFolder(path),
        write: async (path: string, content: string) => {
          storage.backups.set(path, content);
        },
      },
    },
    fileManager: {
      processFrontMatter: (
        file: TFile,
        callback: (fields: Record<string, unknown>) => void,
      ) => storage.update(file.path, callback),
      trashFile: (file: TFile) => storage.trash(file.path),
      renameFile: (file: TFile, target: string) =>
        storage.rename(file.path, target),
    },
    workspace: {
      getLeaf: () => newLeaf(),
      getLeftLeaf: vi.fn((split = false) =>
        newLeaf(split ? "left-bottom" : "left"),
      ),
      getRightLeaf: vi.fn(() => newLeaf("right")),
      getLeavesOfType: (type: string) =>
        leaves.filter((leaf) => leaf.type === type),
      revealLeaf: vi.fn(),
      leftSplit: leftRoot,
      rightSplit: rightRoot,
      detachLeavesOfType: vi.fn(),
      onLayoutReady: (callback: () => void) => {
        ready = callback;
      },
    },
  };
  // 加载独立插件入口，验证公开 API 生命周期
  const plugin = new (DaymarkPlugin as unknown as new (
    app: unknown,
  ) => DaymarkPlugin)(app);
  return {
    plugin,
    mock: plugin as unknown as Plugin,
    storage,
    order,
    ready: () => ready(),
    leaves,
    expand,
  };
}
/** 关闭所有注册资源，测试不残留窗口计时器 */
function unload(plugin: DaymarkPlugin, mock: Plugin): void {
  plugin.onunload();
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const dispose of mock.disposers) dispose();
}
/** 常用命令、默认侧栏、设置卡片和右键行为 */
describe("单日插件宿主", () => {
  it("卸载保留日历与番茄钟面板，并停止索引和午夜定时资源", async () => {
    // 使用生产生命周期验证用户布局保留与后台资源清理
    const { plugin, mock, leaves } = pluginFixture();
    await plugin.onload();
    await plugin.openCalendar(false);
    // 模拟用户已打开的独立番茄钟面板
    const timerLeaf = plugin.app.workspace.getRightLeaf(false)!;
    await timerLeaf.setViewState({ type: "daymark-chinese-calendar-timer" });
    // 保留卸载前的面板引用，确认宿主布局未被移除
    const retainedLeaves = [...leaves];
    // 核对索引服务与午夜定时器仍会清理
    const dispose = vi.spyOn(plugin.repository, "dispose");
    // 观察卸载是否取消已安排的午夜检查
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    try {
      unload(plugin, mock);
      expect(plugin.app.workspace.detachLeavesOfType).not.toHaveBeenCalled();
      expect(leaves).toEqual(retainedLeaves);
      // 每个已打开的面板都应由宿主保留
      for (const leaf of leaves) expect(leaf.detach).not.toHaveBeenCalled();
      expect(dispose).toHaveBeenCalledOnce();
      expect(clearTimeout).toHaveBeenCalled();
    } finally {
      dispose.mockRestore();
      clearTimeout.mockRestore();
    }
  });
  it("监听先于首扫，命令严格五条且默认恢复侧栏不重复", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock, order, ready, leaves, expand } = pluginFixture();
    await plugin.onload();
    expect(order.indexOf("create")).toBeLessThan(order.indexOf("scan"));
    expect(mock.registeredCommands.map((command) => command.id)).toEqual([
      "open-sidebar",
      "open-calendar",
      "roll-to-today",
      "complete-today",
      "open-inbox",
    ]);
    ready();
    await vi.waitFor(() =>
      expect(leaves[0].type).toBe("daymark-chinese-calendar-calendar"),
    );
    expect(expand).toHaveBeenCalled();
    expect(plugin.app.workspace.getLeftLeaf).toHaveBeenCalledWith(false);
    expect(leaves[0].getRoot()).toBe(plugin.app.workspace.leftSplit);
    await plugin.openCalendar(true, false);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].setViewState).toHaveBeenCalledTimes(1);
    unload(plugin, mock);
  });
  it("旧右侧日历自动迁到左侧，保留大屏且不抢编辑焦点", async () => {
    // 还原旧版本已存在右侧日历的工作区
    const { plugin, mock, ready, leaves } = pluginFixture();
    await plugin.onload();
    // 旧日历需要在新左侧成功创建后才关闭
    const previous = plugin.app.workspace.getRightLeaf(true)!;
    await previous.setViewState({
      type: "daymark-chinese-calendar-calendar",
      state: { compact: true },
    });
    await plugin.openCalendar(false);
    ready();
    await vi.waitFor(() =>
      expect(
        leaves.some(
          (leaf) => leaf.getRoot() === plugin.app.workspace.leftSplit,
        ),
      ).toBe(true),
    );
    expect(previous.detach).toHaveBeenCalledOnce();
    expect(leaves).toHaveLength(2);
    expect(plugin.app.workspace.revealLeaf).toHaveBeenCalledTimes(1);
    await plugin.openCalendar(true, false);
    expect(leaves).toHaveLength(2);
    unload(plugin, mock);
  });
  it("左下方日历迁到文件列表标签组，不新建上下分区", async () => {
    // 模拟上次错误实现创建的左下方日历
    const { plugin, mock, ready, leaves } = pluginFixture();
    await plugin.onload();
    // split=true 表示分区，不能作为最终日历位置
    const previous = plugin.app.workspace.getLeftLeaf(true)!;
    await previous.setViewState({
      type: "daymark-chinese-calendar-calendar",
      state: { compact: true },
    });
    ready();
    await vi.waitFor(() => expect(previous.detach).toHaveBeenCalledOnce());
    expect(leaves).toHaveLength(1);
    expect(leaves[0].parent).not.toBe(previous.parent);
    expect(plugin.app.workspace.getLeftLeaf).toHaveBeenLastCalledWith(false);
    await plugin.openCalendar(true, false);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].setViewState).toHaveBeenCalledOnce();
    unload(plugin, mock);
  });
  it("新版工作日与短音默认值，旧已移除字段不会保存回来", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    mock.data = {
      folder: "Daylane/Items",
      autoRollover: false,
      rolloverMode: "calendar",
      color: "blue",
      sound: false,
    };
    await plugin.onload();
    expect(plugin.getPreferences()).toMatchObject({
      rolloverMode: "workday",
      maxRollovers: 5,
      sound: true,
    });
    await plugin.save();
    expect(mock.data).not.toHaveProperty("autoRollover");
    expect(mock.data).not.toHaveProperty("color");
    unload(plugin, mock);
  });
  it("独立配置卡片不包含项目、颜色、周起始、取消或全局开关", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings = mock.tabs[0] as {
      display: () => void;
      containerEl: HTMLElement;
    };
    settings.display();
    expect(
      settings.containerEl.querySelectorAll(".daylane-settings-card"),
    ).toHaveLength(2);
    expect(settings.containerEl.textContent).toContain("重要事项");
    expect(settings.containerEl.textContent).toContain("独立番茄钟");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const label of [
      "新事项颜色",
      "每周从周一",
      "显示已完成",
      "自动流转未完成待办",
    ])
      expect(settings.containerEl.textContent).not.toContain(label);
    unload(plugin, mock);
  });
  it("右键高亮和取消高亮更新笔记并切换菜单文案", async () => {
    // 通过公开菜单回调验证持久化链路
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    plugin.context(plugin.repository.items()[0], new MouseEvent("contextmenu"));
    Menu.last!.entries.find((entry) => entry.title === "高亮事项")!.action!();
    await vi.waitFor(() =>
      expect(plugin.repository.items()[0].highlighted).toBe(true),
    );
    plugin.context(plugin.repository.items()[0], new MouseEvent("contextmenu"));
    expect(Menu.last!.entries.map((entry) => entry.title)).not.toContain(
      "高亮事项",
    );
    Menu.last!.entries.find((entry) => entry.title === "取消高亮")!.action!();
    await vi.waitFor(() =>
      expect(plugin.repository.items()[0].highlighted).toBe(false),
    );
    unload(plugin, mock);
  });
  it("右键菜单有改期和待办箱入口，不增加自动记录", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    // 读取当前事项快照，核对操作对象与排期状态
    const item = plugin.repository.items()[0];
    plugin.context(item, new MouseEvent("contextmenu"));
    expect(Menu.last?.entries.map((entry) => entry.title)).toContain(
      "选择日期……",
    );
    Menu.last!.entries.find((entry) => entry.title === "移入待办箱")!.action!();
    await vi.waitFor(() => expect(plugin.repository.inbox()).toHaveLength(1));
    expect(plugin.repository.inbox()[0].rolloverCount).toBe(0);
    unload(plugin, mock);
  });
  it("代码块错误隔离；只注册 daylane，不抢旧 Calendar Plus", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    expect([...mock.processors.keys()]).toEqual(["daylane"]);
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
    root.replaceChildren();
    processor("month: 2026-10\ninteractive: false", root, {
      addChild: (child) => children.push(child as (typeof children)[number]),
    });
    children[0].onload();
    expect(root.querySelectorAll(".daylane-day")).toHaveLength(42);
    children[0].onunload();
    expect(root.childElementCount).toBe(0);
    unload(plugin, mock);
  });
  it("配置保存失败回退；时长默认更改不截断正在运行的轮次", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock } = pluginFixture();
    await plugin.onload();
    plugin.timer.select("focus", 37);
    plugin.timer.start();
    await plugin.configure({ focusMinutes: 45 });
    expect(plugin.timer.snapshot().minutes).toBe(37);
    mock.saveData = async () => {
      throw new Error("磁盘失败");
    };
    await expect(plugin.configure({ folder: "New/Items" })).rejects.toThrow(
      "磁盘失败",
    );
    expect(plugin.getPreferences().folder).toBe("Daylane/Items");
    unload(plugin, mock);
  });
  it("旧格式未确认迁移前不自动写入，仍可看到兼容事项", async () => {
    // 取得当前测试或业务边界，核对完整操作链
    const { plugin, mock, storage } = pluginFixture();
    storage.files.clear();
    storage.files.set(
      "Daylane/Items/旧.md",
      noteContent(
        {
          "calendar-plus-type": "important-event",
          date: "2026-10-09",
          status: "open",
          title: "旧",
        },
        "细节",
      ),
    );
    await plugin.onload();
    await plugin.checkRollover();
    expect(plugin.repository.items()[0].legacy).toBe(true);
    expect(storage.updates).toBe(0);
    unload(plugin, mock);
  });
});
