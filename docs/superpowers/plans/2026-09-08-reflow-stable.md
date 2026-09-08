# Reflow Stable Promotion Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 按用户“没有问题才转正”的条件评估避让拖拽；只有验收证据支持时才移除 Beta 标识。

**Architecture:** 保留现有 `dragMode: classic | reflow` 实现和数据结构。用独立代码审查、真实鼠标拖放的持久化验收和既有性能基准判断是否可以转正；仅对证实的问题修改运行时。

**Tech Stack:** Chrome MV3、原生 JavaScript、Jest、Playwright Chromium。

**Spec:** `UI_GUIDELINES.md` §13.4 是拖拽行为合同；用户 2026-09-08 要求在仔细检查没有问题后把 Beta 模式改为正式版。

## Global Constraints

- 保留 `classic` 默认值、现有用户选择、全部 storage key 和权限。
- 真实 Notebook 页面只读；拖放和数据写入验证使用独立临时浏览器配置及合成 Notebook。
- 不把测试全部通过解释为所有设备、全部未来 Notebook DOM 都不会有问题。
- 保留用户原有 AGENTS、CHANGELOG Agent 条目和目录入口改动；本地提交，不推送。
- 本轮不新建日期发布段；新变更记录在现有 Unreleased，安装包沿用当前本地 `26.9.8`。

### Task 1: Independent readiness review

**Files:** `content-tree-interactions.js`、`content-tree-placement.js`、`content-drag-reflow.js`、`content-drag-multi.js`、preferences/settings 及对应测试。

- [x] 独立复核落点、批量顺序、无效操作、取消/清理、过滤/虚拟化与偏好迁移。
- [x] 运行完整 `npm run benchmark:drag`，逐项对照 `docs/DRAG_PERFORMANCE_BASELINE.md`，不能只看进程成功。
- [x] 运行 `npm run benchmark:manager` 并逐项核对。窗口化和其余交互通过；5000 来源搜索 p95=735.3ms 超过 250ms，转正门槛未通过。

### Task 2: Trusted drag acceptance

**Files:** Create `tests/smoke/reflow-stable.smoke.spec.js`；有失败才修改已定位的运行时文件。

**Interfaces:** 使用现有 `launchExtensionContext` 和 `installNotebookFixture`；以 Playwright mouse 触发真实 dragstart/dragover/drop，Chrome storage 独立读回最终树。

- [x] 验证单条来源插到根层文件夹之间，实际落点、撤销、重做和刷新一致。
- [x] 验证两个文件夹与未分组三处的非连续多选拖放完整、有序；窄面板取消与现有无效 payload 回归不改变存储。
- [x] 先红后绿修复 drop 身份不匹配、旧取消定时器干扰新拖动；不人工补 DataTransfer 或预设反馈 class 使真实鼠标用例通过。
- [x] 以独立 260 来源 fixture 复现跨窗口重新挂载后选中行未折叠。该问题尚未修复，记录为转正前剩余工作，不调整测试或基准掩盖它。

### Task 3: Promotion and delivery

**Files:** `_locales/{en,es,zh_CN}/messages.json`、`README.md`、`UI_GUIDELINES.md`、`docs/PROJECT_DIRECTORY.md`、`CHANGELOG.md`；必要的活跃代码/测试注释；`docs/DRAG_REFLOW_STABILITY.md`。

- [x] 评估是否满足转正条件：不满足。保留三语 Beta 文案和 Classic 默认，不执行有条件的转正改动。
- [x] 在稳定性报告记录审查结论、测试范围、真实 benchmark 数字、设备/浏览器和限制。
- [x] 完成 lint、52 suites / 1830 unit、40 smoke、3 个真实拖放场景重复三轮 9/9、最终四组合 drag benchmark、package、ZIP/source 一致性与 diff 检查。5000 manager gate 的失败单独保留，不算通过。
- [x] 独立复核两项修复与验收测试，精确暂存本轮文件；本地提交结果以本计划所在 commit 为准，不推送。
