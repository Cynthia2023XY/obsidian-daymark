import {
  Item,
  localDay,
  monthDays,
  Preferences,
  shiftMonth,
  validDay,
} from "./domain";
import { HolidayService } from "./holidays";
import { ItemRepository } from "./repository";
import { TimerMode, TimerService, validMinutes } from "./timer";

/** 视图动作通过宿主公开 API 执行，日历无需依赖原插件 */
export interface UiHost {
  /** 共享单日事项仓库 */
  repository: ItemRepository;
  /** 中国正式假期服务 */
  holidays: HolidayService;
  /** 独立计时服务 */
  timer: TimerService;
  /** 当前配置 */
  getPreferences(): Preferences;
  /** 名称单输入框创建事项 */
  create(date?: string): void;
  /** 点击名称打开原文 */
  open(item: Item): Promise<void>;
  /** 删除或解除事项身份 */
  remove(item: Item): void;
  /** 只改变完成状态 */
  status(item: Item, status: Item["status"]): Promise<void>;
  /** 右键菜单承载手动改期，避免列表按钮堆叠 */
  context(item: Item, event: MouseEvent): void;
  /** 打开配置中的旧数据迁移预览 */
  migrate(): void;
  /** 可见错误出口 */
  notify(message: string): void;
  /** 用户手势初始化提示音 */
  prepareSound(): void;
}
/** 代码块、侧栏和独立页签只有布局及交互差别 */
export interface CalendarOptions {
  /** 初始月，实例之间独立 */
  month?: string;
  /** 是否允许写入 */
  interactive?: boolean;
  /** 侧栏紧凑尺寸 */
  compact?: boolean;
  /** 默认打开待办箱入口 */
  inbox?: boolean;
}
/** 安全文本 DOM 在所属窗口创建，不执行笔记内容 */
export function element<K extends keyof HTMLElementTagNameMap>(
  parent: HTMLElement,
  tag: K,
  className = "",
  content = "",
): HTMLElementTagNameMap[K] {
  // 通过安全文本方式创建界面节点，避免执行笔记内容
  const node = parent.ownerDocument.createElement(tag);
  node.className = className;
  node.textContent = content;
  parent.append(node);
  return node;
}
/** 按钮所有异步错误都返回用户可见提示 */
export function button(
  parent: HTMLElement,
  title: string,
  action: () => void | Promise<void>,
  report: (message: string) => void,
  className = "",
): HTMLButtonElement {
  // 通过安全文本方式创建界面节点，避免执行笔记内容
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
/** 参考图的红点月历与下方简洁复选事项列表 */
export class CalendarPanel {
  /** 实例展示月份 */
  private month: string;
  /** 选中日期，不改变其他日历实例 */
  private selected = localDay();
  /** 日历与待办箱切换，不额外打开设置弹窗 */
  private inboxPage: boolean;
  /** 事项订阅卸载函数 */
  private unsubscribe: () => void;
  /** 下方列表区域 */
  private detail: HTMLElement | null = null;
  /** 挂载共用样式与数据 */
  constructor(
    private root: HTMLElement,
    private host: UiHost,
    private options: CalendarOptions = {},
  ) {
    this.month = options.month ?? localDay().slice(0, 7);
    this.inboxPage = Boolean(options.inbox);
    this.unsubscribe = host.repository.changes.subscribe(() => this.render());
    this.render();
  }
  /** 保留日期格、红点和休班角标，不展示排期卡片 */
  render(): void {
    this.root.replaceChildren();
    this.root.className =
      "daylane-root" + (this.options.compact ? " daylane-compact" : "");
    if (this.host.repository.progress.active) {
      element(
        this.root,
        "p",
        "daylane-muted",
        "扫描事项 " +
          this.host.repository.progress.completed +
          "/" +
          this.host.repository.progress.total,
      );
    }
    if (this.inboxPage) {
      button(
        this.root,
        "‹ 返回日历",
        () => {
          this.inboxPage = false;
          this.render();
        },
        this.host.notify,
        "daylane-text-button",
      );
      this.detail = element(this.root, "section", "daylane-detail");
      this.renderList(this.detail, "待办箱", this.host.repository.inbox());
      if (this.options.interactive !== false)
        button(
          this.detail,
          "＋ 添加重要事项",
          () => this.host.create(),
          this.host.notify,
          "daylane-add",
        );
      return;
    }
    // 在日期格中区分日期选择与正式假期标记
    const header = element(this.root, "header", "daylane-nav");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const heading = button(
      header,
      "",
      () => {
        picker.hidden = !picker.hidden;
        if (!picker.hidden) picker.focus();
      },
      this.host.notify,
      "daylane-month-heading",
    );
    element(heading, "span", "", Number(this.month.slice(5)) + "月");
    element(heading, "span", "daylane-year", this.month.slice(0, 4));
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const navigation = element(header, "div", "daylane-navigation");
    // 保存修改前的事实快照，失败时恢复或验证变化边界
    const previous = button(
      navigation,
      "",
      () => {
        this.month = shiftMonth(this.month, -1);
        this.render();
      },
      this.host.notify,
      "daylane-nav-arrow",
    );
    previous.setAttribute("aria-label", "上个月");
    element(previous, "span", "daylane-chevron left");
    button(
      navigation,
      "今天",
      () => {
        this.selected = localDay();
        this.month = this.selected.slice(0, 7);
        this.render();
      },
      this.host.notify,
      "daylane-today-button",
    );
    // 计算后续日期或新路径，不沿用已失效的状态
    const next = button(
      navigation,
      "",
      () => {
        this.month = shiftMonth(this.month, 1);
        this.render();
      },
      this.host.notify,
      "daylane-nav-arrow",
    );
    next.setAttribute("aria-label", "下个月");
    element(next, "span", "daylane-chevron right");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const picker = element(this.root, "input", "daylane-month-picker");
    picker.type = "month";
    picker.value = this.month;
    picker.hidden = true;
    picker.setAttribute("aria-label", "选择月份");
    picker.addEventListener("change", () => {
      if (validDay(picker.value + "-01")) {
        this.month = picker.value;
        this.render();
      }
    });
    // 展示每周日期顺序，与用户周起始偏好一致
    const weekdays = element(this.root, "div", "daylane-weekdays");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const label of [
      "周一",
      "周二",
      "周三",
      "周四",
      "周五",
      "周六",
      "周日",
    ])
      element(weekdays, "span", "", label);
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const grid = element(this.root, "div", "daylane-grid");
    // 读取统一事项集合，供当前视图筛选与分组展示
    const items = this.host.repository.items();
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const date of monthDays(this.month, true)) {
      // 读取正式放假或调休标记，优先于普通星期规则
      const holiday = this.host.holidays.get(date);
      // 承载日期标记、假期信息与当天事项
      const day = element(grid, "button", "daylane-day");
      day.type = "button";
      day.dataset.date = date;
      day.setAttribute("aria-label", "选择 " + date);
      day.setAttribute("aria-pressed", String(date === this.selected));
      day.classList.toggle("is-outside", date.slice(0, 7) !== this.month);
      day.classList.toggle("is-today", date === localDay());
      day.classList.toggle("is-selected", date === this.selected);
      if (holiday) {
        day.classList.add(
          holiday.type === "holiday" ? "is-holiday" : "is-workday",
        );
        day.title = holiday.name;
      }
      element(day, "span", "daylane-day-number", String(Number(date.slice(8))));
      if (holiday)
        element(
          day,
          "span",
          "daylane-holiday " + holiday.type,
          holiday.type === "holiday" ? "休" : "班",
        );
      // 同一天只显示一组标记，高亮事项的蓝点与原有红点并排
      const datedItems = items.filter((item) => item.date === date);
      if (datedItems.length) {
        // 统一承载日期圆点，避免增加蓝点后挤压日期数字
        const dots = element(day, "span", "daylane-dots");
        element(dots, "span", "daylane-dot").setAttribute(
          "aria-label",
          "有事项",
        );
        if (datedItems.some((item) => item.highlighted))
          element(
            dots,
            "span",
            "daylane-dot daylane-highlight-dot",
          ).setAttribute("aria-label", "有高亮事项");
      }
      day.addEventListener("click", () => this.select(date));
      day.addEventListener("dblclick", () => {
        if (this.options.interactive !== false) this.host.create(date);
      });
    }
    if (!this.host.holidays.covered(this.month + "-01"))
      element(
        this.root,
        "p",
        "daylane-warning",
        this.month.slice(0, 4) + " 年正式节假日安排未收录",
      );
    this.detail = element(this.root, "section", "daylane-detail");
    this.renderDetail();
  }
  /** 单击不重建日期按钮，让双击仍可触发同一目标 */
  private select(date: string): void {
    this.selected = date;
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const cell of this.root.querySelectorAll<HTMLElement>(
      ".daylane-day",
    )) {
      cell.classList.toggle("is-selected", cell.dataset.date === date);
      cell.setAttribute("aria-pressed", String(cell.dataset.date === date));
    }
    this.renderDetail();
  }
  /** 选中日期列表与底部待办箱入口 */
  private renderDetail(): void {
    if (!this.detail) return;
    this.detail.replaceChildren();
    // 按本地自然日计算排期，避开 UTC 解析偏移
    const date = new Date(this.selected + "T12:00:00");
    this.renderList(
      this.detail,
      date.getFullYear() +
        " 年 " +
        (date.getMonth() + 1) +
        " 月 " +
        date.getDate() +
        " 日",
      this.host.repository
        .items()
        .filter((item) => item.date === this.selected),
    );
    if (this.options.interactive !== false)
      button(
        this.detail,
        "＋ 添加重要事项",
        () => this.host.create(this.selected),
        this.host.notify,
        "daylane-add",
      );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const inbox = this.host.repository
      .inbox()
      .filter((item) => item.status === "open").length;
    button(
      this.detail,
      "查看待办箱（" + inbox + "）",
      () => {
        this.inboxPage = true;
        this.render();
      },
      this.host.notify,
      "daylane-inbox-link",
    );
  }
  /** 每行只有复选框、标题与删除，手动流转放右键 */
  private renderList(parent: HTMLElement, title: string, items: Item[]): void {
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const heading = element(parent, "header", "daylane-list-header");
    element(heading, "h3", "", title);
    element(heading, "span", "", items.length + " 项重要事项");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const list = element(parent, "ul", "daylane-items");
    // 逐项处理当前业务集合，保留每项自己的状态与结果
    for (const item of items) {
      // 呈现单条事项详情与明确操作入口
      const row = element(
        list,
        "li",
        "daylane-item" + (item.status === "completed" ? " is-completed" : ""),
      );
      row.classList.toggle("is-highlighted", item.highlighted === true);
      // 保存当前处理阶段的事实结果，供后续校验与展示
      const check = element(row, "input", "daylane-checkbox");
      check.type = "checkbox";
      check.checked = item.status === "completed";
      check.disabled = this.options.interactive === false || item.legacy;
      check.setAttribute("aria-label", "完成 " + item.title);
      check.addEventListener("change", () => {
        check.disabled = true;
        this.host
          .status(item, check.checked ? "completed" : "open")
          .catch((error) => {
            check.checked = item.status === "completed";
            this.host.notify(String(error));
          })
          .finally(() => {
            check.disabled = this.options.interactive === false || item.legacy;
          });
      });
      button(
        row,
        item.title,
        () => this.host.open(item),
        this.host.notify,
        "daylane-item-title",
      );
      if (this.options.interactive !== false && !item.legacy) {
        button(
          row,
          "×",
          () => this.host.remove(item),
          this.host.notify,
          "daylane-delete",
        ).setAttribute("aria-label", "删除 " + item.title);
        row.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          this.host.context(item, event);
        });
      }
    }
  }
  /** 卸载不会清空共享仓库，只取消当前订阅 */
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
