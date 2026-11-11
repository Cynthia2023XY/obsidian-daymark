import { describe, expect, it } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { ItemFolderSuggest } from "../src/folder-suggest";

/** 目录补全只提供安全目录，选择后保留为待保存草稿 */
describe("事项存储目录补全", () => {
  it("按完整路径匹配目录，过滤笔记、根目录与隐藏目录", () => {
    // 模拟同名子目录与不应出现在候选中的路径
    const files = [
      new TFolder(),
      new TFolder(),
      new TFolder(),
      new TFolder(),
      new TFile(),
    ];
    // 测试只注入公开文件路径，不依赖宿主内部目录结构
    for (const [index, path] of [
      "/",
      "03Collect/Items",
      "Work/Items",
      ".obsidian/cache",
      "Items.md",
    ].entries()) {
      files[index].path = path;
    }
    // 仅替换只读笔记库枚举接口
    const app = { vault: { getAllLoadedFiles: () => files } } as unknown as App;
    // 将生产建议组件连接到真实输入框
    const suggest = new ItemFolderSuggest(app, document.createElement("input"));
    expect(
      suggest.getSuggestions("ITEMS").map((folder) => folder.path),
    ).toEqual(["03Collect/Items", "Work/Items"]);
    expect(
      suggest.getSuggestions("03Collect").map((folder) => folder.path),
    ).toEqual(["03Collect/Items"]);
    expect(suggest.getSuggestions("missing")).toEqual([]);
    expect(suggest.getSuggestions("")).toHaveLength(2);
  });
  it("选择候选填入完整路径，不触发失焦保存事件", () => {
    // 用真实输入事件验证手动保存之前不会隐式提交
    const input = document.createElement("input");
    // 收集保存所依赖的变更事件
    let changes = 0;
    input.addEventListener("change", () => {
      changes++;
    });
    // 构造建议来源和选中目录
    const suggest = new ItemFolderSuggest({} as App, input);
    // 模拟宿主返回的目录对象
    const folder = new TFolder();
    folder.path = "03Collect/Important Events";
    suggest.selectSuggestion(folder);
    expect(input.value).toBe(folder.path);
    expect(changes).toBe(0);
    // 建议文字完整展示，特殊字符作为文本处理
    const label = document.createElement("div");
    suggest.renderSuggestion(folder, label);
    expect(label.textContent).toBe(folder.path);
  });
});
