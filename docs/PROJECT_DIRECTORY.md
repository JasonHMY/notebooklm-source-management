# 项目目录与功能索引

这份文档是给维护者和 AI agent 用的代码地图。目标是先定位功能域，再去读最相关的入口文件和测试，而不是每次重新扫描整个仓库。

## 0. 项目总览

```text
NotebookLM Source Management
├── 类型: Manifest V3 Chrome extension
├── 运行页面: https://notebooklm.google.com/*
├── 主功能: 在 NotebookLM 来源面板内注入 Shadow DOM manager
├── 数据层: chrome.storage.local + sessionStorage recovery
├── 后端: 无后端、无数据库、无认证服务
├── 主入口
│   ├── Content script: src/content/index.js
│   ├── Background service worker: src/background/index.js
│   └── Toolbar popup: src/popup/index.js
└── 当前 Git 状态
    ├── 本地分支: main
    ├── 远端分支: origin/main
    └── 本文中的“功能分支”指 feature area，不代表真实 Git branch
```

## 1. 仓库目录树

```text
.
├── manifest.json
│   └── MV3 清单、权限、content script 加载顺序、popup/background 入口
├── eslint.config.js
│   └── ESLint 9 flat config；按 src/tests/scripts 分别配 globals；no-undef、no-restricted-syntax (innerHTML)、no-unused-vars (warn)
├── src/
│   ├── content/
│   │   ├── index.js
│   │   │   └── content script 总装配入口；持有运行时状态、消息、生命周期
│   │   ├── content-config.js
│   │   │   └── 选择器、导入限制、schema version、route retry 参数
│   │   ├── source-descriptor-helpers.js
│   │   │   └── 来源标题/key/token/fingerprint/icon/loading/failed 状态识别
│   │   ├── content-source-sync.js
│   │   │   └── 来源扫描、列表/标签视图识别、折叠标签组、MutationObserver 同步
│   │   ├── content-native-label-detector.js
│   │   │   └── 原生标签标题清理、可比较归一、label/view-switch 控件识别 helper
│   │   ├── content-source-actions.js
│   │   │   └── 来源三点菜单、详情、重命名、删除、原生 menu/dialog 自动化
│   │   ├── content-source-action-menu.js
│   │   │   └── 来源三点菜单和 submenu item 生成 helper；失败来源菜单收口
│   │   ├── content-native-checkbox-sync.js
│   │   │   └── 原生 checkbox 状态读取、切换判定、detached 行解析 helper
│   │   ├── content-tree-interactions.js
│   │   │   └── 分组树、拖拽、checkbox、批量模式交互
│   │   ├── content-render.js
│   │   │   └── Shadow DOM manager 渲染、列表行、批量条、菜单层
│   │   ├── content-modals.js
│   │   │   └── 首次欢迎、更新介绍、设置、导入预览、标签、移动文件夹、批量标签 modal
│   │   ├── content-modal-focus.js
│   │   │   └── modal 初始聚焦、Tab trap、Escape 关闭和焦点恢复 helper
│   │   ├── content-modal-welcome.js
│   │   │   └── 首次欢迎 modal 渲染、按钮和反馈入口 helper
│   │   ├── content-modal-whats-new.js
│   │   │   └── 更新介绍 modal 渲染、变更亮点和反馈入口 helper
│   │   ├── content-modal-tag-filter.js
│   │   │   └── tag filter modal：标签列表、选中状态、过滤回调 helper
│   │   ├── content-modal-move.js
│   │   │   └── 移动到分组 modal：候选分组列表、确认/取消 helper
│   │   ├── content-modal-command-palette.js
│   │   │   └── 命令面板 modal：命令搜索、快捷键展示、触发执行 helper
│   │   ├── content-modal-tag.js
│   │   │   └── 单/批量标签编辑 modal：现有标签选择、新建、保存 helper
│   │   ├── content-modal-settings.js
│   │   │   └── 设置 modal：备份恢复、偏好、帮助/反馈分组渲染 helper
│   │   ├── content-snapshot-signature.js
│   │   │   └── 快照签名归一化、save revision 解析、storage 配额错误识别 helper
│   │   ├── content-state-repair.js
│   │   │   └── 受损分组树结构修复候选筛选、合并和 grouped-source-key 扫描 helper
│   │   ├── content-persistence.js
│   │   │   └── save/load/history/recovery 持久化 helper
│   │   ├── content-import-export.js
│   │   │   └── 配置 JSON 导出/导入、size/depth/cycle 校验、preview diff helper
│   │   ├── content-undo-history.js
│   │   │   └── 撤销/重做栈、容量限制、apply/clear helper
│   │   ├── content-state-apply.js
│   │   │   └── 持久化快照应用到 runtime state 的归一化 helper
│   │   ├── content-toast.js
│   │   │   └── toast 容器与提示渲染 helper
│   │   ├── content-source-list-scan.js
│   │   │   └── 普通来源列表扫描 helper；原生 checkbox 状态读取
│   │   ├── content-native-label-scan.js
│   │   │   └── 原生标签组扫描 helper；标签头来源数量解析
│   │   ├── content-native-label-import.js
│   │   │   └── 原生标签导入 preview 完整性判断 helper
│   │   ├── content-native-label-import-controller.js
│   │   │   └── 原生标签导入确认阶段来源补齐、分组复用和 group id helper
│   │   ├── content-native-label-import-modal.js
│   │   │   └── 原生标签导入 modal preview 节点生成 helper
│   │   ├── content-source-partial-sync-guard.js
│   │   │   └── partial sync 旧来源保护和 raw URL loading 标记 helper
│   │   ├── content-state-reconcile.js
│   │   │   └── 旧状态到当前来源的 remap、repair、tree reconcile
│   │   ├── content-tags.js
│   │   │   └── 标签 label/color normalization、usage、增删改
│   │   ├── content-view-state.js
│   │   │   └── 搜索、过滤、隔离视图、effective enabled 状态
│   │   ├── content-panel-dom.js
│   │   │   └── NotebookLM panel 查找、挂载、生命周期、颜色/布局读取
│   │   ├── content-developer-logger.js
│   │   │   └── 开发者模式偏好、脱敏日志、导出、清空
│   │   ├── content-runtime-state.js
│   │   │   └── runtimeContext getter/setter 绑定 helper
│   │   ├── content-message-router.js
│   │   │   └── popup/background 到 content 的消息分发表
│   │   ├── content-toast-status.js
│   │   │   └── toast 参数归一、保存状态文案 key 和 DOM 清空 helper
│   │   ├── content-diagnostics.js
│   │   │   └── diagnostics JSON 序列化、Error/unhandled rejection 脱敏摘要 helper
│   │   ├── content-drag-multi.js
│   │   │   └── 多源拖拽 selection 解析、单元素 ghost helper、auto-scroll RAF controller、批量 drop 应用
│   │   ├── content-drag-reflow.js
│   │   │   └── 拖拽让位 reflow 会话状态：被拖项折叠 + 其他项让位形成跟随鼠标的空槽 helper
│   │   ├── content-source-view-switch-controller.js
│   │   │   └── 来源视图切换目标归一、状态字段和 attempt 记录 helper
│   │   ├── content-style-text.js
│   │   │   └── manager 和 overlay 的 CSS 文本
│   │   ├── content-template.js
│   │   │   └── manager shell 模板
│   │   └── styles.css
│   │       └── 原生 NotebookLM DOM 覆写（manifest content_scripts[0].css 注入，scoped 在 .sources-plus-manager-active；三套 CSS 之一）
│   ├── background/
│   │   └── index.js
│   │       └── service worker；storage 队列、revision guard、history、tab focus/open、偏好和日志消息
│   ├── popup/
│   │   ├── popup.html
│   │   ├── index.js
│   │   │   └── toolbar launcher；启用/禁用、聚焦 manager、切换来源视图
│   │   └── styles.css
│   ├── utils/
│   │   ├── index.js
│   │   │   └── el/debounce/isDescendant/getMessage；`el()` 是 XSS 防护核心
│   │   └── preference-normalizers.js
│   │       └── 偏好归一化 (10 个 normalizeXxx)；content + background SW 共享，挂 `globalThis.NSM_PREFERENCE_NORMALIZERS`
│   └── assets/
│       ├── icons/
│       └── fonts/
├── tests/
│   ├── content/
│   │   └── content script 单元测试，按功能模块拆分
│   ├── helpers/
│   │   └── content module loader 和 mock DOM harness
│   ├── smoke/
│   │   └── Playwright 真实扩展上下文 smoke，默认 headless
│   ├── background.test.js
│   ├── popup.test.js
│   ├── locales.test.js
│   ├── package.test.js
│   └── utils.test.js
├── docs/
│   ├── PROJECT_DIRECTORY.md
│   ├── SECURITY_THREAT_MODEL.md
│   ├── DEVELOPER_LOGGING.md
│   ├── STORAGE_SCHEMA.md
│   ├── MESSAGE_CONTRACTS.md
│   ├── RELEASE_CHECKLIST.md
│   └── superpowers/specs/
│       └── 历史设计规格；不是 runtime，也不进入发布包
├── _locales/
│   ├── en/messages.json
│   ├── es/messages.json
│   └── zh_CN/messages.json
├── scripts/
│   └── package.js
│       └── Chrome Web Store zip 打包 allowlist
├── marketing/
│   ├── README.md
│   ├── account-matrix.md
│   ├── content-calendar.md
│   ├── platform-playbooks.md
│   ├── x-publisher/
│   │   └── X OAuth 2.0 PKCE 本地授权、账号验证和人工确认发帖脚本；`.env` 与 `tokens.json` 只保存在本机
│   └── assets/
│       └── 宣传账号、内容排期、平台打法和素材记录；不是 runtime，也不进入发布包
├── .github/workflows/ci.yml
│   └── CI: install -> unit -> smoke -> package -> artifact
├── README.md
├── CLAUDE.md
│   └── Claude Code 项目向导；指向 AGENTS.md 等权威规则，并补充 AGENTS.md 未成文的项目惯例（factory 注册模式、Shadow vs global token 边界、locale 命名、developerLog 4 参数签名等）
├── AGENTS.md
│   └── 仓库级 agent 指令；每次变更前应读取，要求同步维护 CHANGELOG、本目录文件和 changelog 写作规范
├── PRIVACY.md
├── UI_GUIDELINES.md
│   └── 当前 UI 实现事实与后续 UI 变更规范；覆盖 content manager、popup、样式 token、动效和 `.sp-*`/`.popup-*` 组件模式
├── CHANGELOG.md
│   └── 更新日志和写作规范；未发布改动写入顶部 Unreleased，发布时移动到正式版本段
├── node_modules/   # 忽略目录；本地依赖，发布包禁止包含
└── 可生成/本地可选的 ignored 路径
    ├── release/    # npm run package 生成；清理后可以不存在
    ├── output/     # Playwright/调试输出；清理后可以不存在
    └── 旧版本zip/  # 本地旧包归档；不是项目源码，清理后可以不存在
```

本地 agent/编辑器目录：

```text
.agent/
.agents/
.cursor/
.superpowers/
```

这些目录不是扩展 runtime，通常被 `.gitignore` 或发布脚本排除；只作为本机维护规则或 agent 状态参考。

## 2. Runtime 加载树

`manifest.json` 定义三个运行面：

```text
manifest.json
├── permissions
│   ├── storage
│   └── tabs
├── background
│   └── src/background/index.js
├── action popup
│   └── src/popup/popup.html
│       ├── src/popup/index.js
│       └── src/popup/styles.css
└── content_scripts on https://notebooklm.google.com/*
    ├── src/utils/index.js
    ├── src/utils/preference-normalizers.js
    ├── src/content/content-config.js
    ├── src/content/source-descriptor-helpers.js
    ├── src/content/content-style-text.js
    ├── src/content/content-template.js
    ├── src/content/content-panel-dom.js
    ├── src/content/content-source-action-menu.js
    ├── src/content/content-source-actions.js
    ├── src/content/content-tags.js
    ├── src/content/content-state-reconcile.js
    ├── src/content/content-developer-logger.js
    ├── src/content/content-runtime-state.js
    ├── src/content/content-message-router.js
    ├── src/content/content-toast-status.js
    ├── src/content/content-toast.js
    ├── src/content/content-state-apply.js
    ├── src/content/content-undo-history.js
    ├── src/content/content-import-export.js
    ├── src/content/content-diagnostics.js
    ├── src/content/content-source-view-switch-controller.js
    ├── src/content/content-snapshot-signature.js
    ├── src/content/content-state-repair.js
    ├── src/content/content-persistence.js
    ├── src/content/content-source-list-scan.js
    ├── src/content/content-native-label-scan.js
    ├── src/content/content-native-label-import.js
    ├── src/content/content-native-label-import-controller.js
    ├── src/content/content-native-label-import-modal.js
    ├── src/content/content-source-partial-sync-guard.js
    ├── src/content/content-modal-focus.js
    ├── src/content/content-modal-welcome.js
    ├── src/content/content-modal-whats-new.js
    ├── src/content/content-modal-tag-filter.js
    ├── src/content/content-modal-move.js
    ├── src/content/content-modal-command-palette.js
    ├── src/content/content-modal-tag.js
    ├── src/content/content-modal-settings.js
    ├── src/content/content-modals.js
    ├── src/content/content-render.js
    ├── src/content/content-view-state.js
    ├── src/content/content-native-checkbox-sync.js
    ├── src/content/content-drag-multi.js
    ├── src/content/content-drag-reflow.js
    ├── src/content/content-tree-interactions.js
    ├── src/content/content-native-label-detector.js
    ├── src/content/content-source-sync.js
    └── src/content/index.js
```

维护提示：

- content script 没有 bundler，加载顺序就是依赖顺序。
- 每个 content helper 先挂到 `globalThis.NSM_*`，最后由 `src/content/index.js` 组装。
- 改加载顺序前，先确认 `index.js` 依赖的 `NSM_*` helper 已经在前面加载。

## 3. 功能域树

```text
功能域
├── Content runtime / 生命周期
│   ├── 负责
│   │   ├── 防重复实例
│   │   ├── Shadow DOM manager 挂载
│   │   ├── NotebookLM SPA route change
│   │   ├── panel reattach
│   │   └── teardown/reinitialize
│   ├── 先看
│   │   ├── src/content/index.js
│   │   ├── src/content/content-runtime-state.js
│   │   ├── src/content/content-message-router.js
│   │   ├── src/content/content-toast-status.js
│   │   ├── src/content/content-diagnostics.js
│   │   ├── src/content/content-source-view-switch-controller.js
│   │   └── src/content/content-panel-dom.js
│   └── 测试
│       ├── tests/content/content-runtime-state.test.js
│       ├── tests/content/content-message-router.test.js
│       ├── tests/content/content-toast-status.test.js
│       ├── tests/content/content-diagnostics.test.js
│       ├── tests/content/content-source-view-switch-controller.test.js
│       ├── tests/content/content-lifecycle.test.js
│       ├── tests/content/content-module.test.js
│       └── tests/smoke/extension-smoke.spec.js
├── 来源扫描 / 来源描述符
│   ├── 负责
│   │   ├── 从 NotebookLM DOM 提取来源标题、key、stable token、fingerprint
│   │   ├── 提取安全 icon URL
│   │   ├── 识别导入中 loading 行
│   │   └── 识别失败 failed 行
│   ├── 先看
│   │   ├── src/content/source-descriptor-helpers.js
│   │   ├── src/content/content-source-list-scan.js
│   │   ├── src/content/content-native-label-detector.js
│   │   └── src/content/content-source-sync.js
│   └── 测试
│       ├── tests/content/content-source-sync.test.js
│       ├── tests/content/content-native-label-detector.test.js
│       └── tests/content/content-source-list-scan.test.js
├── 列表视图 / 标签视图同步
│   ├── 负责
│   │   ├── 判断原生 list/label view
│   │   ├── 读取 native checkbox / aria-checked
│   │   ├── 切回列表前同步标签组选择
│   │   ├── 持久化并恢复上次 list/label view
│   │   ├── 折叠标签组隐藏 rows 读取
│   │   └── partial sync 保护旧状态
│   ├── 先看
│   │   ├── src/content/content-source-sync.js
│   │   ├── src/content/content-native-label-scan.js
│   │   ├── src/content/content-native-label-import.js
│   │   ├── src/content/content-source-partial-sync-guard.js
│   │   ├── src/content/content-source-view-switch-controller.js
│   │   ├── src/content/index.js
│   │   └── src/popup/index.js
│   └── 测试
│       ├── tests/content/content-source-sync.test.js
│       ├── tests/content/content-native-label-scan.test.js
│       ├── tests/content/content-native-label-import.test.js
│       ├── tests/content/content-source-partial-sync-guard.test.js
│       ├── tests/content/content-source-view-switch-controller.test.js
│       ├── tests/content/content-lifecycle.test.js
│       └── tests/popup.test.js
├── 分组树 / 拖拽 / 批量模式
│   ├── 负责
│   │   ├── 新建、重命名、删除、折叠分组
│   │   ├── 嵌套 children 和 parent map
│   │   ├── 来源/分组拖拽排序
│   │   ├── 批量模式多源拖拽与边缘自动滚动
│   │   ├── 拖拽视觉：折叠 + 让位（无蓝条），自定义 ghost = source-item 行克隆（单源单层 + 多源最多 3 层堆叠 + 右上角数字 badge）
│   │   ├── 批量选择、加入文件夹、添加/移除标签
│   │   ├── 移到未分组
│   │   └── 批量删除入口
│   ├── 先看
│   │   ├── src/content/content-tree-interactions.js
│   │   ├── src/content/content-drag-multi.js
│   │   ├── src/content/content-drag-reflow.js
│   │   ├── src/content/content-native-checkbox-sync.js
│   │   ├── src/content/content-render.js
│   │   ├── src/content/content-modals.js
│   │   └── src/content/content-source-actions.js
│   └── 测试
│       ├── tests/content/content-tree.test.js
│       ├── tests/content/content-drag-multi.test.js
│       ├── tests/content/content-drag-reflow.test.js
│       ├── tests/content/content-native-checkbox-sync.test.js
│       ├── tests/content/content-render.test.js
│       └── tests/content/content-source-actions.test.js
├── 标签系统
│   ├── 负责
│   │   ├── tag label/color normalization
│   │   ├── tagOrder
│   │   ├── sourceTagsById
│   │   ├── 单来源标签编辑
│   │   └── 批量添加/移除标签
│   ├── 先看
│   │   ├── src/content/content-tags.js
│   │   ├── src/content/content-modals.js
│   │   └── src/content/content-render.js
│   └── 测试
│       ├── tests/content/content-modals-tags.test.js
│       └── tests/content/content-render.test.js
├── 搜索 / 过滤 / 隔离视图
│   ├── 负责
│   │   ├── title/tag/folder 搜索
│   │   ├── `tag:` / `folder:` filters
│   │   ├── quick view rail: All / Ungrouped / Disabled / Tag / Recent / Issues；显示按钮由全局 `visibleQuickViewKinds` 偏好控制
│   │   ├── activeQuickViewKind session-only runtime state
│   │   ├── 搜索时自动展开匹配分组
│   │   ├── active isolation group
│   │   └── effective enabled source 计算
│   ├── 先看
│   │   ├── src/content/content-view-state.js
│   │   └── src/content/content-render.js
│   └── 测试
│       ├── tests/content/content-view-state.test.js
│       └── tests/content/content-render.test.js
├── 原生来源操作
│   ├── 负责
│   │   ├── 插件三点菜单定位和 submenu
│   │   ├── 打开 NotebookLM 来源详情
│   │   ├── 触发 NotebookLM 原生命名修改
│   │   ├── 触发 NotebookLM 原生删除确认
│   │   ├── 失败来源删除入口
│   │   └── 删除确认弹窗歧义防护
│   ├── 先看
│   │   ├── src/content/content-source-actions.js
│   │   └── src/content/content-source-action-menu.js
│   └── 测试
│       ├── tests/content/content-source-actions.test.js
│       └── tests/content/content-source-action-menu.test.js
├── 欢迎弹窗 / 设置弹窗 / 导入导出 / 原生标签导入
│   ├── 负责
│   │   ├── 首次欢迎 modal、更新介绍 modal 和反馈入口
│   │   ├── 设置 modal；按“备份与恢复”“偏好设置”“帮助与反馈”组织，保存状态在标题栏显示
│   │   ├── export/import config JSON 与版本历史恢复入口
│   │   ├── import diff preview；说明替换语义、来源启用变化、文件夹/tag 差异和设置变化
│   │   ├── import size/count/depth/cycle 校验
│   │   ├── source remap preview
│   │   ├── 设置页命令面板入口和 command palette modal；复用现有搜索、视图、设置、标签和批量操作入口，并允许用户为每个命令自定义快捷键；重复触发可收起搜索、退出快速视图或关闭对应 modal
│   │   ├── 仅在检测到来源匹配问题时独立突出显示 Source Repair，否则收进帮助/排查区域
│   │   ├── 原生 NotebookLM 标签导入 preview
│   │   └── 密码入口控制的开发者功能 UI；已开启 Developer Mode 时免密码显示
│   ├── 先看
│   │   ├── src/content/content-modals.js
│   │   ├── src/content/content-modal-focus.js
│   │   ├── src/content/content-modal-welcome.js
│   │   ├── src/content/content-modal-whats-new.js
│   │   ├── src/content/content-modal-settings.js
│   │   ├── src/content/content-modal-tag.js
│   │   ├── src/content/content-modal-tag-filter.js
│   │   ├── src/content/content-modal-move.js
│   │   ├── src/content/content-modal-command-palette.js
│   │   ├── src/content/content-import-export.js
│   │   ├── src/content/content-native-label-import-controller.js
│   │   ├── src/content/content-native-label-import-modal.js
│   │   ├── src/content/index.js
│   │   ├── src/content/content-persistence.js
│   │   ├── src/content/content-state-reconcile.js
│   │   └── src/content/content-source-sync.js
│   └── 测试
│       ├── tests/content/content-modals-tags.test.js
│       ├── tests/content/content-modal-focus.test.js
│       ├── tests/content/content-native-label-import-controller.test.js
│       ├── tests/content/content-native-label-import-modal.test.js
│       ├── tests/content/content-persistence.test.js
│       ├── tests/content/content-state-reconcile.test.js
│       └── tests/content/content-source-sync.test.js
├── 外观偏好（appearance customization）
│   ├── 负责
│   │   ├── 设置 modal「外观自定义」分区渲染
│   │   ├── hoverSpotlightEnabled runtime 状态与 setter
│   │   ├── host class 应用（`sp-appearance-no-spotlight`）
│   │   └── appearance 偏好持久化与深合并
│   ├── 先看
│   │   ├── src/content/content-modal-settings.js（section 渲染）
│   │   ├── src/content/content-developer-logger.js（runtime state + setter）
│   │   ├── src/content/content-style-text.js（`:host(.sp-appearance-no-spotlight)` 规则）
│   │   └── src/content/index.js（`applyAppearancePreferencesToHost()`）
│   ├── storage 字段
│   │   └── PREFERENCES_KEY.appearance.hoverSpotlightEnabled
│   └── 测试
│       └── tests/content/content-modal-settings.test.js
├── 持久化 / 恢复 / 状态修复
│   ├── 负责
│   │   ├── buildPersistableState
│   │   ├── save/load
│   │   ├── schemaVersion 4 和 sourceStateById[sourceKey].addedAt
│   │   ├── revision guard
│   │   ├── backup/history
│   │   ├── session recovery
│   │   ├── deferred initial load
│   │   └── 旧状态 remap/repair
│   ├── 先看
│   │   ├── src/content/content-persistence.js
│   │   ├── src/content/content-snapshot-signature.js
│   │   ├── src/content/content-state-repair.js
│   │   ├── src/content/content-state-apply.js
│   │   ├── src/content/content-undo-history.js
│   │   ├── src/content/content-import-export.js
│   │   ├── src/background/index.js
│   │   ├── src/content/content-state-reconcile.js
│   │   └── src/content/index.js
│   └── 测试
│       ├── tests/content/content-persistence.test.js
│       ├── tests/content/content-snapshot-signature.test.js
│       ├── tests/content/content-state-repair.test.js
│       ├── tests/content/content-state-reconcile.test.js
│       └── tests/background.test.js
├── 开发者日志
│   ├── 负责
│   │   ├── Developer Mode 偏好和已开启免密码解锁
│   │   ├── 脱敏结构化日志
│   │   ├── 500 条 / 约 512 KB 裁剪
│   │   ├── 设置页底部密码入口
│   │   ├── 复制/下载日志
│   │   ├── 清空日志
│   │   └── 从开发者功能区测试欢迎弹窗
│   ├── 先看
│   │   ├── src/content/content-developer-logger.js
│   │   ├── src/background/index.js
│   │   ├── src/content/content-modals.js
│   │   └── docs/DEVELOPER_LOGGING.md
│   └── 测试
│       ├── tests/content/content-developer-logger.test.js
│       ├── tests/content/content-modals-tags.test.js
│       └── tests/background.test.js
├── Popup launcher
│   ├── 负责
│   │   ├── 检测当前 tab
│   │   ├── 打开/聚焦 NotebookLM
│   │   ├── 聚焦页面内 manager
│   │   ├── 启用/禁用扩展
│   │   └── 切换来源视图
│   ├── 先看
│   │   ├── src/popup/index.js
│   │   ├── src/background/index.js
│   │   └── src/content/index.js
│   └── 测试
│       ├── tests/popup.test.js
│       └── tests/smoke/extension-smoke.spec.js
├── i18n
│   ├── 负责
│   │   ├── Chrome `chrome.i18n` 文案
│   │   ├── 设置页 Auto / English / Español / 简体中文手动语言覆盖
│   │   ├── manifest 文案
│   │   └── en / es / zh_CN key 对齐
│   ├── 先看
│   │   ├── _locales/en/messages.json
│   │   ├── _locales/es/messages.json
│   │   ├── _locales/zh_CN/messages.json
│   │   ├── manifest.json web_accessible_resources for locale JSON used by content script manual language override
│   │   └── src/utils/index.js
│   └── 测试
│       └── tests/locales.test.js
└── 打包 / 发布 / CI
    ├── 负责
    │   ├── 版本同步
    │   ├── release zip allowlist
    │   ├── forbidden entries 检查
    │   ├── ESLint flat config 静态检查（CI 在测试前跑 `npm run lint`）
    │   └── GitHub Actions 验证
    ├── 先看
    │   ├── scripts/package.js
    │   ├── tests/package.test.js
    │   ├── package.json
    │   ├── manifest.json
    │   ├── eslint.config.js
    │   └── .github/workflows/ci.yml
    └── 测试
        ├── tests/package.test.js
        └── npm run lint
```

## 4. 数据与存储树

```text
chrome.storage.local
├── extensionEnabled
│   ├── 用途: 全局启用/禁用 manager
│   ├── 写入: popup -> background SET_EXTENSION_ENABLED
│   └── 排障: src/background/index.js, src/popup/index.js
├── sourcesPlusState_<projectId>
│   ├── 用途: 每个 notebook 的主状态
│   ├── 内容: root(根层级有序异构数组 group/source), ungrouped(底部未分组桶), groupsById, sourceStateById, tagsById, sourceTagsById, tagOrder
│   ├── 写入: content -> background SAVE_STATE
│   └── 排障: src/content/content-persistence.js, src/background/index.js
├── sourcesPlusState_<projectId>__backup
│   ├── 用途: 主状态备份，load 时择优恢复
│   ├── 写入: background save state
│   └── 排障: src/background/index.js
├── sourcesPlusHistory_<projectId>
│   ├── 用途: 最近历史快照和手动命名恢复点，支持版本历史和恢复
│   ├── 写入: background SAVE_STATE / APPEND_STATE_HISTORY
│   └── 排障: src/background/index.js, src/content/content-persistence.js
├── sourcesPlusPreferences
│   ├── 用途: 全局偏好，包含 developerModeEnabled、welcomeOnboardingSeenVersion、whatsNewSeenVersion、historyRetentionLimit、languageOverride、commandShortcuts、visibleQuickViewKinds
│   ├── 写入: settings / welcome onboarding / manifest-version what’s new / command palette shortcuts / quick view button visibility -> background SAVE_PREFERENCES
│   ├── 读取: LOAD_PREFERENCES 同时返回从 preferences/state/history/log keys 派生的 usageState，用于区分新用户和升级用户
│   └── 排障: src/content/content-developer-logger.js, src/background/index.js
└── sourcesPlusDeveloperLogs_<projectId>
    ├── 用途: 每个 notebook 的脱敏开发者日志
    ├── 限制: 最多 500 条，约 512 KB
    ├── 写入: content logger -> background APPEND_DEVELOPER_LOG
    └── 排障: src/content/content-developer-logger.js, docs/DEVELOPER_LOGGING.md

契约文档
├── docs/STORAGE_SCHEMA.md
│   └── 记录 schemaVersion、storage key、字段用途、迁移、导出和隐私边界
└── docs/MESSAGE_CONTRACTS.md
    └── 记录 popup/content/background message type、sender 校验、key 前缀和错误码

sessionStorage
└── recovery snapshot
    ├── 用途: 页面生命周期 / critical save 前临时恢复快照
    └── 排障: src/content/content-persistence.js

content runtime memory
├── sourceViewKind / sourceViewInfo / sourceViewDisplayKind
│   ├── 用途: 当前 NotebookLM 来源视图识别结果、插件显示视图和持久化恢复目标
│   └── 排障: src/content/content-source-sync.js, src/content/index.js
├── pendingInitialLoadedState
│   ├── 用途: 初始 load 延迟恢复时暂存已加载状态
│   └── 排障: src/content/content-persistence.js, src/content/index.js
└── nativeActionFailureHistory
    ├── 用途: 最近原生 action 失败原因，进入 diagnostics
    └── 排障: src/content/content-source-actions.js, src/content/index.js
```

主状态大致结构：

```json
{
  "schemaVersion": 5,
  "root": [{ "type": "group", "id": "group-id" }, { "type": "source", "key": "source-key" }],
  "ungrouped": ["source-key"],
  "groupsById": {
    "group-id": {
      "id": "group-id",
      "name": "Folder",
      "children": [{ "type": "source", "key": "source-key" }],
      "nativeLabelTitle": "optional native label title"
    }
  },
  "sourceStateById": {
    "source-key": {
      "title": "source title",
      "enabled": true,
      "stableToken": "optional",
      "fingerprint": "optional",
      "nativeLabelTitle": "optional",
      "addedAt": "optional ISO timestamp"
    }
  },
  "tagsById": {},
  "sourceTagsById": {},
  "tagOrder": []
}
```

注意：source title、group name、tag label 都是用户私有组织数据。诊断和开发者日志默认不应该记录这些原文。

## 5. 测试树

```text
测试入口
├── 全部非 smoke 单测
│   ├── 命令: npm run test:unit
│   └── 覆盖: tests/**/*.test.js，排除 tests/smoke
├── 来源扫描 / 标签视图 / loading / failed
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-source-sync.test.js
│   └── 文件: tests/content/content-source-sync.test.js, tests/content/content-source-partial-sync-guard.test.js
├── 持久化 / history / import-export / background storage
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-persistence.test.js tests/background.test.js
│   └── 文件: tests/content/content-persistence.test.js, tests/background.test.js, tests/content/content-import-export.test.js, tests/content/content-state-apply.test.js, tests/content/content-undo-history.test.js
├── 原生删除 / 重命名 / 详情
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-source-actions.test.js tests/content/content-source-action-menu.test.js
│   └── 文件: tests/content/content-source-actions.test.js, tests/content/content-source-action-menu.test.js
├── 分组树 / checkbox
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-tree.test.js
│   └── 文件: tests/content/content-tree.test.js
├── 渲染 / 批量操作条
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-render.test.js tests/content/content-view-state.test.js
│   └── 文件: tests/content/content-render.test.js, tests/content/content-view-state.test.js
├── 欢迎 / 设置弹窗 / 标签 modal / 命令面板
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-modals-tags.test.js tests/content/content-modal-focus.test.js
│   └── 文件: tests/content/content-modals-tags.test.js, tests/content/content-modal-focus.test.js, tests/content/content-modal-tag.test.js, tests/content/content-modal-tag-filter.test.js, tests/content/content-modal-move.test.js, tests/content/content-modal-command-palette.test.js, tests/content/content-modal-welcome.test.js, tests/content/content-modal-whats-new.test.js
├── 原生标签导入确认
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-native-label-import-controller.test.js tests/content/content-native-label-import-modal.test.js
│   └── 文件: tests/content/content-native-label-import-controller.test.js, tests/content/content-native-label-import-modal.test.js
├── content runtime helper
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-toast-status.test.js tests/content/content-diagnostics.test.js tests/content/content-source-view-switch-controller.test.js
│   └── 文件: tests/content/content-toast-status.test.js, tests/content/content-diagnostics.test.js, tests/content/content-source-view-switch-controller.test.js
├── 开发者日志
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-developer-logger.test.js tests/background.test.js
│   └── 文件: tests/content/content-developer-logger.test.js, tests/background.test.js
├── popup launcher
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/popup.test.js
│   └── 文件: tests/popup.test.js
├── i18n
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/locales.test.js
│   └── 文件: tests/locales.test.js
├── 打包 allowlist
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/package.test.js
│   └── 文件: tests/package.test.js
├── manifest 与 content loader 同步
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/manifest-loader-sync.test.js
│   └── 文件: tests/manifest-loader-sync.test.js
├── 扩展真实上下文 smoke
│   ├── 命令: npm run test:smoke
│   ├── 文件: tests/smoke/extension-smoke.spec.js, tests/smoke/batch-drag.smoke.spec.js
│   └── 默认: headless，不应该弹出可见浏览器窗口
└── 完整发布前验证
    └── 命令: npm run test:unit && npm run test:smoke && npm run package && git diff --check
```

需要可见浏览器调试 smoke 时才用：

```sh
PLAYWRIGHT_HEADLESS=false npm run test:smoke
```

## 6. 发布与 CI 树

```text
发布前本地检查
├── npm run test:unit
├── npm run test:smoke
├── npm run package
└── git diff --check

release zip
├── 生成脚本: scripts/package.js
├── 输出路径: release/notebooklm-source-management-<version>.zip
├── 说明: release/ 是生成目录，清理后可以不存在；发布前重新运行 npm run package
├── 允许包含
│   ├── manifest.json
│   ├── src/
│   ├── _locales/
│   └── PRIVACY.md
└── 禁止包含
    ├── node_modules/
    ├── tests/
    ├── release/
    ├── output/
    ├── .git/
    ├── .agent/ 或 .agents/
    ├── .cursor/
    ├── .superpowers/
    └── docs/superpowers/plans/

CI: .github/workflows/ci.yml
├── checkout
├── setup Node 20
├── npm ci
├── npm run lint
├── npx playwright install --with-deps chromium
├── npm run test:unit
├── npm run test:smoke
│   └── env PLAYWRIGHT_HEADLESS=true
├── failure 时上传 output/playwright 和 test-results
├── always run npm run package
└── 上传 release zip artifact

版本同步点
├── manifest.json
├── package.json
├── package-lock.json
├── README version badge
├── CHANGELOG.md
└── release/notebooklm-source-management-<version>.zip
```

## 7. Agent 快速定位树

```text
我要改/查
├── manager 不挂载或路由切换后消失
│   ├── 先看: src/content/index.js
│   ├── 然后看: src/content/content-panel-dom.js
│   ├── 测试: content-lifecycle.test.js, smoke
│   └── 注意: NotebookLM 是 SPA，优先查 teardown/reinitialize/panel lifecycle
├── 来源列表数量不对
│   ├── 先看: src/content/content-source-sync.js
│   ├── 然后看: src/content/content-state-reconcile.js
│   ├── 测试: content-source-sync.test.js
│   └── 注意: 小心 partial sync 保护旧状态，不要把不可见 label view 当删除
├── 标签视图切列表状态错
│   ├── 先看: src/content/content-source-sync.js
│   ├── 然后看: src/content/content-source-view-switch-controller.js, src/content/content-source-partial-sync-guard.js, src/content/index.js
│   ├── 测试: content-source-sync.test.js, content-source-view-switch-controller.test.js, content-source-partial-sync-guard.test.js, content-lifecycle.test.js
│   └── 注意: aria-checked、折叠标签组、pending initial load 都要考虑
├── 新来源导入中不显示
│   ├── 先看: src/content/source-descriptor-helpers.js
│   ├── 然后看: src/content/content-source-sync.js, src/content/content-render.js
│   ├── 测试: content-source-sync.test.js, content-render.test.js
│   └── 注意: raw URL 临时标题、spinner/progress/status 文案都可能是 loading signal
├── 失败来源不显示或不能删
│   ├── 先看: src/content/source-descriptor-helpers.js
│   ├── 然后看: src/content/content-source-actions.js, src/content/content-render.js
│   ├── 测试: content-source-sync.test.js, content-source-actions.test.js
│   └── 注意: 失败来源可能 disabled，但仍需要允许删除入口
├── 三点菜单定位/内容错
│   ├── 先看: src/content/content-source-action-menu.js
│   ├── 然后看: src/content/content-source-actions.js
│   ├── 继续看: src/content/content-render.js
│   ├── 测试: content-source-action-menu.test.js, content-source-actions.test.js
│   └── 注意: 菜单 item 生成逻辑和原生 action 执行逻辑分开排查
├── 三点菜单定位层错
│   ├── 先看: src/content/content-source-actions.js
│   ├── 然后看: src/content/content-render.js
│   ├── 测试: content-source-actions.test.js
│   └── 注意: 菜单 state 在 source actions 模块内，渲染层只展示
├── 删除误报失败或删错来源
│   ├── 先看: src/content/content-source-actions.js
│   ├── 然后看: src/content/index.js 的 accepted delete handler
│   ├── 测试: content-source-actions.test.js
│   └── 注意: destructive action 必须 fresh row 校验、dialog 唯一、fail closed
├── 批量操作条布局错
│   ├── 先看: src/content/content-render.js
│   ├── 然后看: src/content/content-style-text.js
│   ├── 测试: content-render.test.js
│   └── 注意: 不要让隐藏三点按钮改变 grid 列宽
├── 分组树数据损坏
│   ├── 先看: src/content/content-tree-interactions.js
│   ├── 然后看: src/content/content-state-reconcile.js, src/content/content-persistence.js
│   ├── 测试: content-tree.test.js, content-persistence.test.js
│   └── 注意: children 必须容错为数组，避免孤儿 group
├── 标签创建/颜色/排序错
│   ├── 先看: src/content/content-tags.js
│   ├── 然后看: src/content/content-modals.js, src/content/content-render.js
│   ├── 测试: content-modals-tags.test.js
│   └── 注意: tag label/color 都要 normalize
├── 导入 JSON 报错或状态丢失
│   ├── 先看: src/content/content-persistence.js
│   ├── 然后看: src/content/index.js, src/content/content-state-reconcile.js
│   ├── 测试: content-persistence.test.js
│   └── 注意: 先看 size/count/depth/cycle 限制，再看 source remap
├── 原生标签导入不完整
│   ├── 先看: src/content/content-native-label-import.js
│   ├── 然后看: src/content/content-native-label-import-controller.js, src/content/content-source-sync.js
│   ├── 继续看: src/content/index.js, src/content/content-modals.js, src/content/content-native-label-import-modal.js
│   ├── 测试: content-source-sync.test.js, content-native-label-import.test.js, content-native-label-import-controller.test.js, content-native-label-import-modal.test.js
│   └── 注意: preview 应尽量只读 DOM，必要展开后尝试恢复
├── 保存失败 / stale revision / quota
│   ├── 先看: src/content/content-persistence.js
│   ├── 然后看: src/background/index.js, docs/STORAGE_SCHEMA.md, docs/MESSAGE_CONTRACTS.md
│   ├── 测试: content-persistence.test.js, background.test.js
│   └── 注意: 正常写入走 background；直接 storage 写只用于测试/降级路径
├── 开发者日志没记录
│   ├── 先看: src/content/content-developer-logger.js
│   ├── 然后看: src/content/content-diagnostics.js, src/background/index.js, src/content/content-modals.js
│   ├── 测试: content-developer-logger.test.js, content-diagnostics.test.js
│   └── 注意: 开关是全局 preference，日志是 per-notebook key
├── popup 按钮行为不对
│   ├── 先看: src/popup/index.js
│   ├── 然后看: src/background/index.js, src/content/content-message-router.js, src/content/index.js message handlers
│   ├── 测试: popup.test.js, smoke
│   └── 注意: popup 不是主 UI，只负责 launcher/control
├── UI 规范和当前界面不一致
│   ├── 先看: UI_GUIDELINES.md
│   ├── 然后看: src/content/content-style-text.js, src/popup/styles.css, src/popup/popup.html
│   ├── 测试: docs-only 时至少 git diff --check；若改运行 UI 再跑对应 unit/smoke
│   └── 注意: UI_GUIDELINES.md 应描述当前实现事实；如果刻意改变视觉，再同步更新本目录和 changelog
├── 文案缺失
│   ├── 先看: _locales/*/messages.json
│   ├── 然后看: src/utils/index.js 的 getMessage 使用点
│   ├── 测试: locales.test.js
│   └── 注意: 三语言 key 和 placeholder 要同步
├── zip 包异常
│   ├── 先看: scripts/package.js
│   ├── 然后看: tests/package.test.js
│   ├── 测试: tests/package.test.js, npm run package
│   └── 注意: docs 通常不进 zip；runtime allowlist 不要放宽
├── changelog 格式或发布记录
│   ├── 先看: CHANGELOG.md 顶部 Changelog Writing Guidelines
│   ├── 然后看: AGENTS.md 的 Changelog Rules
│   ├── 测试: git diff --check
│   └── 注意: 非发布改动写入顶部 Unreleased；只有版本号和 release zip 同步更新时才创建正式版本段
└── 安全问题
    ├── 先看: docs/SECURITY_THREAT_MODEL.md
    ├── 然后看: src/utils/index.js, src/background/index.js, src/content/source-descriptor-helpers.js
    ├── 测试: 相关模块测试
    └── 注意: DOM 不可信，message/storage 边界要明确
```

## 8. 风险和约束速查

```text
维护约束
├── NotebookLM DOM
│   ├── 不可信输入: title, label, icon URL, attributes, row identity
│   ├── 不要硬编码 NotebookLM 生成 class
│   └── 优先使用 aria、role、data 属性、稳定文本信号和相对结构
├── DOM 安全
│   ├── 不要对用户内容使用 innerHTML
│   ├── 不要使用 eval 或动态 Function
│   └── 渲染字符串应走 el() 的 text node 路径
├── icon URL
│   ├── 风险: 浏览器侧请求泄漏隐私，不是 SSRF
│   ├── 允许: NotebookLM/Google-owned 静态内容域、当前扩展 URL、NotebookLM blob、小体积 raster data URL
│   └── 其他: 回退 glyph icon
├── 原生 destructive action
│   ├── 删除/重命名前必须重新解析 fresh row
│   ├── 必须校验目标身份
│   ├── dialog ambiguous 时 fail closed
│   └── title 明显冲突时 fail closed
├── storage 边界
│   ├── content script 有 chrome.storage.local 权限
│   ├── 正常状态写入仍应走 background
│   └── 依赖 sender/key validation、revision guard、队列保护
├── import JSON
│   ├── 用户辅助输入，仍然不可信
│   └── 必须执行 size/count/depth/cycle/source remap 校验
├── developer logs
│   ├── 默认脱敏
│   └── 不记录来源标题、标签名、分组名、完整 URL、导入 JSON 原文或长 DOM text
└── 变更流程
    ├── AGENTS.md 是仓库级 agent 指令入口；开始改动前应先读取
    ├── 开工检查固定为 AGENTS.md、docs/PROJECT_DIRECTORY.md、CHANGELOG.md 顶部规范和 git status --short
    ├── CHANGELOG.md 是跟踪文件；项目规范要求每次有意义变更都同步更新
    ├── 纯只读检查、状态报告或分析且没有文件改动时，不需要 changelog 条目
    ├── changelog 新改动默认写入顶部 Unreleased，发布时再移动到正式版本段
    ├── 每次更改都要检查 docs/PROJECT_DIRECTORY.md 是否需要同步更新
    ├── 结构、功能域、存储 key、测试入口、发布流程或维护规则变化时必须更新本文件
    ├── 新增或移动 content helper 时同步 manifest.json、tests/helpers/load-content-module.js 和 tests/helpers/content-test-harness.js
    ├── UI、布局、动效、popup 或 manager 视觉变更前必须读取 UI_GUIDELINES.md
    ├── docs-only 变更通常只需要 git diff --check 和链接检查
    ├── content helper 变更至少跑 focused Jest 和 npm run test:unit
    ├── runtime/manifest/storage/message/native automation 变更跑 npm run test:unit、npm run test:smoke、npm run package 和 git diff --check
    ├── smoke 默认使用 headless 的 npm run test:smoke，只有明确交互调试时才使用 PLAYWRIGHT_HEADLESS=false
    ├── 结束时说明工作区是否仍有未提交改动
    └── 不在用户未明确要求时自动 commit 或 push
```

## 9. 相关文档树

```text
文档入口
├── AGENTS.md
│   └── 仓库级 agent 指令；要求每次变更同步检查 CHANGELOG、docs/PROJECT_DIRECTORY.md、content helper 装配、验证矩阵、NotebookLM 原生自动化安全和开发者日志脱敏规则
├── README.md
│   └── 用户和开发者入口说明
├── PRIVACY.md
│   └── 隐私说明
├── UI_GUIDELINES.md
│   └── 当前 UI 实现事实、UI 架构、样式 token、组件命名、动效和视觉约束；改 UI 前先读，改 UI 事实后同步更新
├── docs/SECURITY_THREAT_MODEL.md
│   └── 威胁模型和安全边界
├── docs/DEVELOPER_LOGGING.md
│   └── 开发者模式日志规范
├── docs/STORAGE_SCHEMA.md
│   └── storage key、schemaVersion、迁移、备份/history 和隐私边界
├── docs/MESSAGE_CONTRACTS.md
│   └── popup/content/background 消息、sender 校验、key 前缀和错误码
├── docs/RELEASE_CHECKLIST.md
│   └── 发布检查清单
├── marketing/
│   └── 宣传资料工作区；记录社媒账号矩阵、内容日历、平台打法、素材清单和 X 本地发布工具，不属于扩展 runtime
├── CHANGELOG.md
│   └── 更新日志和写作规范；agent 写入前必须先读顶部规则
├── .agents/rules/code-style-guide.md
│   └── 本地 agent 维护规则，不属于发布包
└── .agent/workflows/always_update_changelog.md
    └── 本地 changelog 更新规则，不属于发布包
```
