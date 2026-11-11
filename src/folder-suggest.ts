import { AbstractInputSuggest, App, TFolder } from "obsidian";

/** 为事项存储目录提供笔记库内的原生路径补全 */
export class ItemFolderSuggest extends AbstractInputSuggest<TFolder> {
  /** 将建议列表绑定到当前设置页的目录输入框 */
  constructor(
    private vaultApp: App,
    private input: HTMLInputElement,
  ) {
    super(vaultApp, input);
  }
  /** 只展示可作为事项存储位置的普通目录，按路径匹配 */
  getSuggestions(query: string): TFolder[] {
    // 大小写不影响目录查找，隐藏目录与根目录不作为存储候选
    const keyword = query.trim().toLocaleLowerCase();
    return this.vaultApp.vault
      .getAllLoadedFiles()
      .filter(
        (file): file is TFolder =>
          file instanceof TFolder &&
          file.path !== "/" &&
          file.path.split("/").every((part) => part && !part.startsWith(".")) &&
          file.path.toLocaleLowerCase().includes(keyword),
      )
      .sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  }
  /** 完整显示目录路径，避免同名子目录无法区分 */
  renderSuggestion(folder: TFolder, element: HTMLElement): void {
    element.textContent = folder.path;
  }
  /** 选择只填入草稿，由保存按钮统一提交，避免失焦误存半截路径 */
  selectSuggestion(folder: TFolder): void {
    this.input.value = folder.path;
    this.input.dispatchEvent(new Event("input", { bubbles: true }));
    this.close();
  }
}
