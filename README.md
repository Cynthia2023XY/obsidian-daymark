# Daymark - Chinese Holiday Calendar

面向每日重要事项的 Obsidian 桌面插件。中国法定节假日和调休上班日离线展示；未完成事项自动顺延，过多顺延的事项进入待办箱。作者：Cynthia Ding。当前版本 0.2.4，最低 Obsidian 1.7.4。

显示名称已从 Daylane 改为 Daymark，中文称“每日要事”。为兼容既有笔记与配置，插件 ID 为 daymark-chinese-calendar，YAML 属性仍使用 daylane- 前缀，代码块语言仍为 daylane，默认目录仍为 Daylane/Items。GitHub 仓库及本地源码目录为 obsidian-daymark，安装目录为 .obsidian/plugins/daymark-chinese-calendar。

Calendar Plus 启发了重要事项与内嵌日历的使用需求；本项目独立实现，不继承其周期笔记、统计或日历组件实现，也没有与该项目的官方维护关系。

## Features

- Daily important items stored as Markdown notes, with Chinese public holidays and adjusted working days.
- A calendar in the left sidebar, a main-tab calendar, and embedded daylane code blocks.
- Automatic rollover with a cumulative limit and an undated inbox; manual rescheduling through the context menu.
- An independent focus timer with custom focus and break durations.

Desktop only, with user-confirmed operation on Obsidian 1.7.4 and prior testing on 1.14.4. Holiday data currently covers mainland China in 2025 and 2026; workday calculations pause when official data for a required year is missing. Install the matching GitHub Release assets in .obsidian/plugins/daymark-chinese-calendar for manual testing.

## Privacy and data / 隐私与数据

Daymark works offline. It does not make network requests, require an account or payment, collect telemetry, display ads, download executable code, or access files outside the current vault. The GitHub and government URLs in the source are reference metadata; they are not fetched by the plugin. All source code is available under the MIT license.

插件完全离线使用，无账号、付费、遥测或广告，也不访问当前 Vault 之外的文件。事项存储为普通 Markdown；可选全库识别只扩大到当前 Vault。

Automatic rollover is enabled by default and changes past open items' dates and rollover counts. Once the configured limit is reached, the date is removed and the item appears in the inbox. Completing or manually rescheduling an item does not reset its count. Default deletion removes the entire Markdown note through Obsidian's configured trash mechanism; the experimental alternative removes only plugin-owned YAML fields. Migration is optional and requires a preview; it stores the full original note in the plugin's backups directory inside the vault before modifying the note. Timer sounds are synthesized locally.

自动流转默认启用，会修改过期未完成事项的日期和累计次数；达到上限后移除日期并入箱。默认删除会按 Obsidian 回收配置移除整篇笔记，实验模式只移除插件专属 YAML。旧数据迁移需先预览确认，原文备份保存在当前库插件目录的 backups 下。建议首次使用先在测试库操作。

## 日历与事项

插件加载后默认将日历放入左侧文件列表所在的标签组，不拆分上下侧栏，不抢占正在编辑的文档。侧栏、独立页面与 daylane 代码块共用同一月历：周一开始、红点表示事项、休／班角标表示法定节假日和调休工作日。点击日期查看下方事项，双击日期或点击“添加重要事项”只需输入名称。勾选完成，点击标题打开笔记，× 删除。已完成事项仍显示。

新文件直接存放在配置目录，标题为二级标题。重名使用“名称 1.md”“名称 2.md”，不覆盖已有普通文档。列表右键可指定日期、移到下一自然日／工作日、放入待办箱和删除。默认删除整篇笔记并使用宿主回收机制；实验性设置可改成只删除插件专属 YAML 属性。

右键选择“高亮事项”后，事项显示浅蓝色背景，所属日期的红点旁增加蓝点；再次右键选择“取消高亮”即可恢复。高亮状态保存在笔记属性中，完成、改期或移入待办箱后仍保留，侧栏、独立日历和内嵌日历同步显示。

手动指定日期使用直接可点击的月历，支持切换月份、“今天／明天／一周后”快捷选择和 YYYY-MM-DD 文本输入。浏览与选择只修改弹窗草稿，确认后才保存；过去日期不可选择，保存失败时保留输入供重试。

## YAML 数据

~~~yaml
---
daylane-type: important-event
daylane-date: "2026-10-12"
daylane-status: open
daylane-rollover-count: 0
---

## 重要事项
~~~

- daylane-highlighted：可选布尔值，设为 true 高亮事项；缺省或 false 不高亮，取消高亮时移除此属性。
- daylane-type：识别标记，必须为 important-event。
- daylane-date：单日日期，删除此属性即进入待办箱。
- daylane-status：open 或 completed；缺省为 open。
- daylane-rollover-count：累计实际自动改期次数；缺省为 0。手动改期、完成、入箱均不清零。

默认必须同时满足标记和配置目录范围（含子目录）。关闭目录限制后可识别整个库内带标记的笔记。文件名用作显示标题，重命名不会破坏身份判断。标签 tags 和其他笔记属性不属于插件字段。

## 自动流转

插件启动并完成扫描后、本地午夜、窗口恢复可见或获得焦点时检查。仅处理日期早于今天且未完成的新格式事项，忽略未来事项、待办箱和旧格式事项。默认工作日规则遵守离线节假日及调休数据，自然日规则移到今天；工作日规则移到今天或其后的第一个工作日。

默认允许自动改期 5 次，第 6 次需要顺延时只删除日期，保留计数 5。关闭期间积压的事项一次实际改期只计一次，不补算未执行的历史流转。手动安排不增加或重置计数；已达到上限的事项重新安排后，下一次自动顺延仍会入箱。两个批量命令分别处理此前有日期的未完成事项，以及今天所有未完成事项。

已内置 2025、2026 年中国大陆官方安排。未覆盖年份会提示；工作日计算不猜测该年份的法定节假日。后续年份需更新插件数据。

## 命令与设置

仅保留 5 条命令：打开侧栏日历、打开大屏日历、将此前所有未完成待办移到今天、完成今日所有待办、查看待办箱。

设置分为“重要事项”和“独立番茄钟”两张卡片。事项默认目录 Daylane/Items、工作日流转；高级选项提供目录限制、流转次数上限及实验性删除方式。番茄钟默认开启，专注 25 分钟、休息 5 分钟、提示音开启，支持自定义时长。通过功能区计时图标或状态栏打开，不与事项联动。

## 日历代码块

使用语言 daylane，内容如下：

~~~yaml
month: current
interactive: true
~~~

month 也可为 YYYY-MM。interactive: false 禁止创建、完成、删除与改期，仍可导航、查看待办箱和打开笔记。

## 从开发版迁移插件配置

此前手工安装的 daylane 是旧开发版 ID。升级时先禁用旧插件，将旧目录的 data.json 复制到 .obsidian/plugins/daymark-chinese-calendar，再启用新插件。不要同时启用新旧版本。事项 YAML 和 daylane 代码块仍兼容，ID 变更不会自动改写笔记。

## 旧事项迁移

旧 Calendar Plus 标记及 Daylane 0.1 格式只读兼容显示；不会自动改写旧笔记。设置页提供迁移预览，跨日或取消状态必须明确选择新的日期／状态。执行前将完整原文备份为 JSON 到插件目录 backups，并校验预览后的文档是否发生变化。

迁移可清理已列出的旧业务属性，保留 date created、date modified、tags、未知元信息和正文。可选规范经过旧 ID 验证的随机文件名后缀及原生成一级标题；通过 Obsidian renameFile 更新文件引用。迁移后逐条显示成功和错误；如属性转换成功但更名失败，会如实报告部分成功。备份恢复须人工核对最新内容后操作。

## 本地安装与开发

运行 npm install、npm run test:run、npm run package。将 dist/daymark-chinese-calendar 的 main.js、manifest.json、styles.css 复制到目标库 .obsidian/plugins/daymark-chinese-calendar，保留已有 data.json，然后重新加载插件。发行压缩包为 dist/daymark-chinese-calendar-0.2.3.zip。发布准备与本地验收不等于已通过社区市场审核；目录状态以官方页面为准。

[改造方案](docs/change-plan.md) · [验证报告](docs/verification-report.md) · [宿主验收清单](docs/manual-verification.md)
