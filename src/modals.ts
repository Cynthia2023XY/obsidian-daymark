import { App, Modal } from "obsidian";
import {
  addDays,
  Item,
  ItemStatus,
  localDay,
  monthDays,
  shiftMonth,
  validDay,
} from "./domain";
import { MigrationChoice, MigrationService } from "./migration";
import { button, element, UiHost } from "./ui";

/** 只有名称的新建弹窗，日期来自用户选中的日历 */
export class ItemModal extends Modal {
  /** 注入单日业务宿主 */
  constructor(
    app: App,
    private host: UiHost,
    private date?: string,
  ) {
    super(app);
  }
  /** 参考图中的事项名称与单个创建按钮 */
  onOpen(): void {
    this.contentEl.replaceChildren();
    this.setTitle(
      this.date ? "新建 " + this.date + " 重要事项" : "新建待办箱事项",
    );
    // 组织单次事项编辑，成功写入后才关闭表单
    const form = element(this.contentEl, "form", "daylane-create-form");
    // 呈现单条事项详情与明确操作入口
    const row = element(form, "label", "daylane-create-row");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const description = element(row, "span");
    element(description, "strong", "", "事项内容");
    element(
      description,
      "small",
      "",
      "将保存为 Vault 中的独立 Markdown 文件。",
    );
    // 创建或读取可操作表单控件，保留尚未提交的输入
    const input = element(row, "input");
    input.type = "text";
    input.placeholder = "例如：提交项目材料";
    input.required = true;
    input.maxLength = 300;
    input.setAttribute("aria-label", "事项内容");
    // 逐项记录可解释的失败，不把部分失败报告成全部成功
    const errors = element(form, "p", "daylane-form-error");
    errors.setAttribute("role", "alert");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const footer = element(form, "div", "daylane-create-footer");
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const create = element(footer, "button", "mod-cta", "创建重要事项");
    create.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (create.disabled) return;
      create.disabled = true;
      errors.textContent = "";
      this.host.repository
        .create({ title: input.value, date: this.date })
        .then((item) => {
          if (item.title !== input.value.trim())
            this.host.notify("已创建：" + item.title + ".md");
          this.close();
        })
        .catch((error) => {
          errors.textContent =
            error instanceof Error ? error.message : String(error);
          create.disabled = false;
        });
    });
    input.focus();
  }
  /** 关闭后释放已过期输入 */
  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
/** 手动流转的独立日期选择，不再打开配置表单 */
export class DateModal extends Modal {
  /** 注入当前事项与保存回调 */
  constructor(
    app: App,
    private item: Item,
    private save: (date: string) => Promise<void>,
  ) {
    super(app);
  }
  /** 只选择今天或未来日期，累计次数明确保留 */
  onOpen(): void {
    this.contentEl.replaceChildren();
    this.setTitle("安排「" + this.item.title + "」");
    // 组织单次事项编辑，成功写入后才关闭表单
    const form = element(this.contentEl, "form", "daylane-date-form");
    element(
      form,
      "p",
      "daylane-muted",
      "手动改期不会增加或清零累计自动流转次数。",
    );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const label = element(form, "label", "daylane-date-input-row", "指定日期");
    // 创建或读取可操作表单控件，保留尚未提交的输入
    const input = element(label, "input");
    input.type = "text";
    input.placeholder = "YYYY-MM-DD";
    input.setAttribute("aria-label", "指定日期，格式为 YYYY-MM-DD");
    input.required = true;
    input.value =
      this.item.date && this.item.date >= localDay()
        ? this.item.date
        : localDay();
    // 逐项记录可解释的失败，不把部分失败报告成全部成功
    const errors = element(form, "p", "daylane-form-error");
    errors.setAttribute("role", "alert");
    // 显示正在浏览的月份，切换月份不会直接修改所选日期
    let month = input.value.slice(0, 7);
    // 快捷日期与月历共用选择动作，确认前不会写入事项
    const choose = (date: string): void => {
      input.value = date;
      month = date.slice(0, 7);
      errors.textContent = "";
      render();
    };
    // 常用日期直接点击，不依赖系统日期弹层
    const shortcuts = element(form, "div", "daylane-date-shortcuts");
    // 快捷操作只更新当前草稿，保存仍需明确确认
    for (const [title, days] of [
      ["今天", 0],
      ["明天", 1],
      ["一周后", 7],
    ] as const) {
      // 采用普通按钮避免快捷选择误提交表单
      const quick = element(shortcuts, "button", "", title);
      quick.type = "button";
      quick.addEventListener("click", () => choose(addDays(localDay(), days)));
    }
    // 常驻月历在旧版 Electron 中也可直接操作
    const calendar = element(form, "div", "daylane-date-calendar");
    // 月历刷新只替换自身内容，保留日期输入和确认按钮
    const render = (): void => {
      calendar.replaceChildren();
      // 月份导航仅浏览，不偷偷改动当前日期
      const navigation = element(calendar, "div", "daylane-date-navigation");
      // 防止浏览今天之前整月，未来月份可自由切换
      const previous = element(navigation, "button", "", "‹");
      previous.type = "button";
      previous.setAttribute("aria-label", "上个月");
      previous.disabled = month <= localDay().slice(0, 7);
      previous.addEventListener("click", () => {
        month = shiftMonth(month, -1);
        render();
      });
      // 清楚展示年和月，不使用随系统语言变化的日期顺序
      const heading = element(
        navigation,
        "strong",
        "",
        `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`,
      );
      heading.setAttribute("aria-live", "polite");
      // 下一月允许跨年浏览
      const next = element(navigation, "button", "", "›");
      next.type = "button";
      next.setAttribute("aria-label", "下个月");
      next.addEventListener("click", () => {
        month = shiftMonth(month, 1);
        render();
      });
      // 星期与日期按周一开始排列
      const grid = element(calendar, "div", "daylane-date-grid");
      // 表头区分星期与可点击日期
      for (const weekday of ["一", "二", "三", "四", "五", "六", "日"])
        element(grid, "span", "daylane-date-weekday", weekday);
      // 保持完整六周布局，跨月日期仍显示完整可访问标签
      for (const date of monthDays(month, true)) {
        // 每个日期都是独立按钮，过去日期禁止选择
        const day = element(
          grid,
          "button",
          "daylane-date-day",
          String(Number(date.slice(8))),
        );
        day.type = "button";
        day.dataset.date = date;
        day.disabled = date < localDay();
        day.setAttribute("aria-label", date);
        day.setAttribute("aria-pressed", String(date === input.value));
        day.classList.toggle("is-selected", date === input.value);
        day.classList.toggle("is-outside", date.slice(0, 7) !== month);
        if (date === localDay()) day.setAttribute("aria-current", "date");
        day.addEventListener("click", () => {
          choose(date);
          calendar
            .querySelector<HTMLButtonElement>(`[data-date="${date}"]`)
            ?.focus();
        });
      }
    };
    input.addEventListener("input", () => {
      if (validDay(input.value) && input.value >= localDay()) {
        month = input.value.slice(0, 7);
        errors.textContent = "";
        render();
      }
    });
    render();
    element(
      form,
      "small",
      "daylane-muted",
      "点击日期或输入 YYYY-MM-DD，再确认保存。灰色日期不可选择。",
    );
    // 保存或模拟持久化边界，检查写入成功后再确认完成
    const save = element(form, "button", "mod-cta", "确认日期");
    save.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (save.disabled) return;
      if (!validDay(input.value) || input.value < localDay()) {
        errors.textContent = "请选择今天或未来的有效日期";
        return;
      }
      save.disabled = true;
      errors.textContent = "";
      this.save(input.value)
        .then(() => this.close())
        .catch((error) => {
          errors.textContent = String(error);
          save.disabled = false;
        });
    });
    calendar.querySelector<HTMLButtonElement>(".is-selected")?.focus();
  }
  /** 关闭时清理月历和未提交的日期草稿 */
  onClose(): void {
    this.contentEl.replaceChildren();
  }
}
/** 默认删除行为执行前说明具体文档与回收方式 */
export class ConfirmModal extends Modal {
  /** 明确用户将执行的动作 */
  constructor(
    app: App,
    private heading: string,
    private message: string,
    private action: () => Promise<void>,
    private report: (message: string) => void,
  ) {
    super(app);
  }
  /** 确認按钮不会重复触发写入 */
  onOpen(): void {
    this.setTitle(this.heading);
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
/** 旧属性预览、明确选择复杂项、JSON 备份后再转换 */
export class ImportModal extends Modal {
  /** 注入当前配置范围内的事项仓库 */
  constructor(
    app: App,
    private host: UiHost,
    private migrated: () => Promise<void>,
  ) {
    super(app);
  }
  /** 提供迁移范围与字段处理选项，不在启动时直接改原文 */
  onOpen(): void {
    this.setTitle("旧重要事项迁移");
    element(
      this.contentEl,
      "p",
      "",
      "扫描当前配置范围；转换前备份原文到插件 backups 目录。未完成历史事项转换后会按新规则自动流转。",
    );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const cleanLabel = element(
      this.contentEl,
      "label",
      "daylane-migration-option",
    );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const clean = element(cleanLabel, "input");
    clean.type = "checkbox";
    clean.checked = true;
    element(
      cleanLabel,
      "span",
      "",
      "清理旧插件业务属性：日期、状态、标题、颜色、项目、起止与截止日期、旧创建／更新时间等；其他属性与正文保留",
    );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const normalizeLabel = element(
      this.contentEl,
      "label",
      "daylane-migration-option",
    );
    // 保存当前处理阶段的事实结果，供后续校验与展示
    const normalize = element(normalizeLabel, "input");
    normalize.type = "checkbox";
    element(
      normalizeLabel,
      "span",
      "",
      "同时规范已验证的旧随机文件名，以及插件生成的一级标题（使用数字处理重名）",
    );
    // 展示预览与逐项结果，供用户核对后执行
    const output = element(this.contentEl, "div", "daylane-migration-output");
    // 组合真实业务服务与可控边界，验证完整行为链
    const service = new MigrationService(this.host.repository);
    // 在写入前收集可审阅的迁移项与错误
    const preview = button(
      this.contentEl,
      "扫描并预览",
      async () => {
        preview.disabled = true;
        output.replaceChildren();
        try {
          // 汇总实际操作成功、跳过与失败，避免向用户伪报结果
          const result = await service.preview();
          element(
            output,
            "p",
            "",
            "发现 " +
              result.candidates.length +
              " 个旧事项。跨日或取消状态项必须明确选择。",
          );
          // 保存当前处理阶段的事实结果，供后续校验与展示
          const choices: (() => MigrationChoice | null)[] = [];
          // 逐项处理当前业务集合，保留每项自己的状态与结果
          for (const candidate of result.candidates) {
            // 呈现单条事项详情与明确操作入口
            const row = element(output, "div", "daylane-migration-row");
            // 保存当前处理阶段的事实结果，供后续校验与展示
            const includeLabel = element(row, "label");
            // 保存当前处理阶段的事实结果，供后续校验与展示
            const include = element(includeLabel, "input");
            include.type = "checkbox";
            include.checked = !candidate.reason;
            element(includeLabel, "strong", "", candidate.path);
            element(
              row,
              "p",
              "daylane-muted",
              candidate.source +
                (candidate.reason ? " · " + candidate.reason : ""),
            );
            // 保存当前处理阶段的事实结果，供后续校验与展示
            const dateLabel = element(
              row,
              "label",
              "",
              "单日日期（留空进入待办箱） ",
            );
            // 按本地自然日计算排期，避开 UTC 解析偏移
            const date = element(dateLabel, "input");
            date.type = "date";
            date.value = candidate.date ?? "";
            // 保存当前处理阶段的事实结果，供后续校验与展示
            const statusLabel = element(row, "label", "", "完成状态 ");
            // 明确生命周期状态，决定是否允许自动流转
            const status = element(statusLabel, "select");
            // 逐项处理当前业务集合，保留每项自己的状态与结果
            for (const [value, label] of [
              ["", "请选择"],
              ["open", "未完成"],
              ["completed", "已完成"],
            ]) {
              // 为受控输入添加合法选项，不猜测用户配置
              const option = element(status, "option", "", label);
              option.value = value;
            }
            status.value = candidate.status ?? "";
            choices.push(() => {
              if (!include.checked) return null;
              if (status.value !== "open" && status.value !== "completed")
                throw new Error("请选择完成状态：" + candidate.path);
              if (date.value && !validDay(date.value))
                throw new Error("日期无效：" + candidate.path);
              return {
                candidate,
                date: date.value || undefined,
                status: status.value as ItemStatus,
              };
            });
          }
          // 逐项处理当前业务集合，保留每项自己的状态与结果
          for (const message of result.errors)
            element(output, "p", "daylane-warning", message);
          if (!result.candidates.length) return;
          // 只在用户确认后复制预览中的源事项
          const execute = button(
            output,
            "确认备份并转换所选文档",
            async () => {
              // 保存当前处理阶段的事实结果，供后续校验与展示
              const selected = choices
                .map((choice) => choice())
                .filter((choice): choice is MigrationChoice => choice !== null);
              if (!selected.length) throw new Error("请先选择要转换的事项");
              execute.disabled = true;
              try {
                // 保存当前处理阶段的事实结果，供后续校验与展示
                const converted = await service.execute(
                  selected,
                  clean.checked,
                  normalize.checked,
                );
                output.replaceChildren();
                element(
                  output,
                  "p",
                  "",
                  "已转换 " +
                    converted.changed +
                    " 个事项；保存 " +
                    converted.backups.length +
                    " 份 JSON 原文备份。",
                );
                // 逐项处理当前业务集合，保留每项自己的状态与结果
                for (const error of converted.errors)
                  element(output, "p", "daylane-warning", error);
                await this.migrated();
              } finally {
                execute.disabled = false;
              }
            },
            this.host.notify,
            "mod-cta",
          );
        } finally {
          preview.disabled = false;
        }
      },
      this.host.notify,
    );
  }
}
