# Changelog

所有对该项目的显著更改都将记录在此文件中。

## Changelog Writing Guidelines (写作规范)

- 顶部最多保留一个 `## [Unreleased] (未发布)`。所有尚未改版本号和重新打包的改动都先写在这里。
- 正式发布段标题使用 `## [YYYY-MM-DD] [x.y.z]`。日期必须使用实际发布/打包当天的本地日期，并与 `manifest.json`、`package.json`、README 版本徽章和 release zip 版本保持一致。
- 每个发布段只保留实际需要的分类，分类名必须精确使用 `### Added`、`### Changed`、`### Fixed`、`### Security`、`### Removed`。不要在分类标题后追加中文括号，也不要创建空分类。
- 分类顺序固定为 `Added`、`Changed`、`Fixed`、`Security`、`Removed`；某个分类没有内容时直接省略。
- 条目格式统一为 `- **中文标题 (English Title)**: 具体说明。` 标题应短而明确，正文说明用户可感知的影响、修复范围或必要的技术原因。
- 只记录可验证的功能、修复、安全加固、打包和兼容性变化。避免夸张营销语、泛泛的“优化体验/提升稳定性”，除非同时写清楚具体修复点。
- 同一类相关改动应合并成一条高信号记录；不同风险面或不同用户影响的改动应拆开写，便于回溯。
- Agent 写入流程：先读本规范和 `AGENTS.md`；非发布改动写入 `Unreleased`；如果同步改了项目结构、功能域、存储 key、测试入口、发布流程或维护规则，同时更新 `docs/PROJECT_DIRECTORY.md`；发布前再把 `Unreleased` 内容移动到正式版本段。
- 每次发布前至少确认 changelog 顶部版本、项目版本号、release zip 文件名和 `git diff --check` 结果一致。

模板：

```md
## [Unreleased] (未发布)

### Changed
- **中文标题 (English Title)**: 写清楚具体影响、范围或原因。
```

## [Unreleased] (未发布)

### Added
- **X 本地发布工具 (Local X Publisher Tool)**: 新增 `marketing/x-publisher/`，提供 OAuth 2.0 PKCE 授权、账号验证和人工确认后发帖的本地脚本，并用本地 `.gitignore` 排除 `.env` 与 `tokens.json`。
- **宣传账号邮箱记录 (Promotion Account Email Record)**: 在宣传账号矩阵中记录插件推广账号统一使用 `notebooklmsourcemanagement@gmail.com` 注册，便于后续社媒账号创建保持一致。
- **宣传资料工作区 (Promotion Workspace)**: 新增 `marketing/` 目录，用于整理社媒账号矩阵、内容日历、平台宣传打法和素材记录，不进入扩展运行时或发布包。
- **快速筛选视图 (Quick Filter Views)**: 在来源管理器工具栏下方新增 All、Ungrouped、Disabled、Tag、Recent 和 Issues 快速视图，支持与搜索词叠加筛选，并为新识别来源保存 `addedAt` 以支持最近新增视图。
- **快速视图按钮自定义 (Quick View Button Customization)**: 设置页新增快速视图按钮管理入口，用户可选择来源面板中显示哪些 quick view 按钮，也可全部隐藏；隐藏后对应命令和自定义快捷键仍可使用。
- **导入差异预览 (Import Diff Preview)**: 导入配置预览新增来源启用状态、文件夹、标签和面板设置差异摘要，并明确提示当前导入仍是恢复/替换当前管理配置而非增量合并。
- **命令面板入口 (Command Palette Entry)**: 在设置页偏好区域新增命令面板入口，支持搜索来源、切换快速视图、切换来源视图、打开设置/标签管理，并在批量模式下执行移动和标签批量命令。
- **命令快捷键自定义 (Command Shortcut Customization)**: 命令面板每个命令新增快捷键设置入口，默认不绑定任何快捷键，用户可自行录入、替换或清除快捷键并保存到全局偏好。
- **更新后介绍弹窗 (What's New Modal)**: 新增按功能版本显示一次的更新介绍弹窗，并在开发者功能区提供测试入口，便于大功能发布时向用户说明变化。
- **本地快照策略 (Local Snapshot Policy)**: 设置页新增历史快照保留数量选择和手动命名恢复点，支持按每个 notebook 保留更多本地版本历史。
- **手动语言切换 (Manual Language Selection)**: 设置页新增 Auto、English、Español、简体中文语言选择，允许扩展 UI 独立于 Chrome UI 语言切换。

### Changed
- **设置页信息架构收敛 (Settings Information Architecture Consolidation)**: 将设置页的导出、导入和版本历史合并到“备份与恢复”，将反馈与诊断信息合并到“帮助与反馈”，保存状态移动到标题栏，并仅在导入预览有效时显示“应用导入”按钮；来源修复仅在检测到匹配问题时独立突出显示。
- **命令快捷键重复触发 (Command Shortcut Repeat Toggle)**: 用户自定义命令快捷键再次触发同一搜索、快速视图或 modal 类命令时，会收起搜索、退出当前快速视图或关闭已打开的对应面板。
- **按钮扫光动效关闭 (Button Sweep Hover Motion Disabled)**: 关闭 `.sp-button` 的 shimmer 扫光和 `.sp-glare-hover` 的 glare 扫光伪元素，保留普通 hover 背景、边框和缩放反馈。
- **启动弹窗版本分流 (Startup Modal Version Routing)**: 首次使用的新用户只显示欢迎弹窗并标记当前版本更新说明已处理，已有本地插件数据的老用户升级后按 manifest 版本显示一次 What's New 弹窗。
- **深拷贝改用 structuredClone (Deep Clone via structuredClone)**: 将 `src/background/index.js` 的 `cloneSerializableData`、`src/content/content-developer-logger.js` 的 `getDeveloperLogs` 与 `src/content/content-state-reconcile.js` 的 `applySourceRemapsToSnapshot` 中裸 `JSON.parse(JSON.stringify)` 替换为 `structuredClone` 优先并保留 JSON 回退，与 `content-persistence.js`、`content/index.js` 已有模式一致。

### Fixed
- **偏好与恢复点保存失败反馈 (Preference and Restore Point Save Failure Feedback)**: 修复语言、历史保留数量等偏好保存失败时设置页误报成功的问题，并让手动恢复点创建在 history 写入失败时显示失败结果。
- **命令面板过滤与最近来源时间戳 (Command Palette Filtering and Recent Source Timestamps)**: 修复命令面板输入内容不会过滤命令的问题，并在无原生 DOM 行的恢复路径中保留来源 `addedAt`，避免 Recent 视图时间戳被后续保存抹掉。
- **发布包图标保留校验 (Release Icon Asset Guard)**: 补充发布包图标资源校验，确保插件图标资源继续进入 release zip。
- **全部视图边界遮挡 (All View Edge Clipping)**: 修复 All 快速视图下快速筛选按钮被渲染成裁切括号状、以及来源列表最后一行贴近底部边界时可能被面板边缘、拖拽手柄或 NotebookLM 原生控件截断的问题。
- **空快速视图栏隐藏 (Empty Quick View Rail Hiding)**: 修复用户在设置中隐藏所有 quick view 按钮后，来源面板仍保留空白按钮栏区域的问题。

### Security
- **本地会话文件忽略 (Local Session File Ignore)**: 将根目录 `cookies.json` 加入 `.gitignore`，避免小红书或其他本地登录工具生成的会话文件被误提交。

## [2026-05-17] [2.7.4]

### Added
- **首次欢迎弹窗 (First-Run Welcome Modal)**: 在用户首次进入 NotebookLM 并成功加载来源管理器后显示一次欢迎弹窗，提供功能简介和 Chrome Web Store 反馈入口，并支持浅色/深色模式及 English、Español、简体中文三语言文案。
- **欢迎弹窗测试入口 (Welcome Modal Test Entry)**: 在设置页开发者功能区新增“测试欢迎弹窗”按钮，方便重复预览首次欢迎弹窗而无需清理偏好状态。
- **来源视图状态记忆 (Source View State Memory)**: 每个 notebook 会记住上次使用的来源列表/标签视图，并在下次打开时自动恢复对应视图。

### Changed
- **反馈入口文案精简 (Feedback Entry Copy Simplification)**: 移除设置页反馈区里 Chrome Web Store 说明小字，仅保留反馈标题和打开反馈入口按钮。
- **欢迎反馈入口轻量化 (Welcome Feedback Entry Simplification)**: 将首次欢迎弹窗底部反馈区域从卡片和按钮改为小字提示与文字链接，降低与功能介绍卡片的视觉重复。
- **开发者模式解锁记忆 (Developer Mode Unlock Memory)**: 当 Developer Mode 已开启时，设置页会直接显示开发者功能区，刷新或重新进入 notebook 后无需再次输入开发者密码。
- **保存状态横向排列 (Horizontal Save Status Layout)**: 将设置页“保存状态”标题和状态徽标改为同一行横向排列，避免状态内容在宽面板中垂直堆叠。
- **开发者功能隐藏入口 (Developer Features Hidden Entry)**: 设置页不再直接展示开发者模式、日志和欢迎弹窗测试按钮，改为底部“开发者功能”小入口，输入开发者密码 `developer_mode` 后才显示这些工具。
- **UI 规范同步 (UI Guidelines Alignment)**: 将 `UI_GUIDELINES.md` 同步为当前实现事实，覆盖 popup 宽度与暗色主题、source row grid 布局、长来源标题换行策略、motion token 三曲线体系和最新 UI helper 文件入口，并在项目目录索引中补充 UI 规范排障入口。
- **项目文档一致性 (Project Documentation Consistency)**: 统一项目目录中的 state backup key 为实际使用的 `sourcesPlusState_<projectId>__backup`，更新 README smoke 覆盖说明，补齐 release checklist 的 `package-lock.json`、README badge 和 changelog 发布步骤，并把 `UI_GUIDELINES.md` 纳入 UI 变更入口规则。
- **Agent 项目规则强化 (Agent Project Rules Hardening)**: 在 `AGENTS.md` 中固定启动检查、content helper 装配、验证矩阵、NotebookLM 原生自动化安全、开发者日志脱敏、headless smoke 默认值和只读检查无需 changelog 的规则，并同步更新目录索引。
- **Content Helper 边界拆分 (Content Helper Boundary Split)**: 新增 toast/status、diagnostics、source view switch、native label import、partial sync guard、source action menu 和 modal focus helper/controller，并补充对应 focused 单测；`index.js`、source sync、source actions 和 modal 模块继续保留原入口行为。
- **Modal 子模块边界 (Modal Helper Boundary)**: 新增原生标签导入 modal helper，把导入 preview 节点生成逻辑从 `content-modals.js` 抽离，保留原 modal facade 和交互入口不变。
- **Source Sync 子模块边界 (Source Sync Helper Boundaries)**: 新增来源列表扫描、原生标签扫描和原生标签导入 helper，先抽离 checkbox 状态读取、标签头数量解析和导入预览完整性判断，为后续继续拆分 `content-source-sync.js` 建立可测试边界。
- **Content 消息路由边界 (Content Message Router Boundary)**: 新增 content message router helper，把 popup/background 到 content 的消息分发机制从总入口抽离，并保持 `GET_MANAGER_STATUS`、`FOCUS_MANAGER`、`SWITCH_SOURCE_VIEW`、启用和禁用响应形状不变。
- **Content Runtime 状态边界 (Content Runtime State Boundary)**: 新增 content runtime state helper，先把 `runtimeContext` getter/setter 绑定机制从 content 总入口中抽离出来，后续可继续收敛运行时状态字段而不改变现有业务行为。
- **架构契约文档 (Architecture Contract Docs)**: 新增 storage schema 和 message contract 文档，明确状态字段、迁移边界、消息类型、sender 校验、key 前缀和错误码，作为后续拆分 content runtime 与 source sync 的维护契约。
- **更新日志规范化 (Changelog Standardization)**: 统一历史条目的分类标题、双语标题格式和非营销化描述，并补充 `Unreleased` 写入模板，方便后续人工和 agent 按同一规则维护。
- **Agent 更新日志流程 (Agent Changelog Workflow)**: 在 `AGENTS.md` 中明确后续 agent 写入 changelog 的步骤：默认写入 `Unreleased`、只在发布时创建正式版本段，并同步检查项目目录索引。
- **目录索引维护规则 (Directory Guide Maintenance Rule)**: 新增根目录 `AGENTS.md`，明确后续每次代码、测试、文档、配置、打包或工作流变更都必须同步检查并更新 `docs/PROJECT_DIRECTORY.md`，同时在目录索引中标出该规则入口。
- **项目目录索引 (Project Directory Guide)**: 新增 `docs/PROJECT_DIRECTORY.md`，用树状结构按目录结构、运行入口、功能域、存储 key、测试入口、发布流程和 agent 快速定位路径整理仓库维护地图，并标明清理后可重新生成的 ignored 输出目录，方便后续人工或 AI agent 快速定位相关代码与验证路径。

### Fixed
- **原生视图切换前状态同步 (Native View Switch Pre-Sync)**: 修复在 NotebookLM 原生标签视图中修改折叠标签组勾选状态后，直接点击原生列表视图按钮会丢失最新勾选状态的问题。
- **原生标签菜单切换防护 (Native Label Menu Switch Guard)**: 修复 List View 切到 Label View 时真实 header `label_auto` 入口被误判为来源行按钮、以及 Label View 切回 List View 时 NotebookLM 只在 `label_auto` 菜单中提供返回入口的问题；现在允许明确的 header `label_auto` 进入标签视图，并仅通过 `label_auto` -> `Return to list view` 返回列表，同时继续避免误点来源行或普通菜单项。
- **来源指纹稳定性 (Source Fingerprint Stability)**: 修复来源 hydrate 后新增与标题重复的 ARIA label 会改变 stable-token 来源 fingerprint、导致硬刷新后产生无意义额外保存的问题。
- **设置弹窗字体继承修复 (Settings Modal Font Inheritance Fix)**: 为内容脚本 modal 外壳固定与来源管理器一致的系统字体栈，避免设置和欢迎弹窗继承 NotebookLM 页面字体导致字体不匹配。
- **原生标签导入确认 (Native Label Import Confirmation)**: 修复只读导入预览已列出 NotebookLM 原生标签，但确认导入时因来源尚未进入插件状态而导入结果为 0 个分组 / 0 个来源的问题；现在仅在确认阶段补齐 preview 中的来源记录。

### Removed
- **本地产物清理 (Local Artifact Cleanup)**: 清理 `.DS_Store`、`.Rhistory`、旧计划文件、旧 zip 归档以及可重新生成的 `release/`、`output/` 目录，减少维护时的干扰项。

## [2026-05-16] [2.7.2]

### Added
- **开发者模式日志 (Developer Mode Logging)**: 在设置页新增开发者模式开关，开启后记录脱敏的状态变更、原生操作、持久化、导入导出、视图切换和错误日志，并支持复制、下载和清空开发者日志；新增 `docs/DEVELOPER_LOGGING.md` 作为后续日志写作规范。
- **开发回归清单 (Development Smoke Checklist)**: 在 README 中新增面向扩展开发的手工冒烟检查步骤，覆盖 manager 挂载、图标回归、popup 上下文分支、NotebookLM 路由切换，以及分组、拖拽和批量操作等核心交互。

### Changed
- **无弹窗 Smoke 测试默认值 (Headless Smoke Test Default)**: 本地 `npm run test:smoke` 现在默认以 headless 模式运行，避免 Playwright 浏览器窗口抢占桌面；需要交互调试时可显式使用 `PLAYWRIGHT_HEADLESS=false npm run test:smoke`。
- **来源描述符辅助逻辑抽离 (Source Descriptor Helper Extraction)**: 将 source descriptor、稳定 token、图标 URL 解析等纯逻辑从 `content/index.js` 抽离到独立 helper，保持现有全局 helper 装配方式不变，降低内容脚本单文件耦合度。
- **当前 Popup 和 UI 改动收口 (Popup and UI Consolidation)**: 保留当前 popup 视觉结构和内容面板样式 token 的整理结果，并补上结构契约测试，确保关键 DOM id 与 launcher 行为没有因为 UI 调整而回归。

### Fixed
- **安全加固 (Security Hardening)**: 阻断从 NotebookLM DOM/CSS 提取的任意第三方来源图标 URL，收紧 content script 在 background 拒绝或通信失败时的 direct storage fallback，并在原生删除/重命名前增加 fresh row 身份校验与删除确认弹窗歧义防护。
- **NotebookLM 标签/列表切换状态同步 (Native Label/List State Sync)**: 修复在原生标签视图中折叠标签组后修改组头复选框，再切回列表视图时插件仍恢复旧勾选状态的问题；source scan 与原生 change 事件统一读取 `checked`、`aria-checked` 和 checkbox role，并避免原生标签组盲目匹配普通同名插件文件夹。
- **原生删除结果判定 (Native Delete Confirmation)**: 修复 NotebookLM 已接受删除请求但来源行尚未从 DOM 立即移除时，插件误报“删除失败，重试”的问题；确认弹窗关闭后会按删除请求已被接受处理，并先从插件 manager 状态中隐藏该来源。
- **原生删除弹窗识别补强 (Native Delete Dialog Detection)**: 补充识别 NotebookLM 当前 Material/CDK 删除确认弹窗的 overlay pane 与 dialog surface 容器，并支持 `[role="button"]` 形式的确认按钮，避免原生弹窗已经显示但插件仍误报未找到确认弹窗。
- **批量模式来源标题布局 (Batch Mode Source Title Layout)**: 修复进入批量操作后隐藏三点按钮导致来源标题掉入操作列、长标题逐字换行的问题；批量模式现在保留不可交互的操作列占位。
- **批量选中动画一致性 (Batch Selection Motion Consistency)**: 移除批量选中来源行的自定义 pop 动画，让选中和取消选中都使用默认状态切换，避免两种操作的动效不一致。
- **批量操作条按钮显示 (Batch Action Bar Labels)**: 修复批量操作条里“取消”按钮被挤压时可能显示不完整的问题，并取消非删除操作后的重复数量显示，仅保留删除按钮显示当前选中数量。
- **来源导入中状态同步 (Importing Source State Sync)**: 修复 NotebookLM 添加来源时临时 loading 行被同步保护逻辑跳过的问题；现在会保留旧来源并合并新的 loading 行，识别 raw URL 临时标题、progress bar、spinner、状态文案和 `aria-busy` 等 loading 信号。
- **失败来源状态显示 (Failed Source State Display)**: 修复原生 NotebookLM 已标记失败但来源行仍带 checkbox 时，插件没有显示失败样式的问题；失败来源现在会被标记为不可用，并在 manager 中显示失败图标、失败提示和禁用控件。
- **失败来源删除入口 (Failed Source Delete Action)**: 修复失败来源被 disabled 状态拦截后无法打开三点菜单的问题；现在失败来源的菜单只显示“删除失败来源”，并允许继续走 NotebookLM 原生删除确认流程。
- **原生标签导入展开识别 (Native Label Import Expansion Detection)**: 修复 NotebookLM 标签组只通过 chevron 图标或 Material `treeitem` 表示折叠时，点击“导入 NotebookLM 分组”仍提示没有可导入分组的问题；导入扫描也会排除 Material 标签头里的图标文本和底部自动标签入口。
- **折叠标签组导入预览 (Collapsed Native Label Import Preview)**: 修复 NotebookLM 原生标签组未全部展开时，导入预览依赖可见来源行导致可导入文件夹为空或不完整的问题；现在优先读取折叠组中仍存在的隐藏来源行，必要时才使用自动展开兜底。
- **原生标签导入只读预览 (Read-Only Native Label Import Preview)**: 将“导入 NotebookLM 分组”预览改为直接从当前 DOM 只读生成，不再先写入插件来源状态；隐藏来源行只允许来自原生折叠标签组内容区，并且导入确认只复用带 `nativeLabelTitle` 的原生导入分组。
- **分组树交互健壮性 (Group Tree Interaction Hardening)**: 修复同一毫秒连续新建分组时 `Date.now()` 生成相同 ID 导致分组覆盖的问题，同时避免父分组已过期时创建不可见孤儿分组，以及来源行 DOM 已过期但来源记录不存在时点击行触发运行时异常。
- **历史/导入分组数据容错 (Persisted Group Shape Guarding)**: 修复历史数据或导入数据中的分组缺少 `children` 数组时，移除分组、状态重映射、构建父级索引或渲染列表可能抛错的问题；现在这些路径会按空子列表处理。
- **标签状态更新容错 (Tag State Update Guarding)**: 修复只更新标签名称时会意外清空原有颜色的问题，并在旧状态缺少 `tagOrder` 时自动初始化，避免创建或排序标签时报错。
- **移动到文件夹容错 (Move-to-Folder Guarding)**: 修复目标文件夹缺少 `children` 数组时移动来源会抛错的问题；现在移动前会初始化目标子列表并继续正常保存。
- **来源图标提取性能收敛 (Source Icon Extraction Hardening)**: 将来源图标发现逻辑改为显式候选优先、受限回退扫描，避免在 NotebookLM 复杂 DOM 上做高成本整行深搜与无差别样式读取。
- **来源图标误判防护 (Source Icon False-Positive Guarding)**: 保留并强化对原生 checkbox、三点菜单按钮和交互菜单祖先路径的排除，修复装饰性图标被错认成来源图标的风险，同时继续支持可点击 source row、本地化未命名来源兜底和 shadow-root 图标场景。

## [2026-03-17] [2.6.1]

### Changed
- **版本同步与重新打包 (Version Sync and Repackage)**: 将清单、包信息、README 徽章及发布压缩包统一升级为 2.6.1，并重新生成对应 release zip。
- **发布命名统一 (Release Name Alignment)**: 将发布包与项目包名统一为 `notebooklm-source-management`，不再使用 `notebooklm-source-plus` 命名。

### Fixed
- **Launcher 路径补强 (Launcher Route Handling)**: 细化工具栏启动器的状态分支，修复用户已在 NotebookLM 首页但尚未进入具体笔记本时点击后没有明确反馈的问题。
- **NotebookLM 首页反馈 (NotebookLM Home Feedback)**: 启动器会优先切换到已打开的 notebook 标签页；若当前页已是唯一的 NotebookLM 首页标签页，则新开一个 NotebookLM 标签页。
- **笔记本路由挂载 (Notebook Route Mounting)**: 针对 NotebookLM 单页应用路由切换，新增进入或切换 notebook 时的一次性自动刷新，确保扩展正确加载并避免来源列表异常消失。

## [2026-03-17] [2.6.0]

### Added
- **浏览器工具栏启动器 (Toolbar Launcher)**: 为扩展新增独立的浏览器工具栏 popup 入口；固定到工具栏后点击图标会进入扩展自己的状态页与启动器界面。
- **页面内聚焦跳转 (In-Page Focus Jump)**: 新增 popup 到 content script 的通信链路，用户可从工具栏一键跳转并高亮 NotebookLM 页面中的来源管理器。

### Changed
- **入口说明重构 (Entry-Point Clarity)**: 明确区分“工具栏图标是启动器”与“真正功能运行在 NotebookLM 来源面板内”的产品模型，并补充多语言提示文案与 README 安装说明。
- **版本同步 (Version Sync)**: 将源码清单与包信息统一升级至 2.6.0，避免发布产物与仓库源码版本长期脱节。

## [2026-03-15] [2.5.0]

### Changed
- **版本跟进更新 (Version Update)**: 将清单文件与核心配置升级至 2.5.0，并重新构建用于发布的 zip 压缩包。

## [2026-03-08] [2.4.1]

### Changed
- **批量删除队列优化 (Batch Delete Queue Optimization)**: 调整批量删除的异步队列调度和 DOM 状态同步，减少高并发删除期间 observer 脱节和列表刷新不准的问题。

## [2026-03-07] [2.4.0]

### Changed
- **核心稳定性提升 (Core Stability Update)**: 重构底层同步和防御性逻辑，增强单页应用页面在高频异步操作和复杂 DOM 状态下的运行稳定性。

### Removed
- **冗余文件清理 (Redundant File Cleanup)**: 移除历史遗留的开发辅助教程与计划文档，包括 `PLAN.md`、`GITHUB_PUBLISH_TUTORIAL.md`、`GIT_COMMANDS_GUIDE.md` 和 `TERMINAL_COMMANDS_GUIDE.md`。

## [2026-03-05] [2.3.0]

### Added
- **未分组文件移动入口 (Move to Folder Modal)**: 为未分组来源新增文件夹快捷移动入口，支持选择目标分组、移动来源，并补充相关多语言文案。

## [2026-03-05] [2.2.0]

### Added
- **未分组文件移动面板 (Move to Folder Modal)**: 为未分组来源新增独立的“加入文件夹”入口，避免依赖 NotebookLM 原生三点菜单注入。
- **自适应退避心跳 (Adaptive Backoff Heartbeat)**: 将 DOM 同步检测从固定高频查询改为自适应退避轮询，在界面闲置、DOM 无变动时降低健康检查频率。
- **统一交互动效 (Unified Interaction Motion)**: 统一弹窗、折叠面板和按钮微交互使用的缓动参数，减少不同交互之间的动画不一致。

### Changed
- **删除确认寻址增强 (Delete Confirmation Targeting)**: 增强批量删除在查找 NotebookLM 原生删除对话框时的寻址逻辑，减少文案变化导致确认按钮定位失败的风险。

### Fixed
- **MutationObserver 性能收敛 (MutationObserver Throttle)**: 移除对 `characterData` 的无意义监听，减少 spinner 和进度条变化引发的无效同步工作。

## [2026-03-01] [2.1.1]

### Added
- **后台持久化架构 (Background Persistence Architecture)**: 引入 background service worker，将 `chrome.storage` 相关状态持久化逻辑迁移到后台，并建立 message passing 通信机制。
- **批量删除入口 (Batch Delete Action)**: 在界面顶部栏新增批量删除动作按钮，支持进入多选删除模式并串行触发 NotebookLM 原生删除流程。
- **加载状态显示 (Loading State Display)**: 增加来源导入中的 loading 状态识别和渲染，在 NotebookLM 仍在解析来源时显示加载环和状态文本。
- **全局毛玻璃样式 (Global Glassmorphism)**: 调整 manager 控制栏和部分挂载容器的视觉样式，使其与当前插件界面风格保持一致。
- **文件夹入场动画 (Folder Entry Animation)**: 为新建分组添加入场动画，减少分组 DOM 插入时的突兀闪现。
- **国际化多语言支持 (Internationalization)**: 将硬编码 UI 文案迁移到 Chrome `chrome.i18n`，并添加英文和简体中文文案配置。
- **维护文档补充 (Maintenance Documents)**: 新增 Git、终端命令和 GitHub 发布相关的维护文档。
- **失败来源高亮 (Failed Source Highlighting)**: 检测并高亮显示导入失败且无法选中的来源文件。

### Changed
- **视觉风格调整 (Visual Style Update)**: 调整全局动画参数和弹出菜单、挂载容器的圆角比例，使现有界面视觉保持一致。
- **代码结构整理 (Code Structure Cleanup)**: 整理渲染和交互代码结构，降低后续维护难度。

### Fixed
- **XSS 安全修复 (XSS Rendering Fix)**: 移除 `content.js` 中对用户可控内容使用 `innerHTML` 的路径，改用 `document.createElement` 方式渲染。
- **扩展上下文失效防御 (Invalidated Context Guard)**: 修复扩展 reload 后旧标签页继续调用 `chrome.runtime.sendMessage` 可能抛出 `Extension context invalidated` 的问题。
- **CSS 选择器抗变更 (CSS Selector Resilience)**: 将部分 DOM 查询优先改为 `data-testid` 和语义标记，降低宿主页面混淆类名变化带来的失效风险。
- **来源列表自动刷新 (Source List Auto Refresh)**: 修复添加新来源后插件面板不同步的问题，通过更稳定的 DOM 监听锚点和轻量同步心跳处理列表容器重建。
- **勾选动画重播 (Checkbox Animation Replay)**: 修复 DOM 重绘时所有已选中来源同时重播选中动画的问题，将动画触发限制为用户主动点击。
- **原生弹窗闪烁 (Native Dialog Flicker)**: 在批量删除自动化期间临时隐藏 NotebookLM 原生确认弹窗，减少连续删除时的视觉闪烁。
- **右侧滚动条异常 (Unexpected Right Scrollbar)**: 修复整个界面右侧有时会意外出现滚动条的问题。
- **菜单定位异常 (Menu Positioning)**: 修复插件菜单在部分布局下定位不正确的问题。
