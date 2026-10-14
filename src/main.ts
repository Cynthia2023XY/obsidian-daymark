import {
  ItemView,
  MarkdownRenderChild,
  Menu,
  Notice,
  Plugin,
  PluginSettingTab,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { calendarOptions } from "./codeblock";
import {
  addDays,
  DEFAULTS,
  Item,
  localDay,
  midnightDelay,
  Preferences,
  safeFolder,
} from "./domain";
import { HolidayService } from "./holidays";
import { DateModal, ImportModal, ItemModal } from "./modals";
import { ObsidianVault } from "./obsidian-adapter";
import { ItemRepository } from "./repository";
import { BatchResult, RolloverService } from "./rollover";
import { TimerService, validMinutes } from "./timer";
import {
  button,
  CalendarOptions,
  CalendarPanel,
  element,
  TimerPanel,
  timerLabel,
  UiHost,
} from "./ui";

/** 沿用插件身份，升级不改变日历视图类型 */
const CALENDAR_VIEW = "daymark-chinese-calendar-calendar";
/** 番茄钟保持独立视图 */
const TIMER_VIEW = "daymark-chinese-calendar-timer";
/** 单日重要事项与独立番茄钟的公开宿主 */
export default class DaymarkPlugin extends Plugin implements UiHost {
  /** 精简设置，不持久化被移除的旧开关 */
  private preferences: Preferences = { ...DEFAULTS };
  /** 共享 Markdown 事实索引 */
  repository!: ItemRepository;
  /** 离线正式节假日数据 */
  holidays = new HolidayService();
  /** 插件级共享独立计时 */
  timer!: TimerService;
  /** 累计真实改期次数的自动执行器 */
  rollover!: RolloverService;
  /** 最新偏好写入顺序 */
  private saving: Promise<void> = Promise.resolve();
  /** 到时提示音在用户手势内初始化 */
  private audio: AudioContext | null = null;
  /** 桌面计时入口 */
  private statusEl: HTMLElement | null = null;
  /** 本地午夜调度 */
  private midnight: number | null = null;
  /** 记录前次本地日期，补偿睡眠回调 */
  private day = localDay();
  /** 卸载后不再调度 */
  private stopped = false;
  /** 相同暂缓错误不在每次聚焦重复打扰 */
  private lastError = "";
  /** 初始化公开 API 与范围，先监听再扫描 */
  async onload(): Promise<void> {
    // 读取持久化偏好并与安全默认值合并
    const loaded = (await this.loadData()) as
      | (Partial<Preferences> & { settingsVersion?: number })
      | null;
    this.preferences = { ...DEFAULTS };
    if (loaded?.settingsVersion === 2) {
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (const key of Object.keys(DEFAULTS) as (keyof Preferences)[])
        if (loaded[key] !== undefined)
          (this.preferences as unknown as Record<string, unknown>)[key] =
            loaded[key];
    } else if (loaded) {
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (const key of [
        "folder",
        "timerEnabled",
        "focusMinutes",
        "breakMinutes",
      ] as const)
        if (loaded[key] !== undefined)
          (this.preferences as unknown as Record<string, unknown>)[key] =
            loaded[key];
    }
    try {
      this.preferences.folder = safeFolder(this.preferences.folder);
    } catch {
      this.preferences.folder = DEFAULTS.folder;
      this.notify("事项目录无效，已恢复默认目录");
    }
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const key of ["focusMinutes", "breakMinutes"] as const)
      if (!validMinutes(this.preferences[key]))
        this.preferences[key] = DEFAULTS[key];
    if (
      !Number.isInteger(this.preferences.maxRollovers) ||
      this.preferences.maxRollovers < 1
    )
      this.preferences.maxRollovers = 5;
    if (
      this.preferences.rolloverMode !== "calendar" &&
      this.preferences.rolloverMode !== "workday"
    )
      this.preferences.rolloverMode = "workday";
    this.repository = new ItemRepository(
      new ObsidianVault(this.app, this.manifest.dir),
      this.preferences.folder,
      this.preferences.limitToFolder,
    );
    this.rollover = new RolloverService(
      this.repository,
      this.holidays,
      () => this.preferences,
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
    // 在缓存就绪前订阅文件变化，避免冷启动漏索引
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
        void this.repository
          .renamed(file.path, oldPath)
          .catch((error) => this.notify(String(error)));
      }),
    );
    this.registerView(CALENDAR_VIEW, (leaf) => new CalendarView(leaf, this));
    this.registerView(TIMER_VIEW, (leaf) => new FocusView(leaf, this));
    this.registerMarkdownCodeBlockProcessor(
      "daylane",
      (source, container, context) => {
        try {
          context.addChild(
            new EmbeddedCalendar(
              container,
              this,
              calendarOptions(this.repository.port.parseYaml(source)),
            ),
          );
        } catch (error) {
          element(
            container,
            "p",
            "daylane-warning",
            "Daymark 配置错误：" + String(error),
          );
        }
      },
    );
    this.addRibbonIcon("calendar-days", "打开侧栏日历", () => {
      void this.openCalendar(true).catch((error) => this.notify(String(error)));
    });
    this.addRibbonIcon("timer", "打开独立番茄钟", () => {
      void this.openTimer().catch((error) => this.notify(String(error)));
    });
    this.addSettingTab(new DaymarkSettings(this));
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
          this.repository.changes.emit();
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
      if (this.stopped) return;
      void this.openCalendar(true, false).catch((error) =>
        this.notify(String(error)),
      );
      void this.checkRollover();
    });
  }
  /** 各入口读取最新偏好 */
  getPreferences(): Preferences {
    return this.preferences;
  }
  /** 只写新设置，避免旧无效字段继续累积 */
  async save(): Promise<void> {
    // 读取当前完整状态，用于一致展示或顺序持久化
    const snapshot = {
      settingsVersion: 2,
      ...structuredClone(this.preferences),
    };
    this.saving = this.saving
      .catch(() => undefined)
      .then(() => this.saveData(snapshot));
    return this.saving;
  }
  /** 可见通知，不向任何外部服务发送事项内容 */
  notify(message: string): void {
    new Notice(message, 7000);
  }
  /** 新建只需要名称 */
  create(date?: string): void {
    new ItemModal(this.app, this, date).open();
  }
  /** 标题点击只打开文档，不打开复杂编辑表单 */
  async open(item: Item): Promise<void> {
    // 确认文件仍存在，避免向已删除或替换的路径写入
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) throw new Error("事项文件不存在");
    await this.app.workspace.getLeaf("tab").openFile(file);
  }
  /** 列表删除入口直接按配置回收或移除专属属性 */
  remove(item: Item): void {
    void this.repository
      .removeItem(item, this.preferences.preserveOnDelete)
      .catch((error) => this.notify(String(error)));
  }
  /** 完成状态变化保留累计次数，重新打开过期项后按规则处理 */
  async status(item: Item, status: Item["status"]): Promise<void> {
    await this.repository.status(item, status);
    if (status === "open") await this.checkRollover();
  }
  /** 右键集中承载手动改期，列表没有常驻改期按钮 */
  context(item: Item, event: MouseEvent): void {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const menu = new Menu();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const action = (
      title: string,
      operation: () => Promise<void> | void,
    ): void => {
      menu.addItem((entry) =>
        entry.setTitle(title).onClick(() => {
          Promise.resolve()
            .then(operation)
            .catch((error) => this.notify(String(error)));
        }),
      );
    };
    action(item.highlighted ? "取消高亮" : "高亮事项", () =>
      this.repository.highlight(item, !item.highlighted),
    );
    menu.addSeparator();
    if (!item.date || item.date < localDay())
      action("移到今天", () => this.repository.schedule(item, localDay()));
    action(
      this.preferences.rolloverMode === "workday"
        ? "移到下一个工作日"
        : "移到下一个自然日",
      async () => {
        // 保存当前处理阶段的事实结果，供后续校验与展示
        const base =
          item.date && item.date > localDay() ? item.date : localDay();
        // 计算后续日期或新路径，不沿用已失效的状态
        const next = addDays(base, 1);
        // 按本地自然日计算排期，避开 UTC 解析偏移
        const date =
          this.preferences.rolloverMode === "workday"
            ? this.holidays.nextWorkday(next)
            : next;
        if (!date) throw new Error("正式节假日未收录，无法确认下一个工作日");
        await this.repository.schedule(item, date);
      },
    );
    action("选择日期……", () =>
      new DateModal(this.app, item, (date) =>
        this.repository.schedule(item, date),
      ).open(),
    );
    if (item.date) action("移入待办箱", () => this.repository.schedule(item));
    menu.addSeparator();
    action(
      this.preferences.preserveOnDelete
        ? "移除事项属性，保留文档"
        : "删除文档到回收站",
      () => this.remove(item),
    );
    menu.showAtMouseEvent(event);
  }
  /** 配置及兼容横幅共享同一迁移入口 */
  migrate(): void {
    new ImportModal(this.app, this, () => this.checkRollover()).open();
  }
  /** 默认在左侧主标签组恢复日历，不抢当前主编辑区焦点 */
  async openCalendar(
    sidebar = true,
    focus = true,
    inbox = false,
  ): Promise<void> {
    // 复用左侧日历，并在创建成功后清理旧的右侧日历
    const calendars = this.app.workspace.getLeavesOfType(CALENDAR_VIEW);
    // 不拆分侧栏，将新日历加入文件列表所在的第一组标签页
    const candidate = sidebar ? this.app.workspace.getLeftLeaf(false) : null;
    // 比较直接父标签组，避免复用左下方旧分区中的日历
    const existing = calendars.find(
      (leaf) =>
        Boolean(leaf.view.getState().compact) === sidebar &&
        (!sidebar || (candidate && leaf.parent === candidate.parent)),
    );
    // 已有同组日历时移除临时空页签，继续复用原实例
    if (existing && candidate) candidate.detach();
    // 大屏保持独立主编辑区页签
    const leaf =
      existing ?? (sidebar ? candidate : this.app.workspace.getLeaf("tab"));
    if (!leaf) throw new Error("无法创建日历页签");
    if (!existing || focus || inbox)
      await leaf.setViewState({
        type: CALENDAR_VIEW,
        active: focus,
        state: { compact: sidebar, inbox },
      });
    if (sidebar) {
      // 左侧已成功挂载后再关闭旧侧栏，保留独立大屏日历
      for (const calendar of calendars)
        if (calendar !== leaf && calendar.view.getState().compact)
          calendar.detach();
    }
    if (focus) await this.app.workspace.revealLeaf(leaf);
    else if (sidebar) this.app.workspace.leftSplit.expand();
  }
  /** 独立番茄钟由图标及状态栏进入，不占常用命令 */
  async openTimer(): Promise<void> {
    if (!this.preferences.timerEnabled) {
      this.notify("请在设置中启用独立番茄钟");
      return;
    }
    // 取得当前工作区目标页签，承载独立视图
    const leaf =
      this.app.workspace.getLeavesOfType(TIMER_VIEW)[0] ??
      this.app.workspace.getRightLeaf(true);
    if (!leaf) throw new Error("无法打开番茄钟");
    await leaf.setViewState({ type: TIMER_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  /** 用户开始手势提前解锁音频 */
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
  /** 本地产生短音，不下载音频资源 */
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
  /** 真实处理结果区分成功、入箱、跳过与失败 */
  private showResult(result: BatchResult, title: string): void {
    this.notify(
      title +
        "：成功 " +
        result.changed +
        "，其中入箱 " +
        result.inbox +
        "，跳过 " +
        result.skipped +
        (result.errors.length ? "\n" + result.errors.join("\n") : ""),
    );
  }
  /** 自动检查无变化保持安静，相同缺失年度提示不重复弹出 */
  async checkRollover(): Promise<void> {
    if (this.stopped || this.repository.progress.active) return;
    // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
    const result = await this.rollover.run();
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const error = result.errors.join("\n");
    if (result.changed || result.skipped || (error && error !== this.lastError))
      this.showResult(result, "未完成事项流转");
    this.lastError = error;
  }
  /** 本地午夜而非固定二十四小时调度 */
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
  /** 更新独立计时状态栏 */
  private updateStatus(): void {
    if (!this.statusEl) return;
    // 读取当前运行阶段，驱动计时文字与交互状态
    const state = this.timer.snapshot();
    this.statusEl.hidden = !this.preferences.timerEnabled;
    this.statusEl.textContent =
      "◷ " +
      (state.mode === "focus" ? "专注" : "休息") +
      " " +
      timerLabel(state.seconds) +
      (state.status === "paused" ? " · 暂停" : "");
  }
  /** 设置校验与保存失败回退，范围切换不搬文档 */
  async configure(patch: Partial<Preferences>): Promise<void> {
    if (patch.folder !== undefined) patch.folder = safeFolder(patch.folder);
    if (
      patch.maxRollovers !== undefined &&
      (!Number.isInteger(patch.maxRollovers) || patch.maxRollovers < 1)
    )
      throw new Error("最大流转次数应为正整数");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const key of ["focusMinutes", "breakMinutes"] as const)
      if (patch[key] !== undefined && !validMinutes(patch[key]))
        throw new Error("时长应为 1—240 的整数分钟");
    // 保存修改前的事实快照，失败时恢复或验证变化边界
    const previous = structuredClone(this.preferences);
    Object.assign(this.preferences, patch);
    try {
      await this.save();
    } catch (error) {
      this.preferences = previous;
      throw error;
    }
    if (
      previous.folder !== this.preferences.folder ||
      previous.limitToFolder !== this.preferences.limitToFolder
    )
      await this.repository.configure(
        this.preferences.folder,
        this.preferences.limitToFolder,
      );
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
    if (patch.rolloverMode !== undefined || patch.maxRollovers !== undefined)
      await this.checkRollover();
  }
  /** 常用命令严格保留五条 */
  private commands(): void {
    // 统一注册宿主命令及异常出口，不增加业务测试分支
    const command = (
      id: string,
      name: string,
      operation: () => Promise<void>,
    ): void => {
      this.addCommand({
        id,
        name,
        callback: () => {
          void operation().catch((error) => this.notify(String(error)));
        },
      });
    };
    command("open-sidebar", "打开侧栏日历", () => this.openCalendar(true));
    command("open-calendar", "打开大屏日历", () => this.openCalendar(false));
    command("roll-to-today", "将此前所有未完成待办移到今天", async () =>
      this.showResult(await this.rollover.moveToToday(), "手动移到今天"),
    );
    command("complete-today", "完成今日所有待办", async () =>
      this.showResult(await this.rollover.completeToday(), "完成今日所有待办"),
    );
    command("open-inbox", "查看待办箱", () =>
      this.openCalendar(true, true, true),
    );
  }
  /** 停止插件资源，保留宿主管理的面板位置供重新启用恢复 */
  onunload(): void {
    this.stopped = true;
    if (this.midnight !== null) window.clearTimeout(this.midnight);
    this.repository?.dispose();
    this.timer?.changes.clear();
    if (this.audio) void this.audio.close();
  }
}
/** 日历宿主，大屏和侧栏组件完全一致 */
class CalendarView extends ItemView {
  /** 当前订阅实例 */
  private panel: CalendarPanel | null = null;
  /** 页签布局和入口 */
  private state: { compact: boolean; inbox: boolean } = {
    compact: false,
    inbox: false,
  };
  /** 注入共享服务 */
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: DaymarkPlugin,
  ) {
    super(leaf);
  }
  /** 保持原视图身份 */
  getViewType(): string {
    return CALENDAR_VIEW;
  }
  /** 页签标题 */
  getDisplayText(): string {
    return "Daymark · 重要事项日历";
  }
  /** 页签图标 */
  getIcon(): string {
    return "calendar-days";
  }
  /** 恢复侧栏或待办箱入口 */
  async setState(
    state: { compact?: boolean; inbox?: boolean },
    result: { history: boolean },
  ): Promise<void> {
    this.state = {
      compact: Boolean(state.compact),
      inbox: Boolean(state.inbox),
    };
    await super.setState(state, result);
    this.panel?.dispose();
    this.panel = new CalendarPanel(this.contentEl, this.plugin, this.state);
  }
  /** 宿主判断是否已有侧栏页签 */
  getState(): { compact: boolean; inbox: boolean } {
    return this.state;
  }
  /** 挂载月历 */
  async onOpen(): Promise<void> {
    this.panel?.dispose();
    this.panel = new CalendarPanel(this.contentEl, this.plugin, this.state);
  }
  /** 关闭仅清理当前视图 */
  async onClose(): Promise<void> {
    this.panel?.dispose();
    this.panel = null;
  }
}
/** 独立番茄钟面板 */
class FocusView extends ItemView {
  /** 当前共享计时订阅 */
  private panel: TimerPanel | null = null;
  /** 注入服务 */
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: DaymarkPlugin,
  ) {
    super(leaf);
  }
  /** 视图类型 */
  getViewType(): string {
    return TIMER_VIEW;
  }
  /** 页签名称 */
  getDisplayText(): string {
    return "Daymark · 番茄钟";
  }
  /** 页签图标 */
  getIcon(): string {
    return "timer";
  }
  /** 面板不创建自己的计时器 */
  async onOpen(): Promise<void> {
    this.panel = new TimerPanel(this.contentEl, this.plugin);
  }
  /** 关面板仍继续计时 */
  async onClose(): Promise<void> {
    this.panel?.dispose();
    this.panel = null;
  }
}
/** 阅读视图与实时预览共用日历资源 */
class EmbeddedCalendar extends MarkdownRenderChild {
  /** 当前代码块组件 */
  private panel: CalendarPanel | null = null;
  /** 注入独立实例选项 */
  constructor(
    container: HTMLElement,
    private plugin: DaymarkPlugin,
    private options: CalendarOptions,
  ) {
    super(container);
  }
  /** 笔记显示时挂载 */
  onload(): void {
    this.panel = new CalendarPanel(this.containerEl, this.plugin, this.options);
  }
  /** 重新渲染时取消订阅 */
  onunload(): void {
    this.panel?.dispose();
  }
}
/** 事项与番茄钟分开两张配置卡片 */
class DaymarkSettings extends PluginSettingTab {
  /** 绑定精简配置与迁移入口 */
  constructor(private plugin: DaymarkPlugin) {
    super(plugin.app, plugin);
  }
  /** 常用设置少量展示，高级能力折叠 */
  display(): void {
    this.containerEl.replaceChildren();
    // 读取统一事项集合，供当前视图筛选与分组展示
    const items = element(this.containerEl, "section", "daylane-settings-card");
    element(items, "h3", "", "重要事项");
    // 呈现单条事项详情与明确操作入口
    const row = (
      parent: HTMLElement,
      title: string,
      description: string,
    ): HTMLElement => {
      // 保存当前处理阶段的事实结果，供后续校验与展示
      const line = element(parent, "div", "daylane-setting");
      // 保存当前处理阶段的事实结果，供后续校验与展示
      const text = element(line, "div", "daylane-setting-text");
      element(text, "strong", "", title);
      if (description) element(text, "small", "", description);
      return line;
    };
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const preferences = this.plugin.getPreferences();
    // 读取用户指定目录，限定索引与迁移范围
    const folder = element(
      row(
        items,
        "事项目录",
        "新文档写入此目录；目录限制开启时读取此目录及子目录。",
      ),
      "input",
      "daylane-setting-control",
    );
    folder.value = preferences.folder;
    folder.setAttribute("aria-label", "事项目录");
    folder.addEventListener("change", () => {
      void this.plugin.configure({ folder: folder.value }).catch((error) => {
        folder.value = this.plugin.getPreferences().folder;
        this.plugin.notify(String(error));
      });
    });
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const rule = element(
      row(
        items,
        "自动流转日期规则",
        "未完成历史事项自动移到下一日期；累计达到上限后入箱。",
      ),
      "select",
      "daylane-setting-control",
    );
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const [value, title] of [
      ["workday", "未完成事项移到下一个工作日"],
      ["calendar", "未完成事项移到下一个自然日"],
    ]) {
      // 为受控输入添加合法选项，不猜测用户配置
      const option = element(rule, "option", "", title);
      option.value = value;
    }
    rule.value = preferences.rolloverMode;
    rule.addEventListener("change", () => {
      void this.plugin
        .configure({ rolloverMode: rule.value as Preferences["rolloverMode"] })
        .catch((error) => this.plugin.notify(String(error)));
    });
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const advanced = element(items, "details");
    element(advanced, "summary", "", "高级与实验性设置");
    // 创建统一开关操作，保持偏好和可见状态一致
    const toggle = (
      parent: HTMLElement,
      title: string,
      key: "limitToFolder" | "preserveOnDelete" | "timerEnabled" | "sound",
      description: string,
    ): void => {
      // 创建或读取可操作表单控件，保留尚未提交的输入
      const input = element(row(parent, title, description), "input");
      input.type = "checkbox";
      input.checked = preferences[key];
      input.setAttribute("aria-label", title);
      input.addEventListener("change", () => {
        void this.plugin
          .configure({ [key]: input.checked })
          .then(() => {
            if (key === "timerEnabled") this.display();
          })
          .catch((error) => {
            input.checked = this.plugin.getPreferences()[key];
            this.plugin.notify(String(error));
          });
      });
    };
    toggle(
      advanced,
      "仅扫描事项目录",
      "limitToFolder",
      "关闭后扫描整个 Vault；仍只识别专属标记，全库首扫有读取成本。",
    );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const number = (
      parent: HTMLElement,
      title: string,
      key: "maxRollovers" | "focusMinutes" | "breakMinutes",
      description: string,
    ): void => {
      // 创建或读取可操作表单控件，保留尚未提交的输入
      const input = element(
        row(parent, title, description),
        "input",
        "daylane-setting-control",
      );
      input.type = "number";
      input.min = "1";
      input.step = "1";
      if (key !== "maxRollovers") input.max = "240";
      input.value = String(preferences[key]);
      input.setAttribute("aria-label", title);
      input.addEventListener("change", () => {
        void this.plugin
          .configure({ [key]: Number(input.value) })
          .catch((error) => {
            input.value = String(this.plugin.getPreferences()[key]);
            this.plugin.notify(String(error));
          });
      });
    };
    number(
      advanced,
      "最大自动流转次数",
      "maxRollovers",
      "默认允许 5 次，第 6 次入箱；手动改期、入箱、完成均不清零次数。",
    );
    toggle(
      advanced,
      "删除重要事项时保留文档（实验性）",
      "preserveOnDelete",
      "仅移除四个专属 YAML 属性；关闭时删除整篇文档到回收站。",
    );
    button(
      advanced,
      "预览旧事项迁移",
      () => this.plugin.migrate(),
      this.plugin.notify,
    );
    // 建立独立计时状态机，不依赖事项数据
    const timer = element(this.containerEl, "section", "daylane-settings-card");
    element(timer, "h3", "", "独立番茄钟");
    toggle(
      timer,
      "启用独立番茄钟",
      "timerEnabled",
      "与事项无关联，通过侧边图标或状态栏打开。",
    );
    if (preferences.timerEnabled) {
      number(
        timer,
        "专注时长（分钟）",
        "focusMinutes",
        "默认 25，允许 1—240 的整数；不打断当前轮。",
      );
      number(timer, "休息时长（分钟）", "breakMinutes", "默认 5，允许自定义。");
      toggle(
        timer,
        "到时播放短提示音",
        "sound",
        "默认开启，本地生成短音，失败仍有文字通知。",
      );
    }
  }
}
