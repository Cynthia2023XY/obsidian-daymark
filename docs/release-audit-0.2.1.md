# Daymark 0.2.1 发布检查

日期：2026-10-12。首次 Community Directory 提交；仓库 https://github.com/Cynthia2023XY/obsidian-daymark，默认分支 main，公开。

## 元信息与授权

- 显示名称 Daymark - Chinese Holiday Calendar。冒号因当前 Manifest 规则而替换为允许的连字符。已发布列表中另有 justgregb/obsidian-daymark 的 Daymark，本插件使用完整限定名称；daymark-chinese-calendar ID 无已发布占用。
- 经用户明确授权，ID 改为 daymark-chinese-calendar，安装目录与视图标识同步更新；YAML 前缀和代码块语言保持兼容。不变更 MIT 许可证、仓库可见性或收费定位。
- manifest、package、lockfile 版本一致为 0.2.1，versions.json 仅映射新 ID 的首个正式发布 0.2.1 → 1.14.4，移除未为新 ID 发布的开发版本映射。最低版本选择真实验证的当前公开桌面版本，未声明旧版或移动端已经验证。
- 描述 250 字符以内并以句号结束，无重复命令 ID 前缀，无演示代码。作者 Cynthia Ding。

## 源码与数据检查

运行时仅引入 Obsidian 公开 API；不存在网络请求、遥测、广告、下载执行、自安装更新或库外文件访问。构建工具和测试依赖不随运行包安装。README 披露自动流转默认开启、计数上限入箱、整篇笔记默认删除、可选属性删除和迁移原文备份。内置节假日只覆盖 2025、2026 年。

独立实现，Calendar Plus 作为需求与样式参考在 README 署名说明；无其运行组件或周期笔记代码。未打包外部字体或媒体。发行 JS 未混淆，LICENSE 为 MIT。

## 验证

- 58 项 Vitest 测试通过；中文声明注释检查 28 个文件通过；TypeScript 严格类型检查、生产构建及 Git 空白检查通过。
- 在指定新功能测试仓库运行 0.2.1：创建专用未来事项、完成、入箱、保留文档删除属性和最终回收自检文档，实际状态核验通过。未改写已有笔记。
- 新 ID 的备份目录核验通过，旧 ID 已禁用、配置迁移且笔记未改写。专注时长 25 → 26 保存后重载仍为 26，随后恢复 25 并再次核验。
- 禁用后实例移除，日历与番茄钟视图均为 0；重新启用成功，五条命令注册，日历与文件列表共用左侧主标签组。
- 未执行完整最低版本之外设备测试；未声称提示音、所有主题及长期休眠场景全部验证。

## 官方依据

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)：通过当前 Community Directory 网页提交，使用与版本同名的 GitHub Release 附件，不创建旧式目录 PR。
- [Manifest](https://docs.obsidian.md/Reference/Manifest)：名称字符限制与唯一性。
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)：最低版本、描述及命令规范。
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)：隐私、许可及公开维护政策。

提交表单还要求声明已阅读并同意 Developer Policies，以及承诺继续维护（无法维护时移除或转让）。目录是否已发布须以实际审核与 Publish 状态为准；GitHub Release 完成不能替代市场状态。
