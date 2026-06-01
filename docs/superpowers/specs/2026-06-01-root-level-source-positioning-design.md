# 设计:根层级任意位置插入来源(含文件夹之间)

- 日期:2026-06-01
- 状态:待用户复审
- 作者:HMYanan + Claude

## 1. 概述与动机

当前根层级用**两个独立扁平数组**承载:`state.groups`(根文件夹 id 顺序)与 `state.ungrouped`(根级散源)。`render()` 把所有文件夹排在上方、再排一个"未分组"标题 + 所有散源,因此**散源在结构上不可能出现在两个文件夹之间**。

目标:让用户可以把来源拖到根层级的**任意位置**,包括两个文件夹中间,同时**保留底部"未分组"桶**作为新导入/手动归入的散源收纳处。

## 2. 目标 / 非目标

### 目标(v1)
- 根层级文件夹与"已定位"散源可任意交错排列。
- 拖拽(单条 + 批量)可把源定位到根层级任意 index,或拖到底部送回"未分组"桶。
- 桶为空时,拖拽接近底部出现**动态、带流畅动画**的"放此处 = 移到未分组"落点区。
- 升级后**零视觉变化**(老笔记本看起来与现在一致)。

### 非目标(v1 明确排除)
- 键盘"上移/下移"逐位重排(保留现有"移到未分组"/"移到文件夹"菜单与命令)。
- quick-view "未分组" 筛选语义改动(仍 = 桶成员)。
- 文件夹内部键盘重排;删除文件夹时"就地溢出"(仍溢出到桶)。
- 不引入打包器、TS、新 npm 依赖;不改架构(factory + global 注册)。

## 3. 数据模型与存储

### 3.1 形状
- **`state.root`(新,替代 `state.groups`)**:`({ type: 'group', id } | { type: 'source', key })[]`,与 `group.children` **完全同构**——根层级文件夹与已定位散源的显示顺序。
- **`state.ungrouped`(不变)**:`string[]`,底部"未分组"桶。
- **`groupsById`(不变)**:id → `{ id, children, ... }`。
- **不变量**:每个 source key 恰好出现在**一处**:某 `group.children` / `state.root` / `state.ungrouped`。每个 group id 恰好出现在一处:某 `group.children` / `state.root`。
- **互斥语义**:根级源"已定位"(在 `state.root`)与"在桶"(在 `state.ungrouped`)互斥。新导入源默认进桶;用户拖到文件夹之间 = 出桶定位;拖到底部桶区 = 入桶。

### 3.2 迁移 `schemaVersion 4 → 5`
- `state.root = (Array.isArray(state.groups) ? state.groups : []).map(id => ({ type: 'group', id }))`,然后删除 `state.groups`。
- `state.ungrouped` 原样保留。
- 结果:迁移后渲染顺序 = 所有文件夹(原 `groups` 顺序)+ 桶,**与 v4 视觉一致**。
- 迁移在 `normalizeLoadedState`(`content-persistence.js`)集中实现,并对 `__backup` 与 `sourcesPlusHistory_<id>` 快照在**载入/恢复时**逐一应用(history 条目可能是 v4)。
- 防御:`state.groups` 仍存在时(旧 backup / 导入)读取并转换;读 `state.root` 时对非数组/坏条目防御(沿用 `groupsById.children` 既有防御风格)。
- 兼容:旧版本扩展读 v5 数据将不认识 `state.root`(根级文件夹会"消失")。这是 schema bump 的标准单向风险,接受(用户升级扩展;降级罕见)。STORAGE_SCHEMA.md 记录。

## 4. 渲染([content-render.js](../../../src/content/content-render.js))

当前根装配(约 1441-1468):先全部 `state.groups` → renderGroup,再 `ungrouped-header` + `state.ungrouped` → renderSourceItem。

改为:
1. **按 `state.root` 顺序逐条渲染**:`{type:'group'}` → `renderGroup(group, 0)`;`{type:'source'}` → `renderSourceItem(sourcesByKey.get(key))`。得到交错的根序列(`.group-container` 与 `.source-item` 直接挂在 `#sources-list` 下)。
2. **其后渲染"未分组"桶**:若 `state.ungrouped` 非空,渲染桶。桶**包进一个独立容器** `<div class="ungrouped-section">`(内含 `.ungrouped-header` + 桶内 `.source-item`),使桶内源**不再是 `#sources-list` 的直接子节点**——这样 `computeDropIntent` 的根扫描(`:scope > .group-container, :scope > .source-item`)只看到 `state.root` 条目,桶成为独立落点区(几何上类似一个"虚拟文件夹")。
3. 空态:`state.root` 与 `state.ungrouped` 都空 → 现有 `.sp-empty-state`。
4. 隔离模式(`activeIsolationGroupId`):沿用现有"隔离时不渲染桶"逻辑。

> 注意:`.ungrouped-section` 容器是 DOM 结构变化,要复核所有依赖"桶内 `.source-item` 是 `#sources-list` 直接子节点"的查询(目前主要是 computeDropIntent 的根扫描——正是我们要它只看 root 序列,符合预期)。

## 5. 拖拽([computeDropIntent](../../../src/content/content-tree-interactions.js#L264) + handleDrop)

### 5.1 根落点合并进异构 targetList
- 现状:`chosenContainer === null`(根 host)时,槽位检测对根直接子节点做,并用 `routeToNearestNeighborKind` 把"源撞到文件夹槽位"改道到最近 `ungrouped` 源(因为 groups/ungrouped 是分离数组)。
- 改为:根 host 的 `targetList = state.root`(异构,与文件夹 host 的 `group.children` 同形)。槽位检测取 index,按落点条目类型 splice。**删除** `routeToNearestNeighborKind` 的源↔组改道分支(源现可停在 root 任意 index)。根落点分支与文件夹落点分支可大幅合并。
- 保留刚修复的**祖先 transform 修正**(`_containerShift`)与既有几何/迟滞。

### 5.2 桶落点
- 指针落在 `.ungrouped-section` 区域内 → 返回 `targetList = state.ungrouped`(string[]),splice 裸 key;`kind` 走桶语义。
- 桶有内容时:桶区可见,落入即入桶,并提示 toast(沿用/复用 `ui_keyboard_moved_ungrouped_toast` 或新增 `ui_*_ungrouped_toast`,见 §8)。

### 5.3 空桶动态落点区(带动画)
- 桶为空时**不常驻**占位区。
- 拖拽时当指针接近列表**底部尾区**(最后一个 root 条目下方的空白)且桶为空:
  - 复用 reflow:上方 root 序列平滑上移让出底部一块区域(`translateY` + `.sp-drop-shift`,动效 `--sp-motion-base`)。
  - 在让出的区域显示瞬态提示元素(新 class,如 `.sp-ungroup-dropzone` + 文案,见 §8 新 i18n key),提示"在此放下 = 移到未分组"。
  - 松手 → 源进 `state.ungrouped`(桶从空变为有 1 条)。
  - 指针离开尾区 / dragend → 区域平滑收起。
- `computeDropIntent` 增加:指针落在"所有 root 内容之下"的尾区 → 返回 ungrouped 落点(即使桶空)。
- 强调:出现/收起/让位都要流畅动画,复用现有 drag motion;`prefers-reduced-motion` 下降级为无动画即时切换。
- 该瞬态元素挂在 Shadow DOM 内 → 样式入 `content-style-text.js`(非 global overlay)。UI_GUIDELINES §13.4 记录。

### 5.4 handleDrop / 树移动
- splice 前从旧家移除源(group.children / ungrouped / 旧 root 位)。
- 进 root → 存 `{type:'source', key}`;进桶 → 存裸 key;文件夹进 root → `{type:'group', id}`。
- 文件夹拖拽:可落在已定位源之间;`_isGroupDrag` 的"嵌套 vs 重排"判定保留;`isDescendant` 防自嵌不变。
- noop / 同位检测(`isNoopTreeMove` / `getNormalizedInsertionIndex`)适配 `state.root` 作为 `targetList`。

## 6. 批量

- **批量拖拽**(已存在,`applyMultiSourceDrop` / batch-drag.smoke):落到 root 位置 → 多 key 作为 `{type:'source'}` splice 进 `state.root`;落到桶 → 进 `state.ungrouped`。适配 `applyMultiSourceDrop` 处理 root 目标。
- **批量菜单"移到未分组"**(`executeBatchMoveToUngrouped`,不变):入桶。
- 批量键盘重排:不做(v1)。

## 7. 其它适配点(已盘点)

| 文件 | 适配 |
|---|---|
| `content-persistence.js` | 默认态 `{ root: [], ungrouped: [] }`;`normalizeLoadedState` 迁移 v4→v5;`buildPersistableState` 输出 `root`;各 schema 分支 |
| `content-import-export.js` | 导出走 v5(`root`);导入兼容旧(`groups`+`ungrouped`)→ 过迁移;枚举 root 源条目 |
| `content-view-state.js` | quick-view 枚举/计数处:凡按 `state.ungrouped` 枚举"根级源"的,补 `state.root` 里的 `{type:'source'}` 条目(如 'all'/计数);**'ungrouped' 筛选仍仅 = `state.ungrouped`**(桶) |
| `background/index.js` (~645) | 快照"有内容"判断加 `Array.isArray(snapshot.root) && snapshot.root.length` |
| `content-drag-multi.js` (~228) | currentList 解析适配 root |
| `content-tree-interactions.js` | 删非空文件夹溢出仍到桶(不变);`removeSourceFromTree` / `removeGroupFromTree` 要同时从 `state.root` 摘除 |

## 8. i18n

- 新增(若需)桶落点提示文案:`ui_drop_to_ungroup_hint`(空桶动态落点区文案)+ 可能的入桶 toast(或复用现有 `ui_keyboard_moved_ungrouped_toast` / `ui_batch_ungrouped_toast`)。
- 三语 `_locales/{en,es,zh_CN}/messages.json` 同步,placeholder 形状一致(`tests/locales.test.js` 守护)。

## 9. 测试

### 单测
- 迁移:v4(`groups`+`ungrouped`)→ v5(`root`+`ungrouped`),含 backup/history;无 `groups` 时幂等。
- render:`state.root` 交错渲染(文件夹/源混排顺序正确);桶包进 `.ungrouped-section`;空态。
- `computeDropIntent`:根落点返回 `targetList === state.root` 且 index 正确;源落在两文件夹之间;落底部尾区(桶空)→ ungrouped 落点;落 `.ungrouped-section` → ungrouped。**保留** §3 已修复的嵌套抽搐测试。
- `handleDrop`:splice 进 root vs 桶;从旧家正确摘除;文件夹落在源之间;noop 检测。
- 批量:batch-drop 进 root 位置 / 进桶。
- import/export 往返:带"已定位"源的 root 顺序保持;导入旧 shape 迁移。
- view-state:'all'/计数含 root 源;'ungrouped' 仅桶。

### smoke
- 拖一个源到两文件夹之间 → reload 后顺序持久。
- 拖源到最底部(桶空)→ 动态落点区出现 → 松手入桶。
- 批量拖到根位置。

## 10. 风险

- **迁移正确性**:必须覆盖主存储 + backup + history 快照;revision guard 不变。以"先复现/先红"风格为迁移写单测。
- **DOM 结构变化**(`.ungrouped-section`):复核所有根级 DOM 查询;smoke 守护。
- **`routeToNearestNeighborKind` 删除**:确认无其它调用方依赖它的根级改道(grep 确认仅根落点用);其"空桶兜底"分支的语义被新的桶落点接管。
- **降级风险**:旧扩展读 v5 数据根级文件夹消失(单向,接受;文档记录)。
- **动画性能**:空桶落点区复用 frame-gated reflow,避免每帧额外布局抖动;`prefers-reduced-motion` 降级。

## 11. 文档更新(落地时)

- **CHANGELOG.md** `[Unreleased]`:Added(根层级任意位置插入 + 空桶动态落点区)/ Changed(state.groups→root 模型)。
- **docs/STORAGE_SCHEMA.md**:`schemaVersion 5`、`root` 字段、迁移 4→5、import/export shape。
- **UI_GUIDELINES.md §13.4**:根序列交错、`.ungrouped-section`、空桶动态落点区 `.sp-ungroup-dropzone` + 动画规则。
- **docs/PROJECT_DIRECTORY.md**:若新增模块/测试入口则同步(预计无新模块)。
- **README.md**:"What It Does" 增"可把来源放到任意位置"。
- **docs/MESSAGE_CONTRACTS.md**:若 SAVE/LOAD payload 形状描述涉及 `groups`/`root` 则同步。

## 12. 验证矩阵(落地时)

`npm run lint`(0/0)→ `npm run test:unit` → `npm run test:smoke`(= `npm run verify:full`)。先红后绿:迁移与 computeDropIntent 根落点先写失败测试。
