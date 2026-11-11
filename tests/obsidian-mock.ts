import { parse } from "yaml";

/** 模拟宿主线性图标接口，保留按钮节点和交互监听 */
export function setIcon(element: HTMLElement, icon: string): void {
  // 使用安全的矢量节点模拟宿主绘制，不依赖字体表情符号
  const svg = element.ownerDocument.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  svg.setAttribute("data-icon", icon);
  element.replaceChildren(svg);
}

/** 记录通知文本，用于检查宿主错误出口 */
export const notices: string[] = [];
/** 测试中模拟公开通知接口 */
export class Notice {
  /** 保存用户能够看到的提示 */
  constructor(message: string) {
    notices.push(message);
  }
}
/** 文件身份只由模拟 Vault 边界生成 */
export class TFile {
  /** 模拟文件路径 */
  constructor(public path: string) {}
}
/** 模拟库内目录身份，供目录建议过滤文件 */
export class TFolder {
  /** 目录在笔记库中的相对路径 */
  constructor(public path: string) {}
}
/** 公开建议组件的最小宿主边界，实际键盘交互由 Obsidian 负责 */
export class AbstractInputSuggest<T> {
  /** 记录建议列表绑定的输入框 */
  constructor(_app: unknown, _input: HTMLInputElement) {}
  /** 测试不创建宿主浮层 */
  close(): void {}
}
/** 保持相对路径规则与宿主一致 */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
/** 使用 YAML 库替换 Obsidian 模块边界 */
export function parseYaml(source: string): unknown {
  return parse(source);
}
/** 宿主插件生命周期的最小测试替身 */
export class Plugin {
  /** 宿主保存的配置内容 */
  data: unknown = null;
  /** 模拟插件位置 */
  manifest = { dir: ".obsidian/plugins/daymark-chinese-calendar" };
  /** 视图创建工厂 */
  factories = new Map<string, (leaf: unknown) => unknown>();
  /** 注册的可执行命令 */
  registeredCommands: {
    id: string;
    callback?: () => void;
    editorCallback?: (editor: {
      replaceSelection: (text: string) => void;
    }) => void;
  }[] = [];
  /** 注册的代码块处理函数 */
  processors = new Map<
    string,
    (
      source: string,
      root: HTMLElement,
      context: { addChild: (child: unknown) => void },
    ) => void
  >();
  /** 自动清理的宿主资源 */
  disposers: (() => void)[] = [];
  /** 已注册设置页，验证卡片内容 */
  tabs: unknown[] = [];
  /** 注入模拟公开 App，不侵入插件实现 */
  constructor(public app: any) {}
  /** 模拟持久化读取 */
  async loadData(): Promise<unknown> {
    return this.data;
  }
  /** 模拟持久化保存 */
  async saveData(data: unknown): Promise<void> {
    this.data = structuredClone(data);
  }
  /** 记录文件事件卸载回调 */
  registerEvent(dispose: () => void): void {
    this.disposers.push(dispose);
  }
  /** 记录视图类型 */
  registerView(type: string, factory: (leaf: unknown) => unknown): void {
    this.factories.set(type, factory);
  }
  /** 记录独立代码块语言 */
  registerMarkdownCodeBlockProcessor(
    language: string,
    handler: (
      source: string,
      root: HTMLElement,
      context: { addChild: (child: unknown) => void },
    ) => void,
  ): void {
    this.processors.set(language, handler);
  }
  /** 不模拟实际图标绘制 */
  addRibbonIcon(): void {}
  /** 保存设置页无需打开真实 App */
  addSettingTab(tab: unknown): void {
    this.tabs.push(tab);
  }
  /** 命令通过公开模块边界验证 */
  addCommand(command: (typeof this.registeredCommands)[number]): void {
    this.registeredCommands.push(command);
  }
  /** 为状态栏提供真实 DOM 节点 */
  addStatusBarItem(): HTMLElement {
    return document.createElement("div");
  }
  /** 托管普通资源清理 */
  register(dispose: () => void): void {
    this.disposers.push(dispose);
  }
  /** 托管定时器清理 */
  registerInterval(handle: number): void {
    this.disposers.push(() => window.clearInterval(handle));
  }
  /** 宿主 DOM 事件替身仍执行真实 addEventListener */
  registerDomEvent(
    target: EventTarget,
    event: string,
    listener: EventListener,
  ): void {
    target.addEventListener(event, listener);
    this.disposers.push(() => target.removeEventListener(event, listener));
  }
}
/** 模拟日历与计时页签容器 */
export class ItemView {
  /** 真实 DOM 供组件挂载 */
  contentEl = document.createElement("div");
  /** 页签所属宿主 */
  constructor(public leaf: unknown) {}
  /** 不在模块边界内模拟 Obsidian 内部状态 */
  async setState(_state: unknown, _result: unknown): Promise<void> {}
}
/** 模拟 Markdown 渲染子节点容器 */
export class MarkdownRenderChild {
  /** 生命周期由测试显式驱动 */
  constructor(public containerEl: HTMLElement) {}
}
/** 表单宿主的最小测试接口 */
export class Modal {
  /** 真实表单容器 */
  contentEl = document.createElement("div");
  /** 当前 App */
  constructor(public app: unknown) {}
  /** 显式模拟 Obsidian 打开生命周期 */
  open(): void {
    (this as unknown as { onOpen: () => void }).onOpen();
  }
  /** 设置真实弹窗标题的公开边界 */
  setTitle(title: string): void {
    this.contentEl.setAttribute("data-title", title);
  }
  /** 清理模拟表单 */
  close(): void {
    this.contentEl.replaceChildren();
  }
}
/** 只在实际设置页打开时提供容器 */
export class PluginSettingTab {
  /** 设置页挂载点 */
  containerEl = document.createElement("div");
  /** 模拟公开构造接口 */
  constructor(_app: unknown, _plugin: unknown) {}
}
/** 模拟原生设置行，验证插件保存操作而非宿主内部实现 */
export class Setting {
  /** 原生设置行容器 */
  settingEl = document.createElement("div");
  /** 原生设置名称 */
  nameEl = document.createElement("div");
  /** 原生设置说明 */
  descEl = document.createElement("div");
  /** 原生设置操作区 */
  controlEl = document.createElement("div");
  /** 将可测试控件挂载到设置页 */
  constructor(container: HTMLElement) {
    this.controlEl.className = "setting-item-control";
    this.settingEl.append(this.nameEl, this.descEl, this.controlEl);
    container.append(this.settingEl);
  }
  /** 显示设置名称 */
  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }
  /** 显示设置说明 */
  setDesc(description: string): this {
    this.descEl.textContent = description;
    return this;
  }
  /** 添加插件作用域样式 */
  setClass(name: string): this {
    this.settingEl.classList.add(name);
    return this;
  }
  /** 提供与宿主相同的目录文本输入边界 */
  addSearch(callback: (search: any) => void): this {
    // 保留原生搜索输入结构以便断言路径草稿
    const container = document.createElement("div");
    container.className = "search-input-container";
    // 搜索控件使用显式文本类型
    const input = document.createElement("input");
    input.type = "text";
    container.append(input);
    this.controlEl.append(container);
    // 实现本插件实际依赖的公开链式接口
    const search = {
      inputEl: input,
      setValue: (value: string) => {
        input.value = value;
        return search;
      },
      setPlaceholder: (value: string) => {
        input.placeholder = value;
        return search;
      },
    };
    callback(search);
    return this;
  }
  /** 提供可触发的保存按钮 */
  addButton(callback: (button: any) => void): this {
    // 通过真实点击事件验证配置提交
    const input = document.createElement("button");
    this.controlEl.append(input);
    // 按钮状态和点击处理保持公开 API 的调用契约
    const button = {
      setButtonText: (value: string) => {
        input.textContent = value;
        return button;
      },
      setDisabled: (value: boolean) => {
        input.disabled = value;
        return button;
      },
      onClick: (handler: () => void) => {
        input.addEventListener("click", handler);
        return button;
      },
    };
    callback(button);
    return this;
  }
}

/** 捕获菜单供右键行为断言 */
export class Menu {
  /** 菜单标题及用户选择回调 */
  entries: { title: string; action?: () => void }[] = [];
  /** 最近展示的菜单 */
  static last: Menu | null = null;
  /** 按宿主链式 API 创建菜单项 */
  addItem(build: (item: any) => void): this {
    // 独立菜单项可观察结果
    const entry: { title: string; action?: () => void } = { title: "" };
    // 模拟公开构建接口
    const item = {
      setTitle: (title: string) => {
        entry.title = title;
        return item;
      },
      onClick: (action: () => void) => {
        entry.action = action;
        return item;
      },
    };
    build(item);
    this.entries.push(entry);
    return this;
  }
  /** 分隔符不参与命令数 */
  addSeparator(): this {
    return this;
  }
  /** 记录菜单展示位置 */
  showAtMouseEvent(_event: MouseEvent): void {
    Menu.last = this;
  }
}
