import {
  ItemView,
  MarkdownRenderChild,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { calendarOptions } from "./codeblock";
import {
  DEFAULTS,
  Item,
  localDay,
  midnightDelay,
  Preferences,
  safeFolder,
} from "./domain";
import { HolidayService } from "./holidays";
import { ConfirmModal, ImportModal, ItemModal } from "./modals";
import { ObsidianVault } from "./obsidian-adapter";
import { ItemRepository } from "./repository";
import { BatchResult, RolloverService } from "./rollover";
import { TimerService, validMinutes } from "./timer";
import {
  CalendarOptions,
  CalendarPanel,
  element,
  timerLabel,
  TimerPanel,
  UiHost,
} from "./ui";

/** 大屏与侧栏日历的公开视图标识 */
const CALENDAR_VIEW = "daylane-calendar";
/** 独立番茄钟视图标识 */
const TIMER_VIEW = "daylane-timer";
/** 插件运行时只保留一套事实服务 */
export default class DaylanePlugin extends Plugin implements UiHost {
  /** 最新持久化偏好 */
  private preferences: Preferences = { ...DEFAULTS, lastBatch: [] };
  /** 所有日历共享的事项仓库 */
  repository!: ItemRepository;
  /** 内置中国正式假期与调休安排 */
  holidays = new HolidayService();
  /** 所有计时面板共享的番茄钟 */
  timer!: TimerService;
  /** 插件级自动流转执行器 */
  rollover!: RolloverService;
  /** 当前状态栏展示节点 */
  private statusEl: HTMLElement | null = null;
  /** 用户手势初始化的提示音上下文 */
  private audio: AudioContext | null = null;
  /** 偏好保存串行链，防止较早写入覆盖最近批次 */
  private saving: Promise<void> = Promise.resolve();
  /** 午夜调度资源 */
  private midnight: number | null = null;
  /** 已知本地日期，用于补偿唤醒和定时延迟 */
  private day = localDay();
  /** 插件卸载后禁止迟到回调继续调度 */
  private stopped = false;
  /** 初始化独立插件，不修改其他插件配置 */
  async onload(): Promise<void> {
    // 配置结构迁移仅限插件自己的数据
    const loaded = (await this.loadData()) as Partial<Preferences> | null;
    this.preferences = {
      ...DEFAULTS,
      ...loaded,
      lastBatch: Array.isArray(loaded?.lastBatch) ? loaded.lastBatch : [],
    };
    try {
      this.preferences.folder = safeFolder(this.preferences.folder);
    } catch {
      this.preferences.folder = DEFAULTS.folder;
      this.notify("事项目录配置无效，已回到 Daylane/Items");
    }
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const key of ["focusMinutes", "breakMinutes"] as const)
      if (!validMinutes(this.preferences[key]))
        this.preferences[key] = DEFAULTS[key];
    this.repository = new ItemRepository(
      new ObsidianVault(this.app),
      this.preferences.folder,
    );
    this.rollover = new RolloverService(
      this.repository,
      this.holidays,
      () => this.preferences,
      () => this.save(),
    );
    this.timer = new TimerService(
      () => Date.now(),
      (mode) => {
        this.notify(
          mode === "focus"
            ? "专注结束，可以休息了"
            : "休息结束，可以开始下一轮专注",
        );
        this.playSound();
      },
    );
    this.timer.select("focus", this.preferences.focusMinutes);
    // 先订阅文件事件再扫描，冷启动不依赖元数据缓存已就绪
    const fileChanged = (file: import("obsidian").TAbstractFile): void => {
      if (file instanceof TFile) void this.repository.refresh(file.path);
    };
    this.registerEvent(this.app.vault.on("create", fileChanged));
    this.registerEvent(this.app.vault.on("modify", fileChanged));
    this.registerEvent(
      this.app.vault.on("delete", (file) => this.repository.remove(file.path)),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.repository.remove(oldPath);
        void this.repository
          .scan()
          .catch((error) => this.notify(String(error)));
      }),
    );
    this.registerView(CALENDAR_VIEW, (leaf) => new CalendarView(leaf, this));
    this.registerView(TIMER_VIEW, (leaf) => new FocusView(leaf, this));
    this.registerMarkdownCodeBlockProcessor(
      "daylane",
      (source, container, context) => {
        try {
          // 读取文件或配置属性，不把元数据缓存当作唯一事实
          const fields = this.repository.port.parseYaml(source);
          // 保存当前日历实例的配置，不改动其他实例状态
          const options = calendarOptions(fields);
          context.addChild(new EmbeddedCalendar(container, this, options));
        } catch (error) {
          element(
            container,
            "p",
            "daylane-warning",
            `Daylane 配置错误：${error instanceof Error ? error.message : error}`,
          );
        }
      },
    );
    this.addRibbonIcon("calendar-days", "打开 Daylane 日历", () => {
      void this.openCalendar().catch((error) => this.notify(String(error)));
    });
    this.addSettingTab(new DaylaneSettings(this));
    this.commands();
    this.statusEl = this.addStatusBarItem();
    this.statusEl.classList.add("daylane-status");
    this.registerDomEvent(this.statusEl, "click", () => {
      void this.openTimer().catch((error) => this.notify(String(error)));
    });
    this.register(this.timer.changes.subscribe(() => this.updateStatus()));
    this.registerInterval(
      window.setInterval(() => {
        this.timer.tick();
        if (this.day !== localDay()) {
          this.day = localDay();
          void this.checkRollover();
          this.scheduleMidnight();
        }
      }, 1000),
    );
    this.registerDomEvent(document, "visibilitychange", () => {
      if (!document.hidden) {
        this.timer.tick();
        void this.checkRollover();
      }
    });
    this.registerDomEvent(window, "focus", () => {
      this.timer.tick();
      void this.checkRollover();
    });
    await this.repository.scan();
    this.updateStatus();
    this.scheduleMidnight();
    this.app.workspace.onLayoutReady(() => {
      if (!this.stopped) void this.checkRollover();
    });
  }
  /** 所有入口读取同一份最新设置 */
  getPreferences(): Preferences {
    return this.preferences;
  }
  /** 顺序保存快照，出现写入失败时向调用方返回异常 */
  async save(): Promise<void> {
    // 在请求时取快照，写入完成顺序与业务修改顺序一致
    const snapshot = structuredClone(this.preferences);
    this.saving = this.saving
      .catch(() => undefined)
      .then(() => this.saveData(snapshot));
    return this.saving;
  }
  /** 给用户显示事实错误，不记录敏感事项内容到外部 */
  notify(message: string): void {
    new Notice(message, 7000);
  }
  /** 打开新建或编辑表单 */
  edit(date: string, item?: Item): void {
    new ItemModal(this.app, this, date, item).open();
  }
  /** 由公开工作区 API 打开事项笔记 */
  async open(item: Item): Promise<void> {
    // 确认文件仍存在，避免向已删除或替换的路径写入
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) throw new Error("事项文件不存在");
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
  /** 删除需用户在具体事项上确认，回收到用户选择的位置 */
  trash(item: Item): void {
    new ConfirmModal(
      this.app,
      "删除事项",
      `将“${item.title}”的笔记移到回收站？`,
      () => this.repository.trash(item),
      this.notify,
    ).open();
  }
  /** 状态变更后检查重新打开的过期待办 */
  async status(item: Item, status: Item["status"]): Promise<void> {
    await this.repository.status(item, status);
    if (status === "open") await this.checkRollover();
  }
  /** 不重复改写状态，直接检查保存后的真实事项 */
  afterEdit(): Promise<void> {
    return this.checkRollover();
  }
  /** 打开大屏或侧栏视图，可由 Obsidian 移到独立窗口 */
  async openCalendar(sidebar = false): Promise<void> {
    // 取得当前工作区目标页签，承载独立视图
    const leaf = sidebar
      ? this.app.workspace.getRightLeaf(false)
      : this.app.workspace.getLeaf("tab");
    if (!leaf) throw new Error("无法创建日历页签");
    await leaf.setViewState({
      type: CALENDAR_VIEW,
      active: true,
      state: { compact: sidebar },
    });
    await this.app.workspace.revealLeaf(leaf);
  }
  /** 独立番茄钟默认打开在侧栏 */
  async openTimer(): Promise<void> {
    if (!this.preferences.timerEnabled) {
      this.notify("请先在 Daylane 设置中启用番茄钟");
      return;
    }
    // 取得当前工作区目标页签，承载独立视图
    const leaf =
      this.app.workspace.getLeavesOfType(TIMER_VIEW)[0] ??
      this.app.workspace.getRightLeaf(false);
    if (!leaf) throw new Error("无法打开番茄钟");
    await leaf.setViewState({ type: TIMER_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  /** 由用户启动手势解锁可选本地提示音 */
  prepareSound(): void {
    if (!this.preferences.sound) return;
    try {
      this.audio ??= new AudioContext();
      void this.audio
        .resume()
        .catch(() => this.notify("提示音不可用，到时仍会显示文字通知"));
    } catch {
      this.notify("提示音不可用，到时仍会显示文字通知");
    }
  }
  /** 自生成短音，不读取网络资源 */
  private playSound(): void {
    if (
      !this.preferences.sound ||
      !this.audio ||
      this.audio.state !== "running"
    )
      return;
    // 创建本地短提示音，不加载外部音频资源
    const oscillator = this.audio.createOscillator();
    // 控制本地提示音音量并平滑结束
    const gain = this.audio.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.12, this.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.6);
    oscillator.connect(gain);
    gain.connect(this.audio.destination);
    oscillator.start();
    oscillator.stop(this.audio.currentTime + 0.6);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  /** 汇总操作结果，自动检查无变化时保持安静 */
  private showResult(result: BatchResult, title: string, quiet = false): void {
    if (!quiet || result.changed || result.skipped || result.errors.length)
      this.notify(
        `${title}：成功 ${result.changed}，跳过 ${result.skipped}${result.errors.length ? `\n${result.errors.join("\n")}` : ""}`,
      );
  }
  /** 前台、启动和午夜共同调用同一执行器 */
  async checkRollover(): Promise<void> {
    if (this.stopped) return;
    try {
      this.showResult(await this.rollover.run(), "待办流转", true);
    } catch (error) {
      this.notify(`流转失败：${String(error)}`);
    }
  }
  /** 重设本地午夜检查并清理旧调度 */
  private scheduleMidnight(): void {
    if (this.midnight !== null) window.clearTimeout(this.midnight);
    this.midnight = window.setTimeout(() => {
      if (this.stopped) return;
      this.day = localDay();
      void this.checkRollover();
      this.repository.changes.emit();
      this.scheduleMidnight();
    }, midnightDelay());
  }
  /** 更新统一番茄钟状态栏，不写入计时会话 */
  private updateStatus(): void {
    if (!this.statusEl) return;
    // 读取当前运行阶段，驱动计时文字与交互状态
    const state = this.timer.snapshot();
    this.statusEl.hidden = !this.preferences.timerEnabled;
    this.statusEl.textContent = `◷ ${state.mode === "focus" ? "专注" : "休息"} ${timerLabel(state.seconds)}${state.status === "paused" ? " · 暂停" : ""}`;
  }
  /** 修改设置后只影响下一轮时长与后续日历展示 */
  async configure(patch: Partial<Preferences>): Promise<void> {
    if (patch.folder) patch.folder = safeFolder(patch.folder);
    // 识别目录范围变更，只在必要时重建事项索引
    const changedFolder =
      patch.folder && patch.folder !== this.preferences.folder;
    // 保存修改前的事实快照，失败时恢复或验证变化边界
    const previous = structuredClone(this.preferences);
    Object.assign(this.preferences, patch);
    try {
      await this.save();
    } catch (error) {
      this.preferences = previous;
      throw error;
    }
    if (changedFolder) await this.repository.configure(this.preferences.folder);
    if (!this.preferences.timerEnabled) this.timer.reset();
    else if (
      this.timer.snapshot().status === "idle" &&
      (patch.focusMinutes || patch.breakMinutes)
    ) {
      // 确定本轮专注或休息模式，与事项业务保持独立
      const mode = this.timer.snapshot().mode;
      this.timer.select(
        mode,
        mode === "focus"
          ? this.preferences.focusMinutes
          : this.preferences.breakMinutes,
      );
    }
    this.repository.changes.emit();
    this.timer.changes.emit();
    await this.checkRollover();
  }
  /** 注册命令，通过统一异常出口处理写入失败 */
  private commands(): void {
    // 命令包装只处理异常，不添加业务分支
    const command = (
      id: string,
      name: string,
      action: () => void | Promise<void>,
    ): void => {
      this.addCommand({
        id,
        name,
        callback: () => {
          Promise.resolve()
            .then(action)
            .catch((error) =>
              this.notify(
                error instanceof Error ? error.message : String(error),
              ),
            );
        },
      });
    };
    command("open-calendar", "打开大屏日历", () => this.openCalendar());
    command("open-sidebar", "打开侧栏日历", () => this.openCalendar(true));
    command("new-item", "新建重要事项或待办", () => this.edit(localDay()));
    command("today", "查看今天待办", () => this.openCalendar());
    command("roll-to-today", "将此前未完成待办移到今天", async () =>
      this.showResult(await this.rollover.run(true), "手动改期"),
    );
    command("undo-rollover", "撤回最近一次流转", async () =>
      this.showResult(await this.rollover.undo(), "撤回流转"),
    );
    command("refresh-index", "重新扫描事项文件", async () => {
      await this.repository.scan();
      this.notify(
        `扫描完成：${this.repository.items().length} 条有效事项，${this.repository.issues.size} 个问题`,
      );
    });
    command("import-calendar-plus", "导入 Calendar Plus 重要事项", () =>
      new ImportModal(this.app, this).open(),
    );
    command("open-timer", "打开独立番茄钟", () => this.openTimer());
    command("toggle-timer", "番茄钟开始或暂停", () => {
      if (!this.preferences.timerEnabled) throw new Error("番茄钟已关闭");
      if (this.timer.snapshot().status === "running") this.timer.pause();
      else {
        // 已结束轮次启动时读取最新默认配置，暂停轮次保持原时长
        const snapshot = this.timer.snapshot();
        if (snapshot.status === "finished")
          this.timer.select(
            snapshot.mode,
            snapshot.mode === "focus"
              ? this.preferences.focusMinutes
              : this.preferences.breakMinutes,
          );
        this.prepareSound();
        this.timer.start();
      }
    });
    command("reset-timer", "重置番茄钟", () => this.timer.reset());
    this.addCommand({
      id: "insert-calendar",
      name: "插入日历代码块",
      editorCallback: (editor) =>
        editor.replaceSelection(
          "```daylane\nmonth: current\nshow-holidays: true\ninteractive: true\n```\n",
        ),
    });
  }
  /** 释放插件资源，关闭应用后不继续计时 */
  onunload(): void {
    this.stopped = true;
    this.app.workspace.detachLeavesOfType(CALENDAR_VIEW);
    this.app.workspace.detachLeavesOfType(TIMER_VIEW);
    if (this.midnight !== null) window.clearTimeout(this.midnight);
    this.repository?.dispose();
    this.timer?.changes.clear();
    if (this.audio) void this.audio.close();
  }
}
/** Obsidian 页签承载共享日历组件 */
class CalendarView extends ItemView {
  /** 当前组件实例 */
  private panel: CalendarPanel | null = null;
  /** 侧栏是否使用紧凑布局 */
  private compact = false;
  /** 注入插件业务服务 */
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: DaylanePlugin,
  ) {
    super(leaf);
  }
  /** Obsidian 视图身份 */
  getViewType(): string {
    return CALENDAR_VIEW;
  }
  /** 用户看到的页签名称 */
  getDisplayText(): string {
    return "Daylane · 中国节假日日历";
  }
  /** 视图图标 */
  getIcon(): string {
    return "calendar-days";
  }
  /** 工作区恢复侧栏布局设置 */
  async setState(
    state: { compact?: boolean },
    result: { history: boolean },
  ): Promise<void> {
    this.compact = Boolean(state.compact);
    await super.setState(state, result);
    this.panel?.dispose();
    this.panel = new CalendarPanel(this.contentEl, this.plugin, {
      compact: this.compact,
    });
  }
  /** 保存当前宿主布局状态 */
  getState(): { compact: boolean } {
    return { compact: this.compact };
  }
  /** 打开页签挂载日历 */
  async onOpen(): Promise<void> {
    this.panel = new CalendarPanel(this.contentEl, this.plugin, {
      compact: this.compact,
    });
  }
  /** 关闭页签只卸载当前组件 */
  async onClose(): Promise<void> {
    this.panel?.dispose();
    this.panel = null;
  }
}
/** 独立番茄钟宿主 */
class FocusView extends ItemView {
  /** 当前计时面板 */
  private panel: TimerPanel | null = null;
  /** 注入插件统一计时服务 */
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: DaylanePlugin,
  ) {
    super(leaf);
  }
  /** 独立视图类型 */
  getViewType(): string {
    return TIMER_VIEW;
  }
  /** 页签名称 */
  getDisplayText(): string {
    return "Daylane · 番茄钟";
  }
  /** 页签图标 */
  getIcon(): string {
    return "timer";
  }
  /** 打开时订阅共享状态 */
  async onOpen(): Promise<void> {
    this.panel = new TimerPanel(this.contentEl, this.plugin);
  }
  /** 关闭视图不停止计时 */
  async onClose(): Promise<void> {
    this.panel?.dispose();
    this.panel = null;
  }
}
/** 阅读视图与实时预览日历的资源生命周期 */
class EmbeddedCalendar extends MarkdownRenderChild {
  /** 单个代码块对应的组件 */
  private panel: CalendarPanel | null = null;
  /** 注入实例选项 */
  constructor(
    container: HTMLElement,
    private plugin: DaylanePlugin,
    private options: CalendarOptions,
  ) {
    super(container);
  }
  /** 挂载共享事项日历 */
  onload(): void {
    this.panel = new CalendarPanel(this.containerEl, this.plugin, this.options);
  }
  /** 笔记重新渲染时清理订阅 */
  onunload(): void {
    this.panel?.dispose();
  }
}
/** 精简设置，不引入周期笔记配置 */
class DaylaneSettings extends PluginSettingTab {
  /** 注入插件持久化配置边界 */
  constructor(private plugin: DaylanePlugin) {
    super(plugin.app, plugin);
  }
  /** 构建中文偏好与默认时长设置 */
  display(): void {
    this.containerEl.replaceChildren();
    element(this.containerEl, "h2", "", "Daylane · 中国节假日与待办日历");
    // 读取偏好快照，验证默认行为与单项覆盖
    const settings = this.plugin.getPreferences();
    new Setting(this.containerEl)
      .setName("事项目录")
      .setDesc("只索引此目录；变更目录不会移动已有事项文件。")
      .addText((input) => {
        input.setValue(settings.folder);
        input.inputEl.addEventListener("change", () => {
          void this.plugin
            .configure({ folder: input.getValue() })
            .catch((error) => this.plugin.notify(String(error)));
        });
      });
    // 设置开关只更新所属业务字段
    const toggle = (
      name: string,
      key:
        | "mondayFirst"
        | "showCompleted"
        | "showHolidays"
        | "autoRollover"
        | "timerEnabled"
        | "sound",
      description: string,
    ): void => {
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(description)
        .addToggle((input) =>
          input.setValue(settings[key]).onChange(async (value) => {
            try {
              await this.plugin.configure({ [key]: value });
            } catch (error) {
              this.plugin.notify(String(error));
            }
          }),
        );
    };
    new Setting(this.containerEl).setName("新事项颜色").addDropdown((input) => {
      input
        .addOptions({
          blue: "蓝",
          green: "绿",
          orange: "橙",
          red: "红",
          purple: "紫",
          gray: "灰",
        })
        .setValue(settings.color)
        .onChange(async (value) => {
          await this.plugin
            .configure({ color: value })
            .catch((error) => this.plugin.notify(String(error)));
        });
    });
    toggle(
      "每周从周一开始",
      "mondayFirst",
      "影响大屏、侧栏与代码块的日期排列。",
    );
    toggle("显示已完成和取消事项", "showCompleted", "关闭后只显示未完成事项。");
    toggle(
      "显示中国正式节假日",
      "showHolidays",
      "内置 2025、2026 年国务院公告安排；包含调休上班日，未收录年份有明确提示。",
    );
    toggle(
      "自动流转未完成待办",
      "autoRollover",
      "默认关闭；在本地午夜或下次打开插件时，把过期待办移到当前目标日期。固定日程与截止日期保持不变。",
    );
    new Setting(this.containerEl)
      .setName("自动流转日期规则")
      .setDesc("工作日模式遇到未收录年度会暂缓，不猜测正式放假安排。")
      .addDropdown((input) => {
        input
          .addOptions({
            calendar: "自然日：移到今天",
            workday: "工作日：今天或下一个正式工作日",
          })
          .setValue(settings.rolloverMode)
          .onChange(async (value) => {
            await this.plugin
              .configure({ rolloverMode: value as Preferences["rolloverMode"] })
              .catch((error) => this.plugin.notify(String(error)));
          });
      });
    toggle(
      "启用独立番茄钟",
      "timerEnabled",
      "不关联事项；关闭或重载插件后本轮计时停止。",
    );
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const [key, name] of [
      ["focusMinutes", "专注时长（分钟）"],
      ["breakMinutes", "休息时长（分钟）"],
    ] as const) {
      new Setting(this.containerEl)
        .setName(name)
        .setDesc("1—240 的整数；修改不影响正在运行的轮次。")
        .addText((input) => {
          input.inputEl.type = "number";
          input.inputEl.min = "1";
          input.inputEl.max = "240";
          input.setValue(String(settings[key]));
          input.inputEl.addEventListener("change", () => {
            // 读取并校验用户输入，拒绝无效配置或日期
            const value = Number(input.getValue());
            if (!validMinutes(value)) {
              this.plugin.notify("时长应为 1—240 的整数分钟");
              input.setValue(String(settings[key]));
              return;
            }
            void this.plugin
              .configure({ [key]: value })
              .catch((error) => this.plugin.notify(String(error)));
          });
        });
    }
    toggle(
      "到时播放短提示音",
      "sound",
      "本地生成短音，不使用网络资源；不可用时仍显示文字提示。",
    );
  }
}
