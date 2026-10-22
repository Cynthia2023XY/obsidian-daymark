import { setIcon } from "obsidian";
import { Preferences } from "./domain";
import { button, element, TimerPanel, timerLabel, UiHost } from "./ui";

/** 悬浮入口复用计时与配置，避免创建另一轮计时 */
export interface FloatingTimerHost extends UiHost {
  /** 拖动和收起后立即持久化展示偏好 */
  configure(patch: Partial<Preferences>): Promise<void>;
}

/** 常驻迷你条与状态栏共用同一计时，展开时才创建控制面板 */
export class FloatingTimer {
  /** 当前窗口中的常驻容器 */
  private root: HTMLElement;
  /** 可展开的时间文字 */
  private label: HTMLButtonElement;
  /** 倒计时文字独立刷新，保留左侧的单色番茄图标 */
  private labelText: HTMLElement;
  /** 不展开面板即可暂停或继续 */
  private toggle: HTMLButtonElement;
  /** 状态栏时间入口 */
  private statusLabel: HTMLButtonElement;
  /** 状态栏暂停或继续入口 */
  private statusToggle: HTMLButtonElement;
  /** 展开的详细控制区域 */
  private detail: HTMLElement;
  /** 控制区只在展开期间订阅共享状态 */
  private panel: TimerPanel | null = null;
  /** 横向相对位置，窗口变化后仍留在屏幕内 */
  private x: number | null;
  /** 纵向相对位置，窗口变化后仍留在屏幕内 */
  private y: number | null;
  /** 当前拖动的指针与初始位置 */
  private drag: { id: number; dx: number; dy: number; moved: boolean } | null =
    null;
  /** 所属窗口，跟随主工作区生命周期 */
  private win: Window;
  /** 全局监听及共享订阅的释放回调 */
  private cleanups: (() => void)[] = [];

  /** 挂载固定悬浮条，不创建或拆分工作区叶子 */
  constructor(
    private workspace: HTMLElement,
    private status: HTMLElement,
    private host: FloatingTimerHost,
  ) {
    this.win = workspace.ownerDocument.defaultView!;
    this.x = host.getPreferences().timerFloatingX;
    this.y = host.getPreferences().timerFloatingY;
    this.root = element(workspace, "section", "daylane-floating-timer");
    this.root.setAttribute("aria-label", "迷你番茄钟");
    // 拖动手柄与操作按钮分开，避免暂停时误移动
    const bar = element(this.root, "div", "daylane-floating-bar");
    // 手柄仅负责定位，所有功能仍可通过键盘按钮操作
    const handle = element(bar, "span", "daylane-floating-handle", "⠿");
    handle.title = "拖动番茄钟，位置自动保存";
    handle.setAttribute("aria-hidden", "true");
    this.label = button(
      bar,
      "",
      () => this.expand(!this.panel),
      host.notify,
      "daylane-floating-label",
    );
    this.label.setAttribute("aria-expanded", "false");
    // 用固定矢量轮廓替代系统彩色表情，统一主题下的线条风格
    const tomato = this.label.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    tomato.classList.add("daylane-floating-tomato");
    tomato.setAttribute("viewBox", "0 0 24 24");
    tomato.setAttribute("fill", "none");
    tomato.setAttribute("stroke", "currentColor");
    tomato.setAttribute("stroke-width", "1.8");
    tomato.setAttribute("stroke-linecap", "round");
    tomato.setAttribute("stroke-linejoin", "round");
    tomato.setAttribute("aria-hidden", "true");
    // 果实轮廓、叶片和短茎共同保留番茄的识别特征
    const outline = this.label.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    outline.setAttribute(
      "d",
      "M7 7C4.5 7 3 9.2 3 12.2 3 17.2 7 21 12 21s9-3.8 9-8.8C21 9.2 19.5 7 17 7M12 7V3M12 7 8 5l1 4 3-2 3 2 1-4-4 2",
    );
    tomato.append(outline);
    this.label.append(tomato);
    this.labelText = element(this.label, "span", "daylane-floating-time");
    this.toggle = button(
      bar,
      "",
      () => this.toggleTimer(),
      host.notify,
      "daylane-floating-toggle",
    );
    // 额外入口明确展示为收起，而不结束计时
    const minimize = button(
      bar,
      "−",
      () => host.configure({ timerFloatingHidden: true }),
      host.notify,
      "daylane-floating-minimize",
    );
    minimize.setAttribute("aria-label", "收起到状态栏");
    minimize.title = "收起到状态栏，继续计时";
    this.detail = element(this.root, "div", "daylane-floating-detail");
    this.detail.hidden = true;
    this.statusLabel = button(
      status,
      "",
      () => this.show(),
      host.notify,
      "daylane-status-label",
    );
    this.statusLabel.title = "显示迷你番茄钟";
    this.statusToggle = button(
      status,
      "",
      () => this.toggleTimer(),
      host.notify,
      "daylane-status-toggle",
    );
    this.listen(handle, "pointerdown", (event) => {
      // 仅允许主指针拖动，不劫持右键菜单
      const pointer = event as PointerEvent;
      if (pointer.button !== 0) return;
      this.expand(false);
      // 展开面板可能改变宽度，先回到迷你条位置
      const rect = this.root.getBoundingClientRect();
      this.drag = {
        id: pointer.pointerId,
        dx: pointer.clientX - rect.left,
        dy: pointer.clientY - rect.top,
        moved: false,
      };
      pointer.preventDefault();
    });
    this.listen(this.win, "pointermove", (event) => {
      // 窗口级监听允许拖出手柄后继续移动
      const pointer = event as PointerEvent;
      if (!this.drag || this.drag.id !== pointer.pointerId) return;
      this.drag.moved = true;
      // 将鼠标位置归一化，持久化后适配不同窗口尺寸
      const bounds = this.bounds();
      this.x = Math.max(
        0,
        Math.min(1, (pointer.clientX - this.drag.dx - 8) / bounds.x),
      );
      this.y = Math.max(
        0,
        Math.min(1, (pointer.clientY - this.drag.dy - 56) / bounds.y),
      );
      this.position();
    });
    this.listen(this.win, "pointerup", (event) => {
      if (!this.drag || this.drag.id !== (event as PointerEvent).pointerId)
        return;
      // 只在放下时保存，避免每个移动事件写磁盘
      const moved = this.drag.moved;
      this.drag = null;
      if (moved)
        void host
          .configure({ timerFloatingX: this.x, timerFloatingY: this.y })
          .catch((error) => host.notify(String(error)));
    });
    this.listen(this.win, "pointercancel", () => {
      this.drag = null;
    });
    this.listen(this.win, "blur", () => {
      this.drag = null;
    });
    this.listen(this.win, "resize", () => this.position());
    this.listen(workspace.ownerDocument, "pointerdown", (event) => {
      if (this.panel && !event.composedPath().includes(this.root))
        this.expand(false);
    });
    this.listen(workspace.ownerDocument, "keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && this.panel) {
        this.expand(false);
        this.label.focus();
      }
    });
    this.cleanups.push(host.timer.changes.subscribe(() => this.update()));
    this.update();
    // 宿主可能在插件加载后才注入样式，尺寸稳定后重新夹紧位置
    if (typeof ResizeObserver !== "undefined") {
      // 同时处理主题字号和展开内容尺寸变化，不依赖计时是否运行
      const observer = new ResizeObserver(() => this.position());
      observer.observe(this.root);
      this.cleanups.push(() => observer.disconnect());
    }
  }

  /** 所有窗口级监听在插件卸载时成对移除 */
  private listen(
    target: EventTarget,
    name: string,
    callback: EventListener,
  ): void {
    target.addEventListener(name, callback);
    this.cleanups.push(() => target.removeEventListener(name, callback));
  }

  /** 暂停或继续都操作共享服务，完成后沿用默认时长手动开始 */
  private toggleTimer(): void {
    if (!this.host.getPreferences().timerEnabled) return;
    // 当前生命周期决定按钮动作，切换展示不改变计时
    const state = this.host.timer.snapshot();
    if (state.status === "running") this.host.timer.pause();
    else {
      if (state.status === "finished")
        this.host.timer.select(
          state.mode,
          state.mode === "focus"
            ? this.host.getPreferences().focusMinutes
            : this.host.getPreferences().breakMinutes,
        );
      this.host.prepareSound();
      this.host.timer.start();
    }
  }

  /** 从状态栏和工具栏恢复迷你条，无需重新打开侧栏 */
  async show(): Promise<void> {
    await this.host.configure({ timerFloatingHidden: false });
    this.label.focus();
  }

  /** 详细操作按需展开，关闭只移除界面订阅 */
  private expand(open: boolean): void {
    if (open && !this.panel)
      this.panel = new TimerPanel(this.detail, this.host);
    else if (!open) {
      this.panel?.dispose();
      this.panel = null;
    }
    this.detail.hidden = !open;
    this.root.classList.toggle("is-expanded", open);
    this.label.setAttribute("aria-expanded", String(open));
    this.position();
  }

  /** 统一约束在标题栏和状态栏之间，避免窗口缩小时丢失入口 */
  private bounds(): { x: number; y: number } {
    return {
      x: Math.max(1, this.win.innerWidth - (this.root.offsetWidth || 216) - 16),
      y: Math.max(
        1,
        this.win.innerHeight - (this.root.offsetHeight || 36) - 96,
      ),
    };
  }

  /** 初次贴编辑区右上角，拖动后按比例恢复并夹紧到窗口内 */
  private position(): void {
    // 未自定义位置时跟随编辑区默认边缘
    const editor = this.workspace
      .querySelector(".workspace-split.mod-root")
      ?.getBoundingClientRect();
    // 可移动空间扣除悬浮控件的实际尺寸
    const bounds = this.bounds();
    this.root.style.left = `${8 + Math.max(0, Math.min(bounds.x, this.x === null ? (editor?.right || this.win.innerWidth) - (this.root.offsetWidth || 216) - 24 : this.x * bounds.x))}px`;
    this.root.style.top = `${56 + Math.max(0, Math.min(bounds.y, this.y === null ? Math.max(0, (editor?.top || 56) - 40) : this.y * bounds.y))}px`;
  }

  /** 每秒仅更新文字，输入框和按钮焦点不会被重建 */
  update(): void {
    // 界面偏好与计时快照独立读取，收起不停止计时
    const preferences = this.host.getPreferences();
    // 读取共享计时的最新事实
    const state = this.host.timer.snapshot();
    // 结束和暂停状态明确显示，不自动切换下一轮
    const text = `${state.mode === "focus" ? "专注" : "休息"} ${timerLabel(state.seconds)}${state.status === "paused" ? " · 暂停" : state.status === "finished" ? " · 完成" : ""}`;
    // 图标按钮配备可读名称，键盘和辅助工具都能识别
    const action =
      state.status === "running"
        ? "暂停"
        : state.status === "paused"
          ? "继续"
          : "开始";
    this.labelText.textContent = text;
    this.label.title = "展开或关闭番茄钟控制面板";
    this.statusLabel.textContent = `◷ ${text}`;
    // 两处控制入口始终操作同一轮计时
    for (const control of [this.toggle, this.statusToggle]) {
      if (control.getAttribute("aria-label") !== action)
        setIcon(control, state.status === "running" ? "pause" : "play");
      control.title = action;
      control.setAttribute("aria-label", action);
    }
    this.root.hidden =
      !preferences.timerEnabled || preferences.timerFloatingHidden;
    this.status.hidden = !preferences.timerEnabled;
    if (this.root.hidden) this.expand(false);
    this.position();
  }

  /** 卸载时清除悬浮 DOM、详细面板和所有全局监听 */
  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
    // 订阅和全局事件必须随插件卸载一起移除
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.root.remove();
    this.status.replaceChildren();
  }
}
