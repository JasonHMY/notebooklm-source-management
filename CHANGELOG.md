# Changelog

所有对该项目的显著更改都将记录在此文件中。

## [Unreleased] (未发布)

### Added
- **开发回归清单 (Development Smoke Checklist)**: 在 README 中新增了面向扩展开发的手工冒烟检查步骤，覆盖 manager 挂载、图标回归、popup 上下文分支、NotebookLM 路由切换，以及分组/拖拽/批量操作等核心交互。

### Fixed
- **安全加固 (Security Hardening)**: 阻断从 NotebookLM DOM/CSS 提取的任意第三方来源图标 URL，收紧 content script 在 background 拒绝或通信失败时的 direct storage fallback，并在原生删除/重命名前增加 fresh row 身份校验与删除确认弹窗歧义防护。
- **NotebookLM 标签/列表切换状态同步 (Native Label/List State Sync)**: 修复在原生标签视图中折叠标签组后修改组头复选框，再切回列表视图时插件仍恢复旧勾选状态的问题。现在 source scan 与原生 change 事件统一读取 `checked` / `aria-checked` / checkbox role，切回列表前会先同步并持久化标签组状态；原生标签组同步也不再盲目匹配普通同名插件文件夹，只对带 `nativeLabelTitle` 元数据的导入标签组或来源生效。
- **分组树交互健壮性 (Group Tree Interaction Hardening)**: 修复同一毫秒连续新建分组时 `Date.now()` 生成相同 ID 导致分组覆盖的问题，同时避免父分组已过期时创建不可见孤儿分组，以及来源行 DOM 已过期但来源记录不存在时点击行触发运行时异常。
- **历史/导入分组数据容错 (Persisted Group Shape Guarding)**: 修复历史数据或导入数据中的分组缺少 `children` 数组时，移除分组、状态重映射、构建父级索引或渲染列表可能抛错的问题；现在这些路径会按空子列表处理。
- **标签状态更新容错 (Tag State Update Guarding)**: 修复只更新标签名称时会意外清空原有颜色的问题，并在旧状态缺少 `tagOrder` 时自动初始化，避免创建或排序标签时报错。
- **移动到文件夹容错 (Move-to-Folder Guarding)**: 修复目标文件夹缺少 `children` 数组时移动来源会抛错的问题；现在移动前会初始化目标子列表并继续正常保存。
- **来源图标提取性能收敛 (Source Icon Extraction Hardening)**: 将来源图标发现逻辑改为“显式候选优先 + 受限回退扫描”。优先使用配置化的 `img / background / mask` 候选，只有在未命中时才检查 source row、自身直系子节点和 open shadow root 子节点，避免在 NotebookLM 复杂 DOM 上做高成本的整行深搜与无差别样式读取。
- **来源图标误判防护 (Source Icon False-Positive Guarding)**: 保留并强化了对原生 checkbox、三点菜单按钮和交互菜单祖先路径的排除，修复了装饰性图标被错认成来源图标的风险，同时继续支持可点击 source row、本地化未命名来源兜底和 shadow-root 图标场景。

### Changed
- **来源描述符辅助逻辑抽离 (Source Descriptor Helper Extraction)**: 将 `source descriptor`、稳定 token、图标 URL 解析等纯逻辑从 `content/index.js` 抽离到独立 helper，保持现有全局 helper 装配方式不变，降低了内容脚本单文件的耦合度并收窄后续改动的爆炸半径。
- **当前 Popup / UI 改动收口 (Popup and UI Consolidation)**: 保留当前 popup 视觉结构和内容面板样式 token 的整理结果，并补上结构契约测试，确保关键 DOM id 与 launcher 行为没有因为 UI 调整而回归。

## [2026-03-17] [2.6.1]

### Fixed
- **Launcher 路径补强**: 细化了工具栏启动器的状态分支，修复了当用户已在 NotebookLM 首页但尚未进入具体笔记本时，点击后视觉上“像没发生”的问题。
- **NotebookLM 首页无反馈修复**: 启动器现在会优先切换到已打开的 notebook 标签页；若当前页已是唯一的 NotebookLM 首页标签页，则直接新开一个 NotebookLM 标签页，确保操作始终有明确反馈。
- **进入笔记本自动刷新挂载**: 针对 NotebookLM 的单页应用路由切换，新增进入或切换 notebook 时的一次性自动刷新，确保扩展正确加载并避免来源列表异常消失。

### Changed
- **版本同步与重新打包**: 将清单、包信息、README 徽章及发布压缩包统一升级为 2.6.1，并重新生成对应发布 zip。
- **发布命名统一**: 将发布包与项目包名统一规范为 `notebooklm-source-management`，不再使用 `notebooklm-source-plus` 命名。

## [2026-03-17] [2.6.0]

### Added
- **浏览器工具栏启动器 (Toolbar Launcher)**: 为扩展新增独立的浏览器工具栏 Popup 入口。固定到工具栏后点击图标将不再落入浏览器默认扩展菜单，而是直接进入扩展自己的状态页与启动器界面。
- **页面内聚焦跳转 (In-Page Focus Jump)**: 新增 Popup 到 Content Script 的通信链路。用户可从工具栏一键跳转并高亮 NotebookLM 页面中的来源管理器，快速定位真实功能入口。

### Changed
- **入口说明重构 (Entry-Point Clarity)**: 明确区分“工具栏图标是启动器”与“真正功能运行在 NotebookLM 来源面板内”的产品模型，并补充多语言提示文案与 README 安装说明。
- **版本同步 (Version Sync)**: 将源码清单与包信息统一升级至 2.6.0，避免发布产物与仓库源码版本长期脱节。

## [2026-03-15] [2.5.0]

### Changed
- **版本跟进更新 (Version Update)**: 依据常规迭代流程更新清单文件与核心配置，将扩展正式升级至 2.5.0 版本并重新构建用于发布的 Zip 压缩包，以备提交 Chrome Web Store。(Technical Root Cause: Version sync across manifest, package.json, and generating release bundle).

## [2026-03-08] [2.4.1]

### Changed
- **批量删除引擎优化 (Batch Delete Optimization)**: 深度优化了批量删除 (Batch Delete) 相关的核心功能模块。升级了底层异步删除队列的调度逻辑与防抖动机制，显著提升了多任务处理期间的前端状态同步稳定性和执行效率。确保在高并发删除负载下的静默清理、DOM回收及 UI 列表自动刷新更加精准、无痛并彻底消灭偶现的脱节失效。(Technical Root Cause: Optimized the asynchronous queuing mechanism and DOM state synchronization to prevent observer detachment during high-volume node deletion).

## [2026-03-07] [2.4.0]

### Changed
- **核心稳定性全面提升 (Core Stability Upgrade)**: 深度重构与优化了底层引擎，大幅增强了单页应用页面的运行稳定性和防御性(Defensive Programming)，彻底解决了在高频异步操作与复杂DOM状态下的偶发断连问题。

### Removed
- **冗余文件清理**: 移除了项目历史遗留的开发辅助教程与计划文档（包含 `PLAN.md`, `GITHUB_PUBLISH_TUTORIAL.md`, `GIT_COMMANDS_GUIDE.md` 与 `TERMINAL_COMMANDS_GUIDE.md`），以保持源码仓库轻量级与极简原则。


## [2026-03-05] [2.3.0]

### Added
- **未分组文件二级移动菜单 (Move to Folder Modal)**: 添加了来源可以选择文件夹添加的功能。为未分组 (Ungrouped) 来源选项新引入了专门的文件夹快捷移动入口。依托全新引入的高级毛玻璃二级 UI 界面，用户现在可以一键挑选目标分组，进行快速移动。该功能支持多语言自适应 (新增 `ui_move_to_folder` 与空状态提示国际化配置) 以及与当前主题深度绑定的沉浸式交互体验。

## [2026-03-05] [2.2.0]

### Added
- **未分组文件“闪移”二级面板 (Move to Folder Modal)**: 为处于“Ungrouped”裸露状态的来源项新增了专属的“加入文件夹”入口。摒弃了脆弱且耦合度高的官方原生三点菜单注入，转而在节点左侧渲染了一个完全独立、安全的 `drive_file_move` 操作锚点。点击后将在屏幕正中唤醒基于 Apple HIG 极限倒角与超宽动态域的高级毛玻璃二级容器 (`blur(24px) saturate(180%)`)。用户可一键将散落节点吸附归属至目标分组，全程搭载自定义流体物理引擎 `cubic-bezier(0.25, 1, 0.5, 1)`，关闭与渲染状态数据流全程无缝平滑自洽。
- **自适应退避心跳引擎 (Adaptive Backoff Heartbeat)**: 重构了底层的 DOM 同步检测逻辑。去除了高频定时的 `2.5s` 强制查询，引入了智能自适应退避算法 (Adaptive Backoff Polling)。在用户界面闲置、DOM 无变动时，健康检查频率会自动平滑衰减至休眠态（上限 `10s`），从根本上消除了扩展在长驻留时的 CPU 功耗和内存溢出可能。
- **流体交互动力学完整实装 (Fluid Motion Dynamics)**: 彻底移除了代码库中所有残留的标准或线性缓动曲线 (`cubic-bezier(0.25, 0.1, 0.25, 1)`)，严格在全局注入自定义自然物理曲线 `cubic-bezier(0.25, 1, 0.5, 1)`。现在不论是弹窗、折叠面板、还是按钮微交互，均具备高度一致的“急速启动、柔和触底”的高级悬浮感。

### Changed
- **防御性自动化降级 (Defensive Automation)**: 增强了 `Batch Delete` (批量删除) 引擎在寻址原生删除对话框时的健壮性。弃用了单一不可靠的硬编码文本匹配机制（如中文的“确定”或英文的“Delete”），引入了对 Angular Material 底层 Component Class (`primary`, `warn`) 以及 Aria 语义图标 (`mat-icon check`) 的优先级探勘，确保宿主文案变更时静默删除依然百分百闭合。

### Fixed
- **超限监听性能损耗止损 (MutationObserver Throttle)**: 修正了监听器挂载源过于宽泛导致的性能泄漏问题。精准移除了对 `characterData` 的无意义监听，直接削减了因内部 Spinner 和进度条跳动引发的海量无效重绘运算。

## [2026-03-01] [2.1.1]

### Added
- **架构解耦**: 引入 Background Service Worker (`background.js`)，将全部 `chrome.storage` 相关状态持久化逻辑由 Content Script 迁移至后台，建立 Message Passing 通信机制。
- **批量删除强力清理与极速引擎 (Batch Delete)**: 在界面顶部栏新增 “Batch Delete” 动作按钮。点击后扩展将进入专注且带有警示视觉效果的红框多选删除模式。扩展内部搭载自动点击异步队列，将原本繁复的手动删除转变为串行稳定的自动化清理引擎。修复了官方执行删除操作时的二次确认弹窗阻塞问题，全自动捕获并隐身点击了原生确定按钮。在用户要求下，现已解锁极速引擎限流器，将串行删除的系统缓冲区由 `450ms` 极限压缩至 `50ms`，实现了近粹“一键秒删全清”的瞬时视觉体验。
- **加载状态 (Loading State) 视觉呈现**: 彻底分离了此前被统一归类为 `isFailed`（导入失败）的盲区逻辑。现在当官方接口仍在解析刚刚上传的文件时，扩展 UI 会智能探测其 DOM 进度，并极其优美地展现为一个匀速旋转的加载环 (`.sp-spinner`) 结合文本呼吸灯动画 (`pulse-text`)。解析完毕的瞬间，会自动无缝过渡为可用勾选框状态。
- **全局毛玻璃 (Global Glassmorphism)**: 深度贯彻 Apple HIG 设计语言。将插件顶部的控制栏 (`.sp-controls`) 升级为吸顶半透明模糊材质，来源列表滚动时会出现惊艳的越界透底效果。同时通过在全局空间暴力注入补丁，强行将 Google 素材库呆板的白色/深色菜单背景 (`mat-menu-panel`, `mat-dialog-container`) 覆写为了带有 `blur(20px)` 及极强饱和度的高级毛玻璃组件。现在整个空间具有了高度一致的跨层级立体感。
- **文件夹生命周期入场动画 (Entry Animation)**: 改善了新建文件夹时 DOM 瞬间闪现生硬的问题。现在当用户点击“新建分组”时，通过底层数据注入一次性 `isNewlyCreated` 标签的方法配合 CSS `@keyframes`，让新文件夹会如同苹果原生界面一般，带着 0.4 秒的阻尼弹性（`cubic-bezier(0.25, 0.1, 0.25, 1)`）从略微偏下缩小的地方平滑浮现，极大提升了层级的空间生机感。
- **国际化多语言支持 (i18n)**: 全面重构了原本硬编码在 DOM 节点里的 UI 词汇表。现通过引入底层的 Chrome 原生 `chrome.i18n` 自动化引擎架构，完美实现了用户词条（如“批量删除”、“解析中”）的中、英原生级无缝切换展示。设定了安全稳固的英文 (en) 兜底策略，以及专供适配的简体中文 (zh_CN) 原生级翻译配置结构库，彻底为全球 Web Store 商店上架扫除了最后一道障碍。
### Fixed
- **XSS 安全漏洞修复**: 移除了 `content.js` 中存在长期的 `innerHTML` 使用导致的安全盲区 (Technical Root Cause)，全面重写渲染模块并封装了原生的 `document.createElement` DOM API 映射。
- **扩展上下文失效防御**: 修复了当机重载扩展（Reload）并且旧标签页未刷新时，旧版 Content Script 强行尝试使用 `chrome.runtime.sendMessage` 通信而抛出的 `Uncaught Error: Extension context invalidated` 致命报错，现彻底加入了柔性降级的 `try...catch` 拦截捕获。
- **CSS 污染预防**: 防御性编程升级，重构了 `content.js` 的 `DEPS` 字典，现在严格优先以 `data-testid` 和等强语义标记寻找 DOM，大幅降低由于宿主页面混淆类名改变带来的失效风险。
- **来源列表自动刷新修复**: 解决了用户在官方接口添加新来源后，插件面板不同步的问题。根本原因 (Technical Root Cause) 是 SPA 框架会在列表变更时销毁重建内部容器，导致 `MutationObserver` 脱落。修复逻辑采用双层架构：第一层将 DOM 监听锚点上浮挂载到生命周期更长的祖先级 `sourcePanel` 上；第二层增加低耗时轻量同步心跳（每 2.5 秒安全检测一次列表数），若元素失配直接静默重绘自愈。
- **打勾动画群起 BUG (Animation Overplay)**: 修复了当 DOM 进行列表重绘（如自动刷新或新建分组）时，所有已选中的来源同时重播炫酷出场动画导致视觉极度杂乱的问题。根本原因在于浏览器将新插入的节点视为状态首置。解决方法：将基础的选中状态分离，只在监听到用户主动点击交互瞬间注入 `.is-animating` 类，使其严格遵从静默更新。
- **原生弹窗视觉闪落 (Visual Flicker)**: 在大规模批量执行自动化点击引擎时，引入了临时高级别 CSS 隐身斗篷拦截（Transient CSS Overrides）。在处理期间通过全局注入 `opacity: 0 !important; pointer-events: none !important;` 彻底覆盖官方弹窗的渲染期。此举配合之前的弹窗确认穿透实现了绝对无感的静默删除。

### Changed
- **视觉风格演进**: 深度落实 Apple HIG 设计理念，全局强制应用全新的动画参数 (`0.3s cubic-bezier(0.25, 0.1, 0.25, 1)`)，并将原生弹出菜单及各挂载容器统一切换为基于 `12px` 栅格比例的自然圆角。

### Added (新增文档)
- **Git 版本管理大师核心指南**: 编写了 `GIT_COMMANDS_GUIDE.md`，从初始化、暂存、分支合并、远程同步到“救命级”撤销机制，深度梳理了专业 Git 开发流程。
- **终端指令全景指南**: 编写了 `TERMINAL_COMMANDS_GUIDE.md` 终端核心命令教程，架构化梳理了从目录导航、高危文件操作、日志追踪到进程权限控制的底层逻辑极其高频实战用法。
- **开源部署教程**: 编写了详尽的 GitHub 开源发布教程文件 (`GITHUB_PUBLISH_TUTORIAL.md`)，用架构师视角拆解了从本地 `.gitignore` 拦截、个人鉴权 (PAT) 生成到仓库初始化的完整合规开源出海逻辑。
### Added (新增)
- **UI交互**: 检测并高亮显示导入失败且无法选中的来源文件（红色字体，鼠标悬停提示“来源导入失败”，并拦截点击事件）。

### Fixed (修复)
- **样式问题**: 修复了整个界面右侧有时会意外出现滚动条的问题。
- **UI定位**: 修复了菜单的定位异常问题。

### Changed (优化)
- **代码重构**: 优化了代码结构和渲染逻辑以提升扩展的响应速度。
