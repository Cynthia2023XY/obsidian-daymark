import { App, Modal } from "obsidian";
import { COLORS, Item, ItemDraft, safeFolder } from "./domain";
import { MigrationService } from "./migration";
import { button, element, UiHost } from "./ui";

/** 普通表单输入，让中文字段名称与辅助说明一起呈现 */
function field(
  parent: HTMLElement,
  label: string,
  value: string,
  type = "text",
): HTMLInputElement {
  // 使用 label 嵌套保证键盘与读屏可识别
  const wrapper = element(parent, "label", "", label);
  // 创建或读取可操作表单控件，保留尚未提交的输入
  const input = element(wrapper, "input");
  input.type = type;
  input.value = value;
  return input;
}
/** 受控选项，不从用户正文生成 HTML */
function select(
  parent: HTMLElement,
  label: string,
  value: string,
  choices: [string, string][],
): HTMLSelectElement {
  // 把输入与中文标签关联，支持键盘和读屏使用
  const wrapper = element(parent, "label", "", label);
  // 创建或读取可操作表单控件，保留尚未提交的输入
  const input = element(wrapper, "select");
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const [key, title] of choices) {
    // 为受控输入添加合法选项，不猜测用户配置
    const option = element(input, "option", "", title);
    option.value = key;
  }
  input.value = value;
  return input;
}
/** 新建与编辑事项，保存后保留笔记正文 */
export class ItemModal extends Modal {
  /** 注入共享业务服务与默认日期 */
  constructor(
    app: App,
    private host: UiHost,
    private date: string,
    private item?: Item,
  ) {
    super(app);
  }
  /** 构建事项表单与明确的日期类型 */
  onOpen(): void {
    this.contentEl.replaceChildren();
    element(this.contentEl, "h2", "", this.item ? "编辑事项" : "新建事项");
    // 组织单次事项编辑，成功写入后才关闭表单
    const form = element(this.contentEl, "form", "daylane-form");
    // 保存可读标题，用于展示、表单编辑与文件命名
    const title = field(form, "标题", this.item?.title ?? "");
    title.required = true;
    title.maxLength = 300;
    // 区分可流转待办和保持原日期的固定日程
    const kind = select(form, "类型", this.item?.kind ?? "todo", [
      ["todo", "待办：可自动顺延"],
      ["event", "固定日程：保留排期"],
    ]);
    // 明确生命周期状态，决定是否允许自动流转
    const status = select(form, "状态", this.item?.status ?? "open", [
      ["open", "未完成"],
      ["completed", "已完成"],
      ["cancelled", "已取消"],
    ]);
    // 根据事项类型显示对应日期字段
    const dates = element(form, "div", "daylane-form");
    // 记录待办计划执行日期，与固定截止日期分开
    const scheduled = field(
      dates,
      "待办计划日期",
      this.item?.scheduled ?? this.date,
      "date",
    );
    // 保存截止边界，流转不改变这项约束
    const deadline = field(
      dates,
      "截止日期（可选，流转不改变）",
      this.item?.deadline ?? "",
      "date",
    );
    // 记录有效开始日期或周内起点，决定排期范围
    const start = field(
      dates,
      "固定日程开始日期",
      this.item?.start ?? this.date,
      "date",
    );
    // 记录包含当天的结束日期或周内终点
    const end = field(
      dates,
      "固定日程结束日期（包含当天）",
      this.item?.end ?? this.date,
      "date",
    );
    // 提供单条待办对全局自动流转的覆盖方式
    const rollover = select(
      dates,
      "待办流转方式",
      this.item?.rollover ?? "inherit",
      [
        ["inherit", "跟随全局设置"],
        ["auto", "自动流转"],
        ["off", "不流转"],
      ],
    );
    // 保存所属项目条件，便于查看特定排期
    const project = field(form, "所属项目（可选）", this.item?.project ?? "");
    // 选择受控颜色，避免不可信内容进入样式
    const color = select(
      form,
      "颜色",
      this.item?.color ?? this.host.getPreferences().color,
      COLORS.map((value, index) => [
        value,
        ["蓝", "绿", "橙", "红", "紫", "灰"][index],
      ]),
    );
    // 向用户展示保存失败，失败时保留表单输入
    const errorEl = element(form, "div", "daylane-form-error");
    errorEl.setAttribute("role", "alert");
    // 组织用户显式操作，展示模式可整体隐藏
    const actions = element(form, "div", "daylane-actions");
    // 保存或模拟持久化边界，检查写入成功后再确认完成
    const save = element(actions, "button", "mod-cta", "保存");
    save.type = "submit";
    button(actions, "取消", () => this.close(), this.host.notify);
    // 隐藏非当前类型字段，保留输入以便切换回来
    const updateType = (): void => {
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (const input of [scheduled, deadline, rollover])
        input.parentElement!.hidden = kind.value !== "todo";
      // 逐项处理当前业务集合，保留每项自己的状态与结果
      for (const input of [start, end])
        input.parentElement!.hidden = kind.value !== "event";
    };
    kind.addEventListener("change", updateType);
    updateType();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save.disabled = true;
      errorEl.textContent = "";
      // 组织表单业务字段，存储身份与原始正文由仓库维护
      const draft: ItemDraft = {
        title: title.value.trim(),
        kind: kind.value as Item["kind"],
        status: status.value as Item["status"],
        scheduled: scheduled.value,
        deadline: deadline.value || undefined,
        start: start.value,
        end: end.value,
        rollover: rollover.value as Item["rollover"],
        project: project.value,
        color: color.value,
      };
      Promise.resolve()
        .then(async () => {
          if (this.item) await this.host.repository.edit(this.item, draft);
          else await this.host.repository.create(draft);
          // 编辑可能重新打开过期待办，宿主负责立即重新检查流转
          await this.host.afterEdit();
          this.close();
        })
        .catch((error) => {
          errorEl.textContent =
            error instanceof Error ? error.message : String(error);
          save.disabled = false;
        });
    });
    title.focus();
  }
  /** 关闭后不保留已过期表单内容 */
  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
/** 删除等明确动作使用可审阅的确认框 */
export class ConfirmModal extends Modal {
  /** 描述具体操作与成功执行回调 */
  constructor(
    app: App,
    private title: string,
    private message: string,
    private action: () => Promise<void>,
    private report: (message: string) => void,
  ) {
    super(app);
  }
  /** 只有点击确认才执行写入 */
  onOpen(): void {
    element(this.contentEl, "h2", "", this.title);
    element(this.contentEl, "p", "", this.message);
    // 执行用户确认的具体动作，防止重复触发同一操作
    const confirm = button(
      this.contentEl,
      "确认",
      async () => {
        confirm.disabled = true;
        try {
          await this.action();
          this.close();
        } finally {
          confirm.disabled = false;
        }
      },
      this.report,
      "mod-warning",
    );
    button(this.contentEl, "取消", () => this.close(), this.report);
  }
}
/** 手动迁移预览，旧 Calendar Plus 文件保持原状 */
export class ImportModal extends Modal {
  /** 注入新插件共享仓库 */
  constructor(
    app: App,
    private host: UiHost,
  ) {
    super(app);
  }
  /** 先预览，再显式执行复制导入 */
  onOpen(): void {
    element(this.contentEl, "h2", "", "导入 Calendar Plus 重要事项");
    element(
      this.contentEl,
      "p",
      "",
      "旧文件保持原样；导入为单日固定日程，不自动流转。后续可逐条改为待办。",
    );
    // 读取用户指定目录，限定索引与迁移范围
    const folder = field(
      this.contentEl,
      "旧事项所在目录",
      "Calendar Important Events",
    );
    // 展示预览与逐项结果，供用户核对后执行
    const output = element(this.contentEl, "div");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(this.host.repository);
    // 触发只读迁移预览并避免并发重复扫描
    const previewButton = button(
      this.contentEl,
      "预览",
      async () => {
        previewButton.disabled = true;
        try {
          // 使用明确的 Vault 相对路径，定位本次读写对象
          const path = safeFolder(folder.value);
          // 在写入前收集可审阅的迁移项与错误
          const preview = await service.preview(path);
          output.replaceChildren();
          element(
            output,
            "p",
            "",
            `将复制 ${preview.candidates.length} 条事项到 ${this.host.getPreferences().folder}；跳过 ${preview.duplicates} 个重复来源。`,
          );
          // 逐项处理当前业务集合，保留每项自己的状态与结果
          for (const candidate of preview.candidates)
            element(
              output,
              "div",
              "daylane-muted",
              `${candidate.draft.title} · ${candidate.path}`,
            );
          // 逐项处理当前业务集合，保留每项自己的状态与结果
          for (const message of preview.errors)
            element(output, "p", "daylane-warning", message);
          if (!preview.candidates.length) return;
          // 只在用户确认后复制预览中的源事项
          const execute = button(
            output,
            "确认复制导入",
            async () => {
              execute.disabled = true;
              try {
                // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
                const result = await service.execute(preview.candidates);
                output.replaceChildren();
                element(
                  output,
                  "p",
                  "",
                  `已复制 ${result.created} 条事项；旧文件未修改。`,
                );
                // 逐项处理当前业务集合，保留每项自己的状态与结果
                for (const message of result.errors)
                  element(output, "p", "daylane-warning", message);
              } finally {
                execute.disabled = false;
              }
            },
            this.host.notify,
            "mod-cta",
          );
        } finally {
          previewButton.disabled = false;
        }
      },
      this.host.notify,
    );
  }
}
