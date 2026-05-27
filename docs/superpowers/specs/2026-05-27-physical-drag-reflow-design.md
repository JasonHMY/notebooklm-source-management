# 物理拖拽让位 (Physical Drag Reflow) — 设计 Spec

**日期：** 2026-05-27
**状态：** 已实现 (Implemented)。本文档为当时的设计意图快照，部分 API（`getDropIntent`、`createMultiDragGhost(count)`、`unfoldDraggedItems` 签名等）和视觉行为（折叠/反向展开过渡）已在后续重构中演进；当前实际行为以 [CHANGELOG.md](../../../CHANGELOG.md) 与 [UI_GUIDELINES.md](../../../UI_GUIDELINES.md) §13.4 为准。

## 目标

把当前"原地半透明 + 蓝条插入位置"的拖拽 UI，改成"被拖项从列表离开 + 其他项让位形成空槽 + 平滑过渡"的物理感拖拽 UI。覆盖全场景：单源 + 多源、根列表 + 组内、跨组。

## 范围

**In scope**
- 单源、多源、根列表、组内、跨组的所有拖拽路径
- 折叠 / 让位动画、自定义 ghost、空槽过渡
- 删除蓝条插入指示 (`.drag-over-top` / `.drag-over-bottom`)
- invalid drop 配色沿用现有（不更夸张）

**Out of scope**
- 触摸拖拽（HTML5 native drag 桌面 only）
- 键盘 / 无障碍重排
- 拖拽撤销/重做

## 视觉行为

### 拖起 (dragstart)

- 被拖项 `height` 从缓存的 `offsetHeight` 折叠到 `0`，`opacity` 1→0，200ms 过渡
- 多源：所有选中项同步折叠
- 浏览器默认 dragImage 用透明 canvas 屏蔽（`event.dataTransfer.setDragImage(transparentCanvas, 0, 0)`）
- 鼠标跟随：自定义 pill ghost
  - **只显示数字**（单源="1"，多源=N）
  - 圆角矩形 pill，复用现有 `.sp-drag-ghost` 样式（已包含 macOS/dark mode token）

### 拖动 (dragover)

- 根据指针位置 + 现有 `getDropIntent` 计算 insertIndex / targetList
- 目标位置之后的同级项整体 `translateY(N × itemHeight)`（N = 被拖项数量）
- 已折叠的被拖项不参与位移计算
- transform 过渡：`transform 200ms cubic-bezier(0.2, 0, 0, 1)`
- insertIndex 不变时跳过 DOM 写入

### 组头 dragover

- 沿用现有 hover-expand 计时器（600ms 触发展开 / 收回，不改）
- 组展开后，组内子项进入 DOM 自动被 dragover 计算覆盖

### 跨组

- 源组：被拖项已折叠，源组其余项天然收紧
- 目标组：目标位置后的子项 translateY
- 两边在同一帧内 commit

### Drop（合法）

- DOM 顺序更新前先 commit 所有 transform 归零，再 swap DOM（被新 DOM 顺序"原地接管"，避免跳变）
- height / opacity 立刻恢复，inline style 清空

### Dragend / Cancel（esc 或非法 drop）

- 被拖项 height 反向过渡回原值，opacity 回 1
- 所有位移项 transform 归零
- 200ms 后清理 inline style

### Invalid drop

- 让位仍发生（不让用户怀疑拖拽失效）
- 目标空槽上沿用 `.drag-invalid` 现有红色边框 + 阴影
- drop 时不应用 DOM 更新（仅清理）

### 蓝条

- 删除：CSS `.drag-over-top` / `.drag-over-bottom` 从 `content-style-text.js` 移除
- 删除 JS 中 add/remove 蓝条 class 的代码

## 技术设计

### dragSession（runtime 状态）

dragstart 时建立，dragend / drop 清理：

```js
runtime.dragSession = {
  draggedKeys: Set<sourceKey | groupId>,
  itemHeights: Map<key, number>,           // offsetHeight 缓存
  totalDraggedHeight: number,
  currentIntent: { targetList, insertIndex, targetGroup } | null,
  shiftedItems: Map<key, translateY>,      // 已应用 transform 的项
};
```

### 让位计算 (新模块 `content-drag-reflow.js`)

公开 API：

- `prepareDragSession(draggedKeys, treeContext) → dragSession`
  - 测量每个被拖项的 `offsetHeight`，缓存
- `computeReflow(intent, dragSession, treeContext) → Map<key, translateY>`
  - 根据 intent 算出"目标位置之后的所有同级项"应位移多少
- `applyReflow(itemsToShift, dragSession)`
  - 与 `dragSession.shiftedItems` diff，只更新变化的项的 inline style
  - 写入 `transform: translateY(Npx)`
- `clearReflow(dragSession)`
  - 归零所有已位移项的 transform
- `foldDraggedItems(draggedKeys, dragSession)` / `unfoldDraggedItems(...)`
  - 折叠 / 反向展开

### 与 hover-expand / auto-scroll 协调

- hover-expand / hover-collapse 计时器逻辑不改
- 组展开后子项进 DOM，下一次 dragover 自然被让位计算包括
- 组收回时让位计算从该组退出（intent 已经不在该组）
- auto-scroll 期间持续 dragover，让位实时跟随，不需额外处理

### Ghost

- 复用 `createMultiDragGhost(count)`
- 单源走 count=1 路径，显示 "1"
- 浏览器默认 dragImage 用透明 canvas 屏蔽

### 性能

- dragover 走现有 RAF 节流
- `applyReflow` diff 只写变化项
- `transform` GPU 合成；折叠项用 `will-change: transform, height` 提示

## 文件改动

| 文件 | 类型 | 备注 |
|---|---|---|
| `src/content/content-drag-reflow.js` | Create | 让位计算 / 应用 / 清理 / 折叠 |
| `src/content/content-tree-interactions.js` | Modify | dragstart / dragover / drop / dragend 接入 reflow |
| `src/content/content-drag-multi.js` | Modify | `createMultiDragGhost(count)` 支持 count=1 |
| `src/content/content-style-text.js` | Modify | 删 `.drag-over-top` / `.drag-over-bottom`；加 `.sp-drop-shift` 过渡 + 折叠 class |
| `src/content/index.js` | Modify | 装配新模块 |
| `manifest.json` | Modify | content_scripts 注入 `content-drag-reflow.js` |
| `tests/helpers/load-content-module.js` | Modify | require + `clearContentGlobals` |
| `tests/helpers/content-test-harness.js` | Modify | `CONTENT_HELPER_GLOBALS` 追加 `NSM_CREATE_CONTENT_DRAG_REFLOW` |
| `tests/content/content-drag-reflow.test.js` | Create | 单测 |
| `tests/content/content-tree.test.js` | Modify | dragstart/dragover/drop 断言更新 |
| `tests/smoke/batch-drag.smoke.spec.js` | (no change) | 实际无 `.drag-over-*` 引用，无需修改 |
| `docs/PROJECT_DIRECTORY.md` | Modify | §1 目录、§2 加载顺序、§3 功能域 |
| `UI_GUIDELINES.md` | Modify | drag 章节更新（不再提蓝条） |
| `CHANGELOG.md` | Modify | `## [Unreleased]` 加 Added/Changed/Removed 条目 |

## 测试矩阵

**单测**（新建 `content-drag-reflow.test.js`）
- `prepareDragSession` 测高度并缓存
- `computeReflow` 单源 / 多源 / 根列表 / 组内 / 跨组场景计算正确
- `applyReflow` diff 行为：未变化项不重写
- `clearReflow` 归零所有项
- `foldDraggedItems` / `unfoldDraggedItems` 对 inline style 的写入
- 边界：被拖项是唯一项、被拖项在列表末尾、目标 = 源位置

**集成**（扩展 `content-tree.test.js`）
- dragstart 触发折叠 + ghost
- dragover 触发 reflow（不再有 .drag-over-* class）
- drop 顺序更新 + transform 归零
- dragend cancel 反向折叠
- esc 取消（同 dragend）
- 非法 drop：让位仍发生 + 红色 invalid 视觉 + drop 无 DOM 更新
- 与 hover-expand 协调：dragover 在组头停留触发展开 + 内部让位
- 跨组拖拽：源/目标同步过渡

**Smoke**（`batch-drag.smoke.spec.js`）
- 现有 spec 不引用 `.drag-over-*` 选择器（基于 `drag-into` + drop 后 DOM 状态），让位重构后无需修改

## 风险 / 取舍

1. **HTML5 native drag dragImage 屏蔽不彻底**：setDragImage(transparent) 在某些 Linux 下可能仍残留默认副本。项目用户主要 macOS/Windows Chrome，接受。
2. **嵌套组高度测量**：组内嵌套组时 walk parent chain，加 cache 避免重复测量。
3. **DOM 更新与过渡跳变**：drop 前 commit transform 归零，再 swap DOM。
4. **dragover 高频触发让位**：diff 跳过不变项，RAF 节流已有。
5. **蓝条相关残留**：i18n、注释、文档中的"蓝条"提法一并清理。

## 实施分期（subagent-driven）

**Phase 1 — 基础设施**
- Task 1: 创建 `content-drag-reflow.js` 骨架 + 单测；4-file sync (manifest + load-content-module + content-test-harness + PROJECT_DIRECTORY)
- Task 2: `prepareDragSession` + 高度测量 + 单测

**Phase 2 — 单源根列表**
- Task 3: dragstart 折叠被拖项 (`foldDraggedItems`) + 单源 ghost (`createMultiDragGhost(1)`) + 透明 dragImage
- Task 4: dragover 触发 `computeReflow` + `applyReflow`
- Task 5: drop / dragend 触发 `clearReflow` + `unfoldDraggedItems`

**Phase 3 — 多源**
- Task 6: 多源折叠（多个 item 同时 height=0）+ 多倍空槽（N × itemHeight）

**Phase 4 — 组内 + 跨组**
- Task 7: 组内让位（含 hover-expand 协调）
- Task 8: 跨组让位（源/目标同帧 commit）

**Phase 5 — 收尾**
- Task 9: 删除蓝条 CSS + JS + i18n 残留
- Task 10: 文档同步（PROJECT_DIRECTORY / UI_GUIDELINES / CHANGELOG）+ 测试矩阵补全

## 不变项 / 保留

- `getDropIntent` 接口和返回结构不变
- hover-expand / hover-collapse 计时器不改
- auto-scroll 控制器不改
- batch-mode 选择模型不改
- 现有 invalid drop 红色配色不改
