# 项目目录与功能索引

这份文档是给维护者和 AI agent 用的代码地图。目标是先定位功能域，再去读最相关的入口文件和测试，而不是每次重新扫描整个仓库。

## 0. 项目总览

```text
GeminiNotebook-Source-Management
├── 类型: Manifest V3 Chrome extension
├── 运行页面: https://notebook.google.com/*（当前）+ https://notebooklm.google.com/*（兼容）
├── 主功能: 在 Gemini Notebook 来源面板内注入 Shadow DOM manager
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
│   │   │   └── 来源扫描、列表/标签视图识别、折叠标签组、MutationObserver 同步；首次扫描先解析全部 persisted refs，虚拟化/加载中 DOM 返回 structured partial result，staging 后以当前 ready 行 + 未显示持久化占位构造身份并集，完整候选树统一归一化并原子提交后才清 pending、消费 native-delete 标记、重建 parent map/同步 checkbox
│   │   ├── content-native-label-detector.js
│   │   │   └── 原生标签标题清理、可比较归一、label/view-switch 控件识别 helper
│   │   ├── content-source-actions.js
│   │   │   └── 来源三点菜单、精准排序 submenu 分发、详情、重命名、删除、原生 menu/dialog 自动化；点击不可逆原生确认前必须以完整 identity inventory + 显式 totalHint 验证唯一绑定目标，删除只在对话框关闭且新的同类证据共同证明身份消失后成功
│   │   ├── content-source-action-menu.js
│   │   │   └── 来源三点菜单和 submenu item 生成 helper；精准排序 disabled state 委托 Tree Placement resolver，失败来源菜单收口
│   │   ├── content-native-action-coordinator.js
│   │   │   └── Gemini Notebook 原生详情/重命名/删除及 batch-delete 会话的独占操作协调器；将异步步骤绑定到 operation、notebook、manager instance 和稳定来源身份，并只在操作期间挂载宿主 overlay scope
│   │   ├── content-native-checkbox-sync.js
│   │   │   └── 原生 checkbox 状态读取、切换判定、detached 行解析 helper
│   │   ├── content-tree-placement.js
│   │   │   └── 纯分组树放置 Module；集中 validate → plan → commit、四方向精准排序 target 与 render-scoped indexed resolver、entry shape、source XOR、文件夹唯一父级、reachable group 优先级、循环/索引/no-op、批量事务、跨 realm 安全克隆与迭代式原子归一化不变量
│   │   ├── content-tree-interactions.js
│   │   │   └── 分组树、checkbox、可跨重绘恢复草稿、在 filter/isolation/collapse 下强制显示 pending path 且确认前不持久化临时记录的即刻 inline naming、折叠 aria/inert、Select visible/Clear selection、上下文 empty-state CTA 与退出隔离时的 native effective-state 回同步、键盘精准排序、焦点恢复/live-region 播报、批量模式与拖拽 read → plan → write；single/batch drag、新增/删除/移出分组及批量移到未分组通过严格语义 target 适配 Tree Placement，未分组桶以 section rect + 内层 list items host 读取 geometry，批量 payload 必须与可信拖拽会话完全一致，另维护同步 native dropEffect、类型化 geometry snapshot、滚动 delta patch、auto-scroll 静止指针刷新/落下前同步 flush、ResizeObserver/render 失效和 fail-closed 重建
│   │   ├── content-render.js
│   │   │   └── Shadow DOM manager 渲染、严格 owned list/listitem 树语义（含未分组 section → inner list、空态与批量条 wrapper）、上下文控件名称、折叠状态、上下文空状态、列表行、文件夹精准排序控件、批量 toolbar、菜单层；将纯搜索分段映射为安全文本节点与高亮 span
│   │   ├── content-modals.js
│   │   │   └── 首次欢迎、更新介绍、设置、导入预览、标签、移动文件夹、批量标签 modal
│   │   ├── content-search-semantics.js
│   │   │   └── 无 DOM 的统一搜索语义；集中 query 解析、来源上下文、source/group 匹配、高亮词范围及 Unicode 原文索引安全的文本分段
│   │   ├── content-modal-focus.js
│   │   │   └── modal 初始聚焦、Tab trap、Escape 关闭和焦点恢复 helper
│   │   ├── content-modal-welcome.js
│   │   │   └── 首次欢迎 modal 渲染、按钮和反馈入口 helper
│   │   ├── content-modal-whats-new.js
│   │   │   └── 更新介绍 modal 渲染、变更亮点和反馈入口 helper
│   │   ├── content-modal-tag-filter.js
│   │   │   └── tag filter modal：标签搜索、结果计数、无匹配状态、aria-pressed 选中状态和过滤回调 helper
│   │   ├── content-modal-move.js
│   │   │   └── 移动到分组 modal：候选分组列表、modal 内新建目标分组并一次保存移动、实时来源索引预检、通过 Tree Placement 批量追加到目标分组尾部，仅 changed result 后保存/重绘/关闭
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
│   │   │   └── runtime-first LOAD_STATE、raw primary/backup 选择、save/history/import-owned recovery；snapshot 构造会剔除尚未确认初始名称的临时文件夹、关联 edge 与 rename-only 字段；无 DOM 恢复汇总 snapshot sourceStateById、legacy enabled map、root、group children 与 ungrouped 的持久化来源引用；首次虚拟化 partial 先 staging，再以 ready DOM + 持久化占位确定性合并，只有原子提交成功才清 pending，其余同步/placement 失败保留待恢复快照
│   │   ├── content-import-export.js
│   │   │   └── 配置 JSON 导出/导入、size/depth/entry/cycle 校验、source-key remap；preview/apply 共用 canonical placement 与 diff，并在 history/preview/save await 前后校验上下文和运行时指纹，失败回滚不得覆盖并发新状态
│   │   ├── content-undo-history.js
│   │   │   └── 有界事务 Undo/Redo 双栈；critical save 明确成功后才移动栈，失败恢复操作前 runtime 并保留历史项
│   │   ├── content-state-apply.js
│   │   │   └── undo/redo、配置导入/回滚、手动历史/恢复快照与来源修复共用的快照应用 Adapter；先归一化并原子提交树，再更新标签/来源状态、parent map 与原生 checkbox
│   │   ├── content-snapshot-transaction.js
│   │   │   └── Recovery、History、Import Backup 和 Source Repair 共用的串行快照事务；绑定 notebook/manager context，要求明确 critical-save ack，失败恢复运行时并确认回滚落盘
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
│   │   │   └── 旧状态到当前来源的 source-key remap、标签修复与树候选构造；只读取 source/tag record 自有字段，以迭代遍历收集 root/group/bin refs 与深层优先级，最终委托 Tree Placement normalization
│   │   ├── content-tags.js
│   │   │   └── 标签 label/color normalization、usage、增删改
│   │   ├── content-view-state.js
│   │   │   └── 搜索 UI/过滤编排、quick view、隔离视图与 effective enabled 状态；搜索语法和匹配委托统一语义模块
│   │   ├── content-panel-dom.js
│   │   │   └── Gemini Notebook panel 查找、挂载、生命周期、颜色/布局读取
│   │   ├── content-preferences.js
│   │   │   └── 全局偏好 lifecycle Module；默认值/归一化、LOAD/SAVE、单次 load Promise 缓存、四态验证、竞态顺序、乐观更新和失败回滚
│   │   ├── content-developer-logger.js
│   │   │   └── notebook-scoped 脱敏日志、裁剪、加载、追加、导出与清空；仅消费注入的实时 Developer Mode 状态
│   │   ├── content-runtime-state.js
│   │   │   └── runtimeContext getter/setter 绑定 helper
│   │   ├── content-message-router.js
│   │   │   └── popup/background 到 content 的消息分发表
│   │   ├── content-toast-status.js
│   │   │   └── toast 参数归一、保存状态文案 key 和 DOM 清空 helper
│   │   ├── content-diagnostics.js
│   │   │   └── diagnostics JSON 序列化、Error/unhandled rejection 脱敏摘要 helper
│   │   ├── content-drag-multi.js
│   │   │   └── 多源拖拽 presentation helper：selection 解析、单元素 ghost、带实际滚动 callback 的 auto-scroll RAF controller；不拥有树 mutation
│   │   ├── content-drag-reflow.js
│   │   │   └── 拖拽让位 reflow 会话状态：真实 box model/折叠位移测量、类型化 shift delta、可视区动画/离屏静态 transform、被拖项折叠与取消恢复 helper
│   │   ├── content-source-view-switch-controller.js
│   │   │   └── 来源视图切换目标归一、状态字段和 attempt 记录 helper
│   │   ├── content-style-text.js
│   │   │   └── manager 和 overlay 的 CSS 文本；含 row action family 与 `.sp-sr-only` 无障碍 utility
│   │   ├── content-template.js
│   │   │   └── manager shell 模板；含 Undo/Redo 工具栏、主面板保存/恢复状态区、来源 list 与持久化精准排序 polite live region
│   │   └── styles.css
│   │       └── 原生 Gemini Notebook DOM 覆写（manifest content_scripts[0].css 注入，scoped 在 .sources-plus-manager-active；三套 CSS 之一）
│   ├── background/
│   │   └── index.js
│   │       └── service worker；storage 队列、LOAD-after-SAVE raw candidate 读取、revision guard、history、tab focus/open、偏好和日志消息
│   ├── popup/
│   │   ├── popup.html
│   │   ├── index.js
│   │   │   └── toolbar launcher；启用/禁用、聚焦 manager、切换来源视图
│   │   └── styles.css
│   ├── utils/
│   │   ├── index.js
│   │   │   └── el/debounce/isDescendant/getMessage；`el()` 是 XSS 防护核心
│   │   ├── storage-contract.js
│   │   │   └── storage schema/import format 常量、per-notebook key builders、精确 key ownership 与 schema compatibility 的纯共享契约
│   │   └── preference-normalizers.js
│   │       └── 偏好归一化 (11 个 normalizeXxx)；content + background SW 共享，挂 `globalThis.NSM_PREFERENCE_NORMALIZERS`
│   └── assets/
│       ├── icons/
│       └── fonts/
├── tests/
│   ├── content/
│   │   └── content script 单元测试，按功能模块拆分
│   ├── helpers/
│   │   └── content module loader 和 mock DOM harness
│   ├── smoke/
│   │   ├── drag-reflow-layout.smoke.spec.js
│   │   │   └── 真实 Chromium 中的混合/fixed box model 占位、跨 host 多选、preview、滚动恢复、reduced-motion 与原生 Esc/dragend
│   │   ├── manager-performance.smoke.spec.js
│   │   │   └── opt-in 100/500/1000/5000 来源 manager 基准；5 次 warm-up + 20 次测量，临时 content-script 隔离世界按样本记录初始渲染、搜索、Quick View、Tag filter、批量选择、同步输入、DOM mutation、query 与 layout read 的 p50/p95，并在每个样本结束还原原型
│   │   └── 其他 Playwright 真实扩展上下文 smoke，默认 headless
│   ├── background.test.js
│   ├── popup.test.js
│   ├── locales.test.js
│   ├── package.test.js
│   ├── storage-contract.test.js
│   └── utils.test.js
├── docs/
│   ├── PROJECT_DIRECTORY.md
│   ├── DRAG_PERFORMANCE_BASELINE.md
│   │   └── opt-in 100/500 行 reflow 拖拽 Before/After 基线、验收门槛与重复稳定性结果；不进入发布包
│   ├── SECURITY_THREAT_MODEL.md
│   ├── DEVELOPER_LOGGING.md
│   ├── STORAGE_SCHEMA.md
│   ├── MESSAGE_CONTRACTS.md
│   ├── RELEASE_CHECKLIST.md
│   └── superpowers/
│       ├── specs/
│       │   └── 历史设计规格；不是 runtime，也不进入发布包
│       └── plans/
│           ├── 2026-07-26-optimization-hardening-roadmap.md
│           │   └── 数据完整性、拖拽正确性/性能、架构/无障碍三条工作流的总顺序、依赖、验收和回滚门
│           ├── 2026-07-26-storage-integrity-hardening.md
│           │   └── 导入原子性、版本兼容、save/load 队列、恢复点、日志隔离与 storage contract 计划
│           ├── 2026-07-26-drag-correctness-and-performance.md
│           │   └── Classic 跨 notebook、reflow box model、过滤落点、auto-scroll 和 100/500 行热路径计划
│           ├── 2026-07-26-architecture-deepening-and-accessibility.md
│           │   └── Tree Placement/Search/Preferences Module 与键盘精准排序计划；均不是 runtime，也不进入发布包
│           └── 2026-07-30-user-centered-top-10-optimizations.md
│               └── 当前域名、安全删除、事务历史、恢复可见性、常用任务和无障碍 Top 10 的审计证据、实施顺序、验收与回滚边界
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
└── content_scripts on https://notebook.google.com/* + https://notebooklm.google.com/*
    ├── src/utils/index.js
    ├── src/utils/storage-contract.js
    ├── src/utils/preference-normalizers.js
    ├── src/content/content-config.js
    ├── src/content/source-descriptor-helpers.js
    ├── src/content/content-style-text.js
    ├── src/content/content-template.js
    ├── src/content/content-panel-dom.js
    ├── src/content/content-source-action-menu.js
    ├── src/content/content-native-action-coordinator.js
    ├── src/content/content-source-actions.js
    ├── src/content/content-tags.js
    ├── src/content/content-tree-placement.js
    ├── src/content/content-state-reconcile.js
    ├── src/content/content-preferences.js
    ├── src/content/content-developer-logger.js
    ├── src/content/content-runtime-state.js
    ├── src/content/content-message-router.js
    ├── src/content/content-toast-status.js
    ├── src/content/content-toast.js
    ├── src/content/content-state-apply.js
    ├── src/content/content-snapshot-transaction.js
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
    ├── src/content/content-search-semantics.js
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
- 新增、移动或重命名 content helper 时，同步更新 `manifest.json`、`tests/helpers/load-content-module.js`、`tests/helpers/content-test-harness.js` 和本文件的目录树、Runtime 加载树及对应功能域“先看”列表。

## 3. 功能域树

```text
功能域
├── Content runtime / 生命周期
│   ├── 负责
│   │   ├── 防重复实例
│   │   ├── Shadow DOM manager 挂载
│   │   ├── Gemini Notebook SPA route change
│   │   ├── panel reattach
│   │   ├── teardown/reinitialize
│   │   └── cleanup 前同步 flush debounce save，再立即移除 UI/事件源
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
│   │   ├── 从 Gemini Notebook DOM 提取来源标题、key、stable token、fingerprint
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
│   │   ├── 新建分组/子分组后立即命名，只有确认非空名称后才保存，Escape、空名或 editor 无法挂载均回滚临时分组；重命名、删除、折叠同步 list/listitem、aria-expanded/controls、aria-hidden/inert
│   │   ├── 嵌套 children 和 parent map
│   │   ├── 来源/分组拖拽排序
│   │   ├── 批量模式多源拖拽与边缘自动滚动
│   │   ├── 两种拖拽模式（`content-preferences` 的全局 dragMode）：经典（默认，蓝色插入线 .drag-over-top/bottom + 散源落底部桶）/ 避让 Beta（按真实混合 box model/折叠位移形成空槽、折叠 + 让位 + 根层级定位、取消时精确恢复）；自定义 ghost = source-item 行克隆（单源单层 + 多源最多 3 层堆叠 + 右上角数字 badge）
│   │   ├── 避让 dragover 每帧只读一次 geometry snapshot 后纯计算并集中写入；纯滚动按 root/嵌套 children 精确 delta 修补，auto-scroll 无新 dragover 时仍按静止指针合并刷新，drop 前同步消费 dirty geometry，尺寸/render/混合失效时 fail closed 重建
│   │   ├── native dropEffect 只在原始 dragover 事件内由 clean snapshot 同步解析；dirty/missing snapshot 保守 move，未知 payload 为 none，异步 drag frame 不保留 DataTransfer
│   │   ├── reflow transform 使用 source/group 类型化 map；仅可视区 + 一个真实行高 overscan 动画，离屏位移静态应用并在结束/下次 preflight 清理
│   │   ├── 批量选择、Select visible（基于完整逻辑投影选择所有明确可见且 native-operable 的来源，不受 windowing 当前挂载行限制）、Clear selection、Clear hidden selection、可见/隐藏/真实选中数、加入文件夹、添加/移除标签；删除进行中冻结选择变更
│   │   ├── 纯 Tree Placement Interface 集中 entry shape、source XOR、循环拒绝、索引修正、no-op、批量/事务原子提交与 import normalization；single/batch drag、移动到分组、批量/单项移出分组、分组新增/删除、原生来源删除、Classic sweep、来源同步、restore/reconcile、state apply、配置/原生标签导入均已迁移，业务路径不再直接修改放置数组
│   │   ├── 来源三点菜单与文件夹标题栏共用 up/down/in/out 精准排序 resolver；渲染期以单次快照索引计算全部 disabled state，执行时再按实时树重新解析；边界禁用，成功后恢复可见稳定控件焦点并只播报 canonical N/M（过滤视图不改用可见索引，批量模式隐藏文件夹控件）
│   │   ├── 移动 modal 内新建目标文件夹并一次完成移动；也可移到未分组
│   │   └── 批量删除先经过扩展 alertdialog；每个原生确认按钮点击前必须由完整 identity inventory + 显式 native totalHint 验证唯一绑定目标；确认后必须等待 dialog 关闭，并由稳定的同类 inventory 证明目标身份消失、总数减少一且原有 survivors 仍存在才提交本地删除；虚拟窗口卸载、partial scan、缺少/歧义目标 identity、缺少 totalHint 或 DOM 行数变化本身均不构成成功证据，真实删除后的同数量 backfill 仅可由完整 identity/totalHint inventory 正向证明
│   ├── 先看
│   │   ├── src/content/content-tree-placement.js
│   │   ├── src/content/content-tree-interactions.js
│   │   ├── src/content/content-source-sync.js
│   │   ├── src/content/content-state-reconcile.js
│   │   ├── src/content/content-state-apply.js
│   │   ├── src/content/content-drag-multi.js
│   │   ├── src/content/content-drag-reflow.js
│   │   ├── src/content/content-native-checkbox-sync.js
│   │   ├── src/content/content-render.js
│   │   ├── src/content/content-modals.js
│   │   ├── src/content/content-source-actions.js
│   │   ├── src/content/content-source-action-menu.js
│   │   ├── src/content/content-native-action-coordinator.js
│   │   ├── src/content/content-template.js
│   │   └── src/content/content-style-text.js
│   └── 测试
│       ├── tests/content/content-tree-placement.test.js
│       ├── tests/content/content-tree.test.js
│       ├── tests/content/content-drag-multi.test.js
│       ├── tests/content/content-drag-reflow.test.js
│       ├── tests/content/content-native-checkbox-sync.test.js
│       ├── tests/content/content-render.test.js
│       ├── tests/content/content-source-actions.test.js
│       ├── tests/content/content-source-action-menu.test.js
│       ├── tests/locales.test.js
│       ├── tests/smoke/drag-reflow-layout.smoke.spec.js
│       └── tests/smoke/drag-performance.smoke.spec.js（仅 `npm run benchmark:drag` opt-in）
├── 标签系统
│   ├── 负责
│   │   ├── tag label/color normalization
│   │   ├── tagOrder
│   │   ├── sourceTagsById
│   │   ├── 单来源标签编辑
│   │   ├── tag filter modal 内搜索、结果计数、无匹配状态和 aria-pressed active state
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
│   │   ├── 零来源、搜索无结果、筛选无结果、隔离无结果的不同状态与 Clear search/Clear filters/Show all CTA
│   │   └── effective enabled source 计算
│   ├── 先看
│   │   ├── src/content/content-search-semantics.js
│   │   ├── src/content/content-view-state.js
│   │   └── src/content/content-render.js
│   └── 测试
│       ├── tests/content/content-search-semantics.test.js
│       ├── tests/content/content-view-state.test.js
│       ├── tests/content/content-render.test.js
│       ├── tests/content/content-module.test.js
│       └── tests/manifest-loader-sync.test.js
├── 深树 / 大列表性能
│   ├── 负责
│   │   ├── 保留 50 层导入兼容，同时使用迭代遍历避免递归深度风险
│   │   ├── 视觉缩进按每层 12px、最多 8 层显示；完整 breadcrumb 继续用于路径和 ARIA 名称
│   │   ├── 缓存搜索条件和派生计数；搜索输入在 80ms input-to-DOM 总预算内先合并，再立即完成共享 render；普通 schedule 仍每帧最多一次，避免迟到 rAF 超预算
│   │   ├── 240 个及以上逻辑可见来源启用 windowing，上下各 20 行 overscan；聚焦、来源操作和拖拽相关行可越窗固定
│   │   ├── 搜索计数、可见/隐藏批量选择、键盘与拖拽语义始终使用完整 logical projection；DOM 只包含 materialized rows，并按 stable source key 线性 reconciliation
│   │   └── 对 100/500/1000/5000 来源测量初始渲染，并对搜索、Quick View、Tag filter、批量选择和同步输入执行 opt-in 性能门槛
│   ├── 先看
│   │   ├── src/content/content-render.js
│   │   ├── src/content/content-view-state.js
│   │   ├── src/content/content-tree-placement.js
│   │   ├── tests/smoke/manager-performance.smoke.spec.js
│   │   └── package.json 的 `benchmark:manager`
│   └── 测试
│       ├── tests/content/content-render.test.js
│       └── npm run benchmark:manager（opt-in；5 次 warm-up + 20 次测量）
├── 原生来源操作
│   ├── 负责
│   │   ├── 插件三点菜单定位和 submenu
│   │   ├── 来源精准排序 submenu 与 resolver-derived disabled state
│   │   ├── 打开 Gemini Notebook 来源详情
│   │   ├── 触发 Gemini Notebook 原生命名修改
│   │   ├── 触发 Gemini Notebook 原生删除确认
│   │   ├── 失败来源删除入口
│   │   ├── rename/delete/details 和完整 batch-delete 会话互斥；route、manager instance 或来源身份变化即 fail closed
│   │   ├── 原生 overlay 样式只在宿主同时带有 operation-scoped `sources-plus-native-action-active` class 与 `data-nsm-native-action-active="true"` 时生效，并在成功、失败、取消、超时或 teardown 后清理
│   │   └── 删除确认弹窗歧义防护与原生删除后的完整 inventory identity absence proof
│   ├── 先看
│   │   ├── src/content/content-native-action-coordinator.js
│   │   ├── src/content/content-source-actions.js
│   │   └── src/content/content-source-action-menu.js
│   └── 测试
│       ├── tests/content/content-native-action-coordinator.test.js
│       ├── tests/content/content-source-actions.test.js
│       └── tests/content/content-source-action-menu.test.js
├── 欢迎弹窗 / 设置弹窗 / 导入导出 / 原生标签导入
│   ├── 负责
│   │   ├── 首次欢迎 modal、更新介绍 modal 和反馈入口
│   │   ├── 设置 modal；按“备份与恢复”“偏好设置”“帮助与反馈”组织，保存状态在标题栏显示；主 manager 同步显示 persistent save/stale/recovery 状态和就地操作
│   │   ├── Move modal 内新建目标文件夹并一次保存移动；Tag filter modal 搜索标签
│   │   ├── export/import config JSON 与版本历史恢复入口
│   │   ├── import diff preview；说明替换语义、来源启用变化、文件夹/tag 差异和设置变化
│   │   ├── import size/count/depth 与 Tree Placement entry/missing-group/cycle 严格校验；非法 entry、缺失分组或循环直接拒绝，不按内部恢复规则修剪；group/tag/source 可选字段、children 及 tree entry type/key/id 只读取对象自有属性，remap 用安全 own-field define 写回
│   │   ├── source remap preview；preview/apply 消费同一 canonical placement，重复来源与 live orphan 按 group → root → 未分组归一化
│   │   ├── apply 前等待 history 后重新核对 preview、来源集合、persistable runtime 与 transient selection/batch 指纹；save 无论成功失败都再次核对 notebook/manager/runtime/transient 上下文，失败只在导入结果仍是当前状态时回滚
│   │   ├── 设置页命令面板入口和 command palette modal；复用现有搜索、视图、设置、标签和批量操作入口，并允许用户为每个命令自定义快捷键；重复触发可收起搜索、退出快速视图或关闭对应 modal
│   │   ├── 仅在检测到来源匹配问题时独立突出显示 Source Repair，否则收进帮助/排查区域
│   │   ├── 原生 Gemini Notebook 标签导入 preview
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
│       ├── tests/content/content-modal-move.test.js
│       ├── tests/content/content-modal-tag-filter.test.js
│       ├── tests/content/content-native-label-import-controller.test.js
│       ├── tests/content/content-native-label-import-modal.test.js
│       ├── tests/content/content-persistence.test.js
│       ├── tests/content/content-import-export.test.js
│       ├── tests/content/content-state-apply.test.js
│       ├── tests/content/content-tree-placement.test.js
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
│   │   ├── src/content/content-preferences.js（runtime state + setter + rollback）
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
│   │   ├── schemaVersion 5 和 sourceStateById[sourceKey].addedAt
│   │   ├── background FIFO、revision guard、equal-revision conflict
│   │   ├── runtime-first LOAD_STATE 与 metadata-first raw primary/backup 兼容性选择
│   │   ├── previous-primary backup rotation 与 history；首次验证保存可镜像当前 primary，后续保存先将旧 verified primary 旋转到 backup，再写新 primary；工具栏、命令面板与 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z、Ctrl+Y 暴露 Undo/Redo
│   │   ├── Recovery、History、Import Backup、Source Repair 共用串行 snapshot transaction；只有明确 save `{ ok: true }` 且 recovery 清理确认后完成，已落盘但清理失败也结构化失败并回滚；Recovery Restore 在 target/rollback save 期间保留原 recovery payload，清理失败保留该 payload 的 Restore/Refresh
│   │   ├── Undo/Redo 双栈均有界；应用目标 snapshot 后等待 critical save `{ ok: true }` 才移动栈，失败恢复操作前 runtime 并保持栈不变
│   │   ├── lifecycle critical save、import-owned session recovery 与 A→B import completion 隔离
│   │   ├── deferred initial load
│   │   ├── 旧状态 source-key remap 后统一 normalize；first/later sync 保留完整候选到 Tree Placement，再按 reachable group → root → bin 修剪重复与循环边
│   │   ├── scan 返回 `{ ok, shouldUpgradeStorage, reason, completeness, observedIdentityKeys, totalHint }`；native inventory 另以 `hasAuthoritativeTotal` 标出完整 identity 数量与显式 totalHint 是否一致，删除证明不得以 DOM rowCount 补充缺失的 totalHint。`completeness` 区分 complete/partial/virtualized/loading，单次缺失与等数量滑窗替换不得移除旧来源；首次非完整扫描会安全 staging 完整持久化树，再将当前 ready DOM 与未显示持久化占位合并，成功提交后清 pending；普通 partial/reconcile/placement 失败保持现状，partial 初始扫描仍传递旧 schema upgrade 标记
│   │   └── undo/redo、配置导入/回滚、手动历史/恢复快照与来源修复共用 state-apply Adapter；初始 LOAD_STATE 的无 DOM restore 使用独立 staging，汇总 snapshot sourceStateById、sourceTagsById、legacy enabled map、root、group children 与 ungrouped 的持久化来源引用，兼容只有旧树或 tag assignment 引用的快照，再经 Tree Placement 原子提交；外部 snapshot 的可选字段、group children 与 tree entry type/key/id 只按 own-property 读取，输出以 safe own write 避开原型 setter/只读字段
│   ├── 先看
│   │   ├── src/content/content-persistence.js
│   │   ├── src/content/content-snapshot-signature.js
│   │   ├── src/content/content-state-repair.js
│   │   ├── src/content/content-state-apply.js
│   │   ├── src/content/content-snapshot-transaction.js
│   │   ├── src/content/content-undo-history.js
│   │   ├── src/content/content-import-export.js
│   │   ├── src/background/index.js
│   │   ├── src/content/content-state-reconcile.js
│   │   └── src/content/index.js
│   └── 测试
│       ├── tests/content/content-persistence.test.js
│       ├── tests/content/content-snapshot-signature.test.js
│       ├── tests/content/content-state-repair.test.js
│       ├── tests/content/content-state-apply.test.js
│       ├── tests/content/content-snapshot-transaction.test.js
│       ├── tests/content/content-undo-history.test.js
│       ├── tests/content/content-tree-placement.test.js
│       ├── tests/content/content-state-reconcile.test.js
│       └── tests/background.test.js
├── 开发者日志
│   ├── 负责
│   │   ├── Developer Mode 偏好由 `content-preferences` 持有，index 在启用后显式加载日志
│   │   ├── 脱敏结构化日志
│   │   ├── 500 条 / 约 512 KB 裁剪
│   │   ├── 设置页底部密码入口
│   │   ├── 复制/下载日志
│   │   ├── 清空日志
│   │   └── 从开发者功能区测试欢迎弹窗
│   ├── 先看
│   │   ├── src/content/content-preferences.js
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
│   │   ├── 检测当前 `notebook.google.com` tab，并兼容 `notebooklm.google.com`
│   │   ├── 打开/聚焦 Gemini Notebook，优先当前 canonical 域名
│   │   ├── 聚焦页面内 manager
│   │   ├── 启用/禁用扩展
│   │   ├── 切换来源视图
│   │   └── 只有 content 明确返回 `success: true` 才报告动作完成
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
│   ├── 写入: content -> background SAVE_STATE（normal/lifecycle 共用 per-key FIFO）
│   └── 排障: src/content/content-persistence.js, src/background/index.js
├── sourcesPlusState_<projectId>__backup
│   ├── 用途: 上一代已验证 primary；首次验证保存没有旧 primary 时可镜像当前状态，load 时与 primary 按 metadata/质量择优恢复
│   ├── 写入: background SAVE_STATE 在同 notebook FIFO 内先旋转旧 verified primary，再写新 primary；非法旧 primary 不覆盖已有 verified backup
│   └── 排障: src/background/index.js
├── sourcesPlusHistory_<projectId>
│   ├── 用途: 最近历史快照和手动命名恢复点，支持版本历史和恢复
│   ├── 写入: background SAVE_STATE / APPEND_STATE_HISTORY / DELETE_STATE_HISTORY_ENTRY / CLEAR_STATE_HISTORY；四类 mutation 与 primary/backup 共用同 notebook FIFO，后两者分别携带 exact entryId 或 scope=automatic|all
│   └── 排障: src/background/index.js, src/content/content-persistence.js
├── sourcesPlusPreferences
│   ├── 用途: 全局偏好，包含 developerModeEnabled、welcomeOnboardingSeenVersion、whatsNewSeenVersion、historyRetentionLimit、languageOverride、dragMode、commandShortcuts、visibleQuickViewKinds、appearance
│   ├── 写入: settings / welcome onboarding / manifest-version what’s new / command palette shortcuts / quick view button visibility -> background SAVE_PREFERENCES
│   ├── 读取: LOAD_PREFERENCES 同时返回从 preferences/state/history/log keys 派生的 usageState，用于区分新用户和升级用户
│   └── 排障: src/content/content-preferences.js, src/content/index.js, src/background/index.js
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
    ├── 用途: lifecycle / import 等 critical save 入队时的临时恢复快照
    ├── 失败: background 未确认时保留并标记 reason/failed；不直写 primary
    ├── 优先级: failed import_ack_unknown / import_rollback_required 不被后续 lifecycle 覆盖或清除
    └── 排障: src/content/content-persistence.js

content runtime memory
├── sourceViewKind / sourceViewInfo / sourceViewDisplayKind
│   ├── 用途: 当前 Gemini Notebook 来源视图识别结果、插件显示视图和持久化恢复目标
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
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-persistence.test.js tests/content/content-snapshot-transaction.test.js tests/content/content-import-export.test.js tests/background.test.js
│   └── 文件: tests/content/content-persistence.test.js, tests/content/content-snapshot-transaction.test.js, tests/background.test.js, tests/content/content-import-export.test.js, tests/content/content-state-apply.test.js, tests/content/content-undo-history.test.js
├── Tree Placement consumers / sync / restore / import normalization
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-tree-placement.test.js tests/content/content-state-reconcile.test.js tests/content/content-state-apply.test.js tests/content/content-source-sync.test.js tests/content/content-import-export.test.js tests/content/content-persistence.test.js
│   └── 文件: 上述 6 个测试；覆盖 first/later sync、source remap、cycle/duplicate/orphan、second normalize 幂等、preview/apply 一致、legacy/sourceTags-only 无 DOM persisted-ref source universe、own-property children/entry 读取、non-writable prototype 安全写回、跨 realm group 与原子 commit
├── 原生删除 / 重命名 / 详情
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-native-action-coordinator.test.js tests/content/content-source-actions.test.js tests/content/content-source-action-menu.test.js
│   └── 文件: tests/content/content-native-action-coordinator.test.js, tests/content/content-source-actions.test.js, tests/content/content-source-action-menu.test.js, tests/content/content-source-sync.test.js；覆盖独占 operation/context/identity/宿主 scope 与删除 inventory proof
├── 分组树 / checkbox
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-tree-placement.test.js tests/content/content-source-action-menu.test.js tests/content/content-source-actions.test.js tests/content/content-tree.test.js tests/content/content-render.test.js tests/locales.test.js
│   └── 文件: 上述 6 个测试；覆盖四方向 target、source/group 共用 Interface、边界禁用、submenu、单次 placement/save/render、焦点恢复、匿名位置 live region、三语 key/placeholder 对齐
├── 搜索语义 / 渲染 / 批量操作条
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-search-semantics.test.js tests/content/content-render.test.js tests/content/content-view-state.test.js tests/content/content-module.test.js tests/manifest-loader-sync.test.js
│   └── 文件: tests/content/content-search-semantics.test.js, tests/content/content-render.test.js, tests/content/content-view-state.test.js, tests/content/content-module.test.js, tests/manifest-loader-sync.test.js
├── 欢迎 / 设置弹窗 / 标签 modal / 命令面板
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-modals-tags.test.js tests/content/content-modal-focus.test.js
│   └── 文件: tests/content/content-modals-tags.test.js, tests/content/content-modal-focus.test.js, tests/content/content-modal-tag.test.js, tests/content/content-modal-tag-filter.test.js, tests/content/content-modal-move.test.js, tests/content/content-modal-command-palette.test.js, tests/content/content-modal-welcome.test.js, tests/content/content-modal-whats-new.test.js
├── 原生标签导入确认
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-native-label-import-controller.test.js tests/content/content-native-label-import-modal.test.js
│   └── 文件: tests/content/content-native-label-import-controller.test.js, tests/content/content-native-label-import-modal.test.js
├── content runtime helper
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-toast-status.test.js tests/content/content-diagnostics.test.js tests/content/content-source-view-switch-controller.test.js
│   └── 文件: tests/content/content-toast-status.test.js, tests/content/content-diagnostics.test.js, tests/content/content-source-view-switch-controller.test.js
├── 全局偏好 lifecycle
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-preferences.test.js tests/content/content-lifecycle.test.js tests/background.test.js
│   └── 文件: tests/content/content-preferences.test.js, tests/content/content-lifecycle.test.js, tests/content/content-modal-settings.test.js, tests/content/content-modal-welcome.test.js, tests/content/content-modal-whats-new.test.js, tests/content/content-modal-command-palette.test.js, tests/background.test.js
├── 开发者日志
│   ├── 命令: npm run test:unit -- --runTestsByPath tests/content/content-developer-logger.test.js tests/content/content-persistence.test.js tests/background.test.js
│   └── 文件: tests/content/content-developer-logger.test.js, tests/content/content-persistence.test.js, tests/background.test.js
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
│   ├── 文件: tests/smoke/extension-smoke.spec.js, tests/smoke/batch-drag.smoke.spec.js, tests/smoke/drag-reflow-layout.smoke.spec.js
│   └── 默认: headless，不应该弹出可见浏览器窗口；extension smoke 同时用长批量文案验证 240/320px 窄面板、高倍缩放与跨平台字体度量下无水平溢出
├── 拖拽性能基准（opt-in）
│   ├── 命令: npm run benchmark:drag
│   ├── 文件: tests/smoke/drag-performance.smoke.spec.js, docs/DRAG_PERFORMANCE_BASELINE.md
│   └── 默认: 仅 DRAG_BENCHMARK=1 时执行；100/500 行 × 单项/50 项选择，500 行读取完整 logicalSourceCount/sourceWindowingActive 而非把未挂载行当丢失，按 source-window ordinal 临时挂载 origin 与 callback target；50 项选择同时校验 pendingSelected 和 DataTransfer 完整 50 keys，并单独记录 materialized selection subset。prepare 计时前在真实 pointerdown 后状态完成 settle/全量计数归零，以 isolated-world logical rAF callback ID 精确绑定目标帧；After 四组合及重复 500 行稳定性样本已记录，仍非默认 smoke/CI timing gate
├── Manager 大列表性能基准（opt-in）
│   ├── 命令: npm run benchmark:manager
│   ├── 文件: tests/smoke/manager-performance.smoke.spec.js
│   ├── 样本: 100/500/1000/5000 来源；每档 5 次 warm-up + 20 次测量
│   ├── 聚焦复测: `MANAGER_BENCHMARK_ROWS=500,1000 MANAGER_BENCHMARK_WARMUP_RUNS=1 MANAGER_BENCHMARK_MEASURED_RUNS=3 npm run benchmark:manager` 可限制允许档位与有界样本数；正式发布仍必须不带变量跑 5 + 20 的全四档
│   ├── 门槛: 同步输入 p95 ≤ 16ms；1000 行及以下搜索/Quick View/Tag filter/批量选择 p95 ≤ 100ms；5000 行对应交互 p95 ≤ 250ms
│   └── 输出: commit、CPU/平台、Chromium、p50/p95/max、logical/materialized row 数，以及每样本的 DOM mutation、querySelector/querySelectorAll 和 layout-read count；临时隔离世界 instrumentation 在每个样本结束恢复原型，恢复失败会使基准失败。完成判定读取 render generation 与 logical datasets，不把未挂载 window rows 误判为隐藏；不属于默认 smoke/CI timing gate
└── 完整发布前验证
    └── 顺序: npm run lint → npm run test:unit → npm run test:smoke → npm run benchmark:drag → npm run benchmark:manager → git diff --check → npm run package
```

需要可见浏览器调试 smoke 时才用：

```sh
PLAYWRIGHT_HEADLESS=false npm run test:smoke
```

## 6. 发布与 CI 树

```text
发布前本地检查
├── npm run lint
├── npm run test:unit
├── npm run test:smoke
├── npm run benchmark:drag
├── npm run benchmark:manager
├── git diff --check
└── npm run package

release zip
├── 生成脚本: scripts/package.js
├── 输出路径: release/gemininotebook-source-management-<version>.zip
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
└── release/gemininotebook-source-management-<version>.zip
```

## 7. Agent 快速定位树

```text
我要改/查
├── manager 不挂载或路由切换后消失
│   ├── 先看: src/content/index.js
│   ├── 然后看: src/content/content-panel-dom.js
│   ├── 测试: content-lifecycle.test.js, smoke
│   └── 注意: Gemini Notebook 是 SPA，优先查 beginManagerCleanup 的 flush → cleanup 时序、teardown/reinitialize/panel lifecycle
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
├── 键盘精准排序不可用、重复移动或焦点丢失
│   ├── 先看: src/content/content-tree-placement.js
│   ├── 然后看: src/content/content-source-action-menu.js, src/content/content-source-actions.js, src/content/content-tree-interactions.js, src/content/content-render.js, src/content/content-template.js
│   ├── 测试: content-tree-placement.test.js, content-source-action-menu.test.js, content-source-actions.test.js, content-tree.test.js, content-render.test.js, locales.test.js
│   └── 注意: disabled state 只能来自 resolveDirectionalTarget；source submenu 和 group button 都由原生 button Enter 生成一次 click，执行器负责 fresh resolve → apply → rebuild → render/save → stable-key focus → canonical N/M 播报，no-op 不写 success live region
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
│   ├── 先看: src/content/content-tree-placement.js
│   ├── 然后看: src/content/content-tree-interactions.js, src/content/content-source-sync.js, src/content/content-state-reconcile.js, src/content/content-state-apply.js, src/content/content-persistence.js
│   ├── 测试: content-tree-placement.test.js, content-tree.test.js, content-state-reconcile.test.js, content-state-apply.test.js, content-source-sync.test.js, content-persistence.test.js
│   └── 注意: 内部 sync/restore consumer 应构造完整候选后调用 normalize/commit，由 Tree Placement 修剪重复与循环；首次来源扫描必须先解析全部 persisted refs，structured partial/failure 不得清空现有树，partial-initial staging 后要把 ready DOM 与持久化占位按身份合并。原生删除 marker 的“授权本地删除”与“允许清理 marker”必须分离：仅 ready panel 的过滤前 raw DOM 已不再观察到对应 key/identity，且 replacement tree 成功提交后才能消费；stale raw row、loading/partial 或 placement failure 都必须保留。配置导入遇到非法 entry、缺失分组或循环必须直接拒绝。仅 snapshot construction 与 Tree Placement 可直接写 placement 数组
├── 标签创建/颜色/排序错
│   ├── 先看: src/content/content-tags.js
│   ├── 然后看: src/content/content-modals.js, src/content/content-render.js
│   ├── 测试: content-modals-tags.test.js
│   └── 注意: tag label/color 都要 normalize
├── 导入 JSON 报错或状态丢失
│   ├── 先看: src/content/content-import-export.js
│   ├── 然后看: src/content/content-state-apply.js, src/content/content-tree-placement.js, src/content/content-persistence.js, src/content/index.js
│   ├── 测试: content-import-export.test.js, content-state-apply.test.js, content-tree-placement.test.js, content-persistence.test.js
│   └── 注意: 先看 size/count/depth 与 entry/missing-group/cycle 校验，再核对 source remap 后 preview/apply 是否使用同一 canonical state；外部 group/tag/source 字段、children 与 tree entry type/key/id 只读 own-property，remap 不得用会触发原型 setter/只读字段的普通赋值；history/save await 前后须同时核对 persistable snapshot、transient selection/batch 和 notebook/manager 上下文，save 成功响应也不能跳过复核，失败回滚不得覆盖较新的运行时状态
├── 原生标签导入不完整
│   ├── 先看: src/content/content-native-label-import.js
│   ├── 然后看: src/content/content-native-label-import-controller.js, src/content/content-source-sync.js
│   ├── 继续看: src/content/index.js, src/content/content-modals.js, src/content/content-native-label-import-modal.js
│   ├── 测试: content-source-sync.test.js, content-native-label-import.test.js, content-native-label-import-controller.test.js, content-native-label-import-modal.test.js
│   └── 注意: preview 应尽量只读 DOM，必要展开后尝试恢复
├── 保存失败 / stale revision / quota
│   ├── 先看: src/utils/storage-contract.js, src/content/content-persistence.js
│   ├── 然后看: src/background/index.js, docs/STORAGE_SCHEMA.md, docs/MESSAGE_CONTRACTS.md
│   ├── 测试: storage-contract.test.js, content-persistence.test.js, background.test.js
│   └── 注意: 正常读写都先走 background FIFO；直接 storage 读取仅用于 runtime-unavailable 回退，直接写入仅用于允许降级的非 import/lifecycle 保存
├── 开发者日志没记录
│   ├── 先看: src/content/content-preferences.js, src/content/content-developer-logger.js
│   ├── 然后看: src/content/index.js, src/content/content-diagnostics.js, src/background/index.js, src/content/content-modals.js
│   ├── 测试: content-preferences.test.js, content-developer-logger.test.js, content-persistence.test.js, content-diagnostics.test.js
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
├── Gemini Notebook DOM
│   ├── 不可信输入: title, label, icon URL, attributes, row identity
│   ├── 不要硬编码 Gemini Notebook 生成 class
│   └── 优先使用 aria、role、data 属性、稳定文本信号和相对结构
├── DOM 安全
│   ├── 不要对用户内容使用 innerHTML
│   ├── 不要使用 eval 或动态 Function
│   └── 渲染字符串应走 el() 的 text node 路径
├── icon URL
│   ├── 风险: 浏览器侧请求泄漏隐私，不是 SSRF
│   ├── 允许: Gemini Notebook/Google-owned 静态内容域、当前扩展 URL、Gemini Notebook blob、小体积 raster data URL
│   └── 其他: 回退 glyph icon
├── 原生 destructive action
│   ├── 删除/重命名前必须重新解析 fresh row
│   ├── 必须校验目标身份
│   ├── 批量删除必须先经过扩展 alertdialog，取消不得触发 native click 或本地 marker
│   ├── dialog ambiguous 时 fail closed
│   ├── title 明显冲突时 fail closed
│   └── 点击不可逆确认前必须由完整 identity inventory 与显式 native totalHint 验证唯一绑定目标；删除成功必须在 dialog 关闭后由稳定的同类证据证明：目标身份缺失、总数减少一且原有 survivors 保留；DOM rowCount 不能补充缺失 totalHint，也不是必需条件；同数量 backfill 仅在 totalHint 明确证明 N→N−1 时可成功，partial/virtualized/loading、仅 unmount、目标缺失或重复、row 仍存在、身份歧义或 timeout 都不够
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
│   └── 仓库级 agent 指令；要求每次变更同步检查 CHANGELOG、docs/PROJECT_DIRECTORY.md、content helper 装配、验证矩阵、Gemini Notebook 原生自动化安全和开发者日志脱敏规则
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
├── docs/superpowers/plans/
│   ├── 2026-07-26-optimization-hardening-roadmap.md
│   │   └── 当前优化工作的总优先级、跨计划 Interface、交付顺序、集成验收和回滚边界
│   ├── 2026-07-26-storage-integrity-hardening.md
│   │   └── 本地存储、导入、生命周期、history、quota 和 developer-log 数据完整性实施计划
│   ├── 2026-07-26-drag-correctness-and-performance.md
│   │   └── Classic/Reflow 拖拽正确性、真实布局测试与大列表测量实施计划
│   ├── 2026-07-26-architecture-deepening-and-accessibility.md
│   │   └── 深 Module、consumer 迁移、统一搜索语义和键盘排序实施计划
│   └── 2026-07-30-user-centered-top-10-optimizations.md
│       └── 三路用户视角审计产生的 Top 10 优化、逐项实施范围、验收和回滚边界
├── docs/superpowers/reports/
│   └── 2026-07-26-optimization-baseline.md
│       └── 当前优化工作的无变更验证基线、roadmap 起始 SHA、后续专项 red-contract 与 drag benchmark 台账
├── marketing/
│   └── 宣传资料工作区；记录社媒账号矩阵、内容日历、平台打法、素材清单和 X 本地发布工具，不属于扩展 runtime
├── CHANGELOG.md
│   └── 更新日志和写作规范；agent 写入前必须先读顶部规则
├── .agents/rules/code-style-guide.md
│   └── 本地 agent 维护规则，不属于发布包
└── .agent/workflows/always_update_changelog.md
    └── 本地 changelog 更新规则，不属于发布包
```
