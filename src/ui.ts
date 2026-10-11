import {
  addDays,
  COLORS,
  Item,
  localDay,
  monthDays,
  onDay,
  Preferences,
  shiftMonth,
  validDay,
} from "./domain";
import { HolidayService } from "./holidays";
import { ItemRepository } from "./repository";
import { TimerMode, TimerService, validMinutes } from "./timer";

/** 页面动作由宿主实现，日历与番茄钟不直接依赖 Obsidian */
export interface UiHost {
  /** 共享事项仓库 */
  repository: ItemRepository;
  /** 共享正式节假日查询 */
  holidays: HolidayService;
  /** 插件级独立计时器 */
  timer: TimerService;
  /** 读取最新偏好 */
  getPreferences(): Preferences;
  /** 打开新建或编辑表单 */
  edit(date: string, item?: Item): void;
  /** 打开事项 Markdown 笔记 */
  open(item: Item): Promise<void>;
  /** 删除前展示确认 */
  trash(item: Item): void;
  /** 修改状态后检查需要流转的重新打开项 */
  status(item: Item, status: Item["status"]): Promise<void>;
  /** 保存表单后检查过期待办是否需要立即流转 */
  afterEdit(): Promise<void>;
  /** 对用户显示异常或完成提示 */
  notify(message: string): void;
  /** 由用户手势提前启用可选提示音 */
  prepareSound(): void;
}
/** 内嵌日历可覆盖的实例配置 */
export interface CalendarOptions {
  /** 实例初始月份 */
  month?: string;
  /** 指定项目过滤；空值显示全部 */
  project?: string;
  /** 展示中国假期与补班 */
  showHolidays?: boolean;
  /** 展示完成和取消事项 */
  showCompleted?: boolean;
  /** 是否允许修改事项 */
  interactive?: boolean;
  /** 侧栏启用紧凑布局 */
  compact?: boolean;
}
/** 创建安全的文本 DOM，不将笔记内容当作 HTML */
export function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className = "",
  content = "",
): HTMLElementTagNameMap[K] {
  // 使用容器所属文档，兼容 Obsidian 弹出窗口
  const node = parent.ownerDocument.createElement(tag);
  node.className = className;
  node.textContent = content;
  parent.append(node);
  return node;
}
/** 按钮与异常出口统一，避免未处理 Promise */
export function button(
  parent: HTMLElement,
  title: string,
  action: () => void | Promise<void>,
  report: (message: string) => void,
  className = "",
): HTMLButtonElement {
  // 所有写操作异常回到用户可见提示
  const node = element(parent, "button", className, title);
  node.type = "button";
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    Promise.resolve()
      .then(action)
      .catch((error) =>
        report(error instanceof Error ? error.message : String(error)),
      );
  });
  return node;
}
/** 日期与颜色安全处理后的日历事项标记 */
function itemClass(item: Item): string {
  return `daylane-chip daylane-color-${COLORS.includes(item.color as (typeof COLORS)[number]) ? item.color : "blue"}${item.status === "open" ? "" : " is-completed"}`;
}
/** 六周月历与当天事项列表，实例选择状态彼此独立 */
export class CalendarPanel {
  /** 当前实例月份 */
  private month: string;
  /** 当前实例选中的日期 */
  private selected = localDay();
  /** 当前项目筛选 */
  private project: string;
  /** 当前状态过滤 */
  private status = "all";
  /** 投屏时关闭修改操作 */
  private interactive: boolean;
  /** 事项变化订阅的卸载函数 */
  private unsubscribe: () => void;
  /** 当天详情区域，选择日期时单独刷新 */
  private detail: HTMLElement | null = null;
  /** 挂载独立实例并共享事项事实 */
  constructor(
    private root: HTMLElement,
    private host: UiHost,
    private options: CalendarOptions = {},
  ) {
    this.month = options.month ?? localDay().slice(0, 7);
    this.project = options.project ?? "";
    this.interactive = options.interactive ?? true;
    this.unsubscribe = host.repository.changes.subscribe(() => this.render());
    this.render();
  }
  /** 从统一仓库获得该实例可展示的事项 */
  private visibleItems(): Item[] {
    return this.host.repository
      .items()
      .filter(
        (item) =>
          (!this.project || item.project === this.project) &&
          ((this.options.showCompleted ??
            this.host.getPreferences().showCompleted) ||
            item.status === "open") &&
          (this.status === "all" || item.status === this.status),
      );
  }
  /** 构建月份导航、假期标记与事项格子 */
  render(): void {
    this.root.replaceChildren();
    this.root.className = `daylane-root${this.options.compact ? " daylane-compact" : ""}`;
    // 每个视图共享偏好但不共享月份与选中日期
    const settings = this.host.getPreferences();
    // 组织月份导航与筛选入口，避免日期格内堆叠操作
    const toolbar = element(this.root, "div", "daylane-toolbar");
    button(
      toolbar,
      "‹ 上月",
      () => {
        this.month = shiftMonth(this.month, -1);
        this.render();
      },
      this.host.notify,
    );
    // 提供明确月份选择，不自动改写笔记内配置
    const monthInput = element(toolbar, "input");
    monthInput.type = "month";
    monthInput.value = this.month;
    monthInput.setAttribute("aria-label", "查看月份");
    monthInput.addEventListener("change", () => {
      if (validDay(`${monthInput.value}-01`)) {
        this.month = monthInput.value;
        this.render();
      }
    });
    button(
      toolbar,
      "下月 ›",
      () => {
        this.month = shiftMonth(this.month, 1);
        this.render();
      },
      this.host.notify,
    );
    button(
      toolbar,
      "今天",
      () => {
        this.month = localDay().slice(0, 7);
        this.selected = localDay();
        this.render();
      },
      this.host.notify,
    );
    // 项目和状态筛选属于当前视图，不写进笔记
    const projects = element(toolbar, "select");
    projects.setAttribute("aria-label", "项目筛选");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const project of new Set([
      "",
      ...this.host.repository
        .items()
        .map((item) => item.project)
        .filter(Boolean),
      this.project,
    ])) {
      // 为受控输入添加合法选项，不猜测用户配置
      const option = element(projects, "option", "", project || "全部项目");
      option.value = project;
    }
    projects.value = this.project;
    projects.addEventListener("change", () => {
      this.project = projects.value;
      this.render();
    });
    // 提供事项状态筛选，区分未完成、完成与取消
    const states = element(toolbar, "select");
    states.setAttribute("aria-label", "状态筛选");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const [value, label] of [
      ["all", "全部状态"],
      ["open", "未完成"],
      ["completed", "已完成"],
      ["cancelled", "已取消"],
    ]) {
      // 为受控输入添加合法选项，不猜测用户配置
      const option = element(states, "option", "", label);
      option.value = value;
    }
    states.value = this.status;
    states.addEventListener("change", () => {
      this.status = states.value;
      this.render();
    });
    if (this.options.interactive !== false)
      button(
        toolbar,
        this.interactive ? "展示模式" : "退出展示",
        () => {
          this.interactive = !this.interactive;
          this.render();
        },
        this.host.notify,
      );
    if (this.interactive)
      button(
        toolbar,
        "＋ 新建事项",
        () => this.host.edit(this.selected),
        this.host.notify,
        "mod-cta",
      );
    if (!this.host.holidays.covered(`${this.month}-01`))
      element(
        this.root,
        "p",
        "daylane-warning",
        `${this.month.slice(0, 4)} 年正式节假日安排未收录，工作日自动流转将暂缓。`,
      );
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const message of [...this.host.repository.issues]
      .map(([path, message]) => `${path}：${message}`)
      .concat(this.host.repository.conflicts()))
      element(this.root, "p", "daylane-warning", message);
    // 安排日历和详情区域，随容器宽度切换布局
    const layout = element(this.root, "div", "daylane-layout");
    // 承载月历日期与跨周事项片段
    const calendar = element(layout, "div", "daylane-month");
    // 展示每周日期顺序，与用户周起始偏好一致
    const weekdays = element(calendar, "div", "daylane-weekdays");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const label of settings.mondayFirst
      ? ["一", "二", "三", "四", "五", "六", "日"]
      : ["日", "一", "二", "三", "四", "五", "六"])
      element(weekdays, "div", "", label);
    // 构造当前月的完整周范围，覆盖相邻月份边界
    const days = monthDays(this.month, settings.mondayFirst);
    // 读取统一事项集合，供当前视图筛选与分组展示
    const items = this.visibleItems();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (let index = 0; index < days.length; index += 7)
      this.renderWeek(calendar, days.slice(index, index + 7), items);
    this.detail = element(layout, "aside", "daylane-detail");
    this.renderDetail();
  }
  /** 同一周的日期格与跨日条带共同使用七列布局 */
  private renderWeek(
    calendar: HTMLElement,
    days: string[],
    items: Item[],
  ): void {
    // 日期格展示单日事项，跨日事项通过独立连续条带展示
    const week = element(calendar, "div", "daylane-week");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const date of days) {
      // 承载日期标记、假期信息与当天事项
      const day = element(
        week,
        "div",
        `daylane-day${date.slice(0, 7) !== this.month ? " is-outside" : ""}${date === localDay() ? " is-today" : ""}${date === this.selected ? " is-selected" : ""}`,
      );
      day.dataset.date = date;
      // 在日期格中区分日期选择与正式假期标记
      const header = element(day, "div", "daylane-day-heading");
      // 为日期提供可聚焦选择入口
      const dateButton = button(
        header,
        String(Number(date.slice(8))),
        () => this.select(date),
        this.host.notify,
        "daylane-date-button",
      );
      dateButton.setAttribute("aria-label", `选择 ${date}`);
      // 读取正式放假或调休标记，优先于普通星期规则
      const holiday = this.host.holidays.get(date);
      if (
        holiday &&
        (this.options.showHolidays ?? this.host.getPreferences().showHolidays)
      ) {
        // 明确展示休假与补班，避免把周末当作法定假期
        const badge = element(
          header,
          "span",
          `daylane-holiday ${holiday.type}`,
          holiday.type === "holiday" ? "休" : "班",
        );
        badge.title = holiday.name;
        element(day, "div", "daylane-holiday-name", holiday.name);
      } else if ([0, 6].includes(new Date(`${date}T12:00:00`).getDay()))
        day.classList.add("is-weekend");
      day.addEventListener("click", () => this.select(date));
      day.addEventListener("dblclick", (event) => {
        if (
          this.interactive &&
          !(event.target as HTMLElement).closest(".daylane-chip")
        )
          this.host.edit(date);
      });
      // 筛选单日事项，跨日事项由独立条带展示
      const daily = items.filter(
        (item) =>
          onDay(item, date) &&
          (item.kind === "todo" || item.start === item.end),
      );
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (const item of daily.slice(0, this.options.compact ? 1 : 3)) {
        // 渲染安全可点击的事项标题，并保存对应业务对象
        const chip = button(
          day,
          `${item.status === "completed" ? "✓ " : item.status === "cancelled" ? "× " : ""}${item.title}`,
          () => {
            this.select(date);
            if (this.interactive) this.host.edit(date, item);
          },
          this.host.notify,
          itemClass(item),
        );
        chip.title = `${item.title}${item.deadline && item.deadline < localDay() && item.status === "open" ? " · 已逾期" : ""}`;
      }
      if (daily.length > (this.options.compact ? 1 : 3))
        button(
          day,
          `还有 ${daily.length - (this.options.compact ? 1 : 3)} 项`,
          () => this.select(date),
          this.host.notify,
          "daylane-more",
        );
    }
    // 按区间分配最早可用行，跨周片段仍引用同一个事项
    const lanes: number[][] = [];
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of items
      .filter(
        (item) =>
          item.kind === "event" &&
          item.start !== item.end &&
          item.start! <= days[6] &&
          item.end! >= days[0],
      )
      .sort((a, b) => a.start!.localeCompare(b.start!))) {
      // 记录有效开始日期或周内起点，决定排期范围
      const start = days.findIndex((date) => date >= item.start!);
      // 记录包含当天的结束日期或周内终点
      const end = days.filter((date) => date <= item.end!).length;
      // 定位最早可用展示行，跨周片段仍引用同一事项
      let lane = lanes.findIndex((occupied) =>
        occupied.every((column) => column < start || column >= end),
      );
      if (lane < 0) {
        lane = lanes.length;
        lanes.push([]);
      }
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (let column = start; column < end; column++) lanes[lane].push(column);
      // 渲染安全可点击的事项标题，并保存对应业务对象
      const chip = button(
        week,
        `${item.start! < days[0] ? "← " : ""}${item.title}${item.end! > days[6] ? " →" : ""}`,
        () => {
          this.select(days[start]);
          if (this.interactive) this.host.edit(days[start], item);
        },
        this.host.notify,
        `${itemClass(item)} daylane-span`,
      );
      chip.style.setProperty("--daylane-start", String(start + 1));
      chip.style.setProperty("--daylane-end", String(end + 1));
      chip.style.setProperty("--daylane-row", String(lane + 2));
      chip.title = `${item.title} · ${item.start} — ${item.end}`;
    }
  }
  /** 日期选择只更新详情，不破坏双击事件目标 */
  private select(date: string): void {
    this.selected = date;
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const cell of this.root.querySelectorAll<HTMLElement>(".daylane-day"))
      cell.classList.toggle("is-selected", cell.dataset.date === date);
    this.renderDetail();
  }
  /** 展示选中日期、今天待办和遗留待办 */
  private renderDetail(): void {
    if (!this.detail) return;
    this.detail.replaceChildren();
    // 读取统一事项集合，供当前视图筛选与分组展示
    const items = this.visibleItems();
    this.renderList(
      this.detail,
      `${this.selected} 的事项`,
      items.filter((item) => onDay(item, this.selected)),
    );
    if (this.selected !== localDay())
      this.renderList(
        this.detail,
        "今天待办",
        items.filter(
          (item) =>
            item.kind === "todo" &&
            item.status === "open" &&
            item.scheduled === localDay(),
        ),
      );
    this.renderList(
      this.detail,
      "此前未完成",
      items.filter(
        (item) =>
          item.kind === "todo" &&
          item.status === "open" &&
          item.scheduled! < localDay(),
      ),
    );
  }
  /** 详情操作不要求在日期格中塞入多个按钮 */
  private renderList(parent: HTMLElement, title: string, items: Item[]): void {
    // 分组展示选中日期、今天与此前未完成事项
    const section = element(parent, "section", "daylane-list");
    element(section, "h3", "", `${title}（${items.length}）`);
    if (!items.length) element(section, "p", "daylane-muted", "暂无事项");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of items) {
      // 呈现单条事项详情与明确操作入口
      const row = element(section, "div", "daylane-item");
      element(
        row,
        "strong",
        item.status === "open" ? "" : "is-completed",
        item.title,
      );
      element(
        row,
        "div",
        "daylane-muted",
        `${item.kind === "todo" ? `待办 · ${item.scheduled}` : `${item.start} — ${item.end}`}${item.project ? ` · ${item.project}` : ""}`,
      );
      if (item.deadline)
        element(
          row,
          "div",
          item.deadline < localDay() && item.status === "open"
            ? "daylane-warning"
            : "daylane-muted",
          `截止 ${item.deadline}${item.deadline < localDay() && item.status === "open" ? " · 已逾期" : ""}`,
        );
      if (item.rolloverCount)
        element(
          row,
          "div",
          "daylane-muted",
          `原计划 ${item.originalScheduled ?? "未知"} · 已流转 ${item.rolloverCount} 次`,
        );
      // 组织用户显式操作，展示模式可整体隐藏
      const actions = element(row, "div", "daylane-actions");
      button(actions, "打开笔记", () => this.host.open(item), this.host.notify);
      if (!this.interactive) continue;
      button(
        actions,
        "编辑",
        () => this.host.edit(this.selected, item),
        this.host.notify,
      );
      button(
        actions,
        item.status === "open" ? "完成" : "重新打开",
        () =>
          this.host.status(item, item.status === "open" ? "completed" : "open"),
        this.host.notify,
      );
      if (item.status === "open")
        button(
          actions,
          "取消",
          () => this.host.status(item, "cancelled"),
          this.host.notify,
        );
      if (item.kind === "todo")
        button(
          actions,
          "移到明天",
          () =>
            this.host.repository.edit(item, {
              ...item,
              scheduled: addDays(localDay(), 1),
            }),
          this.host.notify,
        );
      button(actions, "删除", () => this.host.trash(item), this.host.notify);
    }
  }
  /** 宿主关闭时取消共享仓库订阅 */
  dispose(): void {
    this.unsubscribe();
    this.root.replaceChildren();
  }
}
/** 将计时秒数格式化为分钟和秒 */
export function timerLabel(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
/** 独立番茄钟面板，输入框不会被每秒刷新重建 */
export class TimerPanel {
  /** 上次显示的模式，用于区分用户选择与实际计时切换 */
  private lastMode: TimerMode | null = null;
  /** 上次本轮时长，用于刷新新的默认值而不覆盖临时输入 */
  private lastMinutes: number | null = null;
  /** 上次生命周期，完成后为下一轮加载默认时长 */
  private lastStatus = "";
  /** 多个面板共用计时变化订阅 */
  private unsubscribe: () => void;
  /** 当前时间展示 */
  private display: HTMLElement;
  /** 可见状态文字 */
  private state: HTMLElement;
  /** 本轮分钟输入 */
  private minutes: HTMLInputElement;
  /** 模式选择控件 */
  private mode: HTMLSelectElement;
  /** 开始与暂停按钮 */
  private toggle: HTMLButtonElement;
  /** 禁用提示与交互容器 */
  private controls: HTMLFieldSetElement;
  /** 挂载面板，实际计时由插件服务独立执行 */
  constructor(
    private root: HTMLElement,
    private host: UiHost,
  ) {
    root.classList.add("daylane-timer");
    root.replaceChildren();
    element(root, "h2", "", "独立番茄钟");
    element(
      root,
      "p",
      "daylane-muted",
      "不关联事项；切换模式会放弃当前轮。关闭或重载插件会停止计时。",
    );
    this.display = element(root, "div", "daylane-timer-display");
    this.display.setAttribute("role", "timer");
    this.state = element(root, "p", "daylane-muted");
    this.controls = element(root, "fieldset", "daylane-timer-controls");
    // 将番茄钟模式控件与中文说明关联
    const modeLabel = element(this.controls, "label", "", "模式 ");
    this.mode = element(modeLabel, "select");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const [value, label] of [
      ["focus", "专注"],
      ["break", "休息"],
    ]) {
      // 为受控输入添加合法选项，不猜测用户配置
      const option = element(this.mode, "option", "", label);
      option.value = value;
    }
    // 标记本轮分钟输入，不影响持久化默认值
    const minutesLabel = element(this.controls, "label", "", "本轮分钟 ");
    this.minutes = element(minutesLabel, "input");
    this.minutes.type = "number";
    this.minutes.min = "1";
    this.minutes.max = "240";
    this.minutes.step = "1";
    this.mode.addEventListener("change", () => {
      // 确定本轮专注或休息模式，与事项业务保持独立
      const mode = this.mode.value as TimerMode;
      host.timer.select(
        mode,
        mode === "focus"
          ? host.getPreferences().focusMinutes
          : host.getPreferences().breakMinutes,
      );
    });
    this.toggle = button(
      this.controls,
      "开始",
      () => {
        // 读取当前完整状态，用于一致展示或顺序持久化
        const snapshot = host.timer.snapshot();
        if (snapshot.status === "running") {
          host.timer.pause();
          return;
        }
        if (snapshot.status === "idle" || snapshot.status === "finished") {
          // 校验本轮分钟数，允许临时覆盖而不更改默认设置
          const minutes = Number(this.minutes.value);
          if (!validMinutes(minutes))
            throw new Error("时长应为 1—240 的整数分钟");
          host.timer.select(this.mode.value as TimerMode, minutes);
        }
        host.prepareSound();
        host.timer.start();
      },
      host.notify,
      "mod-cta",
    );
    button(
      this.controls,
      "重置",
      () => {
        this.minutes.value = String(host.timer.snapshot().minutes);
        host.timer.reset();
      },
      host.notify,
    );
    button(
      this.controls,
      "开始休息",
      () => {
        if (host.timer.snapshot().status !== "finished")
          throw new Error("当前轮尚未完成，可通过模式选择切换");
        host.timer.select("break", host.getPreferences().breakMinutes);
        host.prepareSound();
        host.timer.start();
      },
      host.notify,
    );
    this.unsubscribe = host.timer.changes.subscribe(() => this.update());
    this.update();
  }
  /** 只刷新时间文字与状态，保留用户尚未提交的输入 */
  update(): void {
    // 读取当前完整状态，用于一致展示或顺序持久化
    const snapshot = this.host.timer.snapshot();
    this.display.textContent = timerLabel(snapshot.seconds);
    this.controls.disabled = !this.host.getPreferences().timerEnabled;
    this.state.textContent = !this.host.getPreferences().timerEnabled
      ? "番茄钟已关闭，请在设置中启用"
      : `${snapshot.mode === "focus" ? "专注" : "休息"} · ${{ idle: "准备开始", running: "计时中", paused: "已暂停", finished: "已结束，请手动开始下一轮" }[snapshot.status]}`;
    this.toggle.textContent =
      snapshot.status === "running"
        ? "暂停"
        : snapshot.status === "paused"
          ? "继续"
          : "开始";
    this.minutes.disabled =
      snapshot.status === "running" || snapshot.status === "paused";
    if (snapshot.status === "running" || snapshot.status === "paused")
      this.minutes.value = String(snapshot.minutes);
    else if (snapshot.status === "finished" && this.lastStatus !== "finished")
      this.minutes.value = String(
        snapshot.mode === "focus"
          ? this.host.getPreferences().focusMinutes
          : this.host.getPreferences().breakMinutes,
      );
    else if (
      this.lastMode !== snapshot.mode ||
      this.lastMinutes !== snapshot.minutes ||
      !this.minutes.value
    )
      this.minutes.value = String(snapshot.minutes);
    this.mode.value = snapshot.mode;
    this.lastMode = snapshot.mode;
    this.lastMinutes = snapshot.minutes;
    this.lastStatus = snapshot.status;
  }
  /** 关闭面板不会停止共享计时 */
  dispose(): void {
    this.unsubscribe();
    this.root.replaceChildren();
  }
}
