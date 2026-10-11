import { parse } from "yaml";
import { DEFAULTS, Item, ItemDraft } from "../src/domain";
import { HolidayService } from "../src/holidays";
import {
  ItemRepository,
  noteContent,
  splitNote,
  VaultPort,
} from "../src/repository";
import { TimerService } from "../src/timer";
import { CalendarPanel, TimerPanel, UiHost } from "../src/ui";

/** 浏览器视觉验证的临时内存 Vault，不写入用户笔记 */
class PreviewVault implements VaultPort {
  /** 本页模拟笔记原文 */
  private files = new Map<string, string>();
  /** 返回模拟 Markdown 路径 */
  paths(): string[] {
    return [...this.files.keys()];
  }
  /** 读取当前模拟内容 */
  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }
  /** 演示配置按标准 YAML 解析 */
  parseYaml(source: string): Record<string, unknown> {
    return parse(source) ?? {};
  }
  /** 浏览器内存无需目录 */
  async ensureFolder(_path: string): Promise<void> {}
  /** 为视觉验证创建笔记 */
  async create(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  /** 模拟 frontmatter 修改，业务仓库仍使用真实处理链 */
  async update(
    path: string,
    operation: (fields: Record<string, unknown>) => void,
  ): Promise<void> {
    // 分离原始属性与正文，更新时保留用户原有说明
    const note = splitNote(await this.read(path), this.parseYaml);
    operation(note.fields);
    this.files.set(path, noteContent(note.fields, note.body));
  }
  /** 模拟回收，不触及真实 Vault */
  async trash(path: string): Promise<void> {
    this.files.delete(path);
  }
}
/** 真实 CalendarPanel 组件的浏览器宿主示例 */
async function mountPreview(): Promise<void> {
  // 提供 Markdown 事实仓库，验证索引与写入契约
  const repository = new ItemRepository(new PreviewVault(), "Daylane/Items");
  // 建立独立计时状态机，不依赖事项数据
  const timer = new TimerService(
    () => Date.now(),
    () => window.alert("当前番茄钟结束"),
  );
  // 模拟宿主动作边界，组件使用真实业务服务
  const host: UiHost = {
    repository,
    timer,
    holidays: new HolidayService(),
    getPreferences: () => ({ ...DEFAULTS, lastBatch: [] }),
    notify: (message) => window.alert(message),
    prepareSound: () => undefined,
    edit: (date: string, item?: Item) => {
      // 保存可读标题，用于展示、表单编辑与文件命名
      const title = window.prompt(
        "事项标题（浏览器预览仅保存在内存）",
        item?.title ?? "",
      );
      if (!title) return;
      // 组织表单业务字段，存储身份与原始正文由仓库维护
      const draft: ItemDraft = item
        ? { ...item, title }
        : {
            title,
            kind: "todo",
            status: "open",
            scheduled: date,
            project: "",
            color: "blue",
            rollover: "off",
          };
      void (
        item ? repository.edit(item, draft) : repository.create(draft)
      ).catch((error) => host.notify(String(error)));
    },
    open: async (item) => {
      window.alert(await repository.port.read(item.path));
    },
    trash: (item) => {
      if (window.confirm(`删除模拟事项“${item.title}”？`))
        void repository.trash(item);
    },
    status: (item, status) => repository.status(item, status),
    afterEdit: async () => undefined,
  };
  // 逐项处理当前业务集合，保留每项自己的状态与结果
  for (const draft of [
    {
      title: "基金活动联调",
      kind: "event",
      start: "2026-10-09",
      end: "2026-10-14",
      color: "blue",
      project: "基金营销",
    },
    {
      title: "体验金上线验收",
      kind: "event",
      start: "2026-10-13",
      end: "2026-10-16",
      color: "green",
      project: "基金营销",
    },
    {
      title: "版本发布",
      kind: "event",
      start: "2026-10-20",
      end: "2026-10-20",
      color: "purple",
      project: "基金营销",
    },
    {
      title: "补齐接口文档",
      kind: "todo",
      scheduled: "2026-10-09",
      deadline: "2026-10-10",
      color: "orange",
      project: "工作",
    },
    {
      title: "确认下周排期",
      kind: "todo",
      scheduled: "2026-10-11",
      color: "blue",
      project: "工作",
    },
    {
      title: "修复索引竞态",
      kind: "todo",
      scheduled: "2026-10-10",
      color: "green",
      project: "工作",
      status: "completed",
    },
  ])
    await repository.create({
      status: "open",
      rollover: "off",
      ...draft,
    } as ItemDraft);
  new CalendarPanel(document.querySelector<HTMLElement>("#calendar")!, host, {
    month: "2026-10",
  });
  new TimerPanel(document.querySelector<HTMLElement>("#timer")!, host);
  window.setInterval(() => timer.tick(), 1000);
}
void mountPreview();
