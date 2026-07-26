# Drag Correctness and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正拖拽 Beta 已确认的跨 notebook Classic 迁移、reflow box model、过滤落点、auto-scroll 和 native drop feedback 问题，并用可重复的 100/500 行测量把 dragover 热路径改成一次 read → plan → write。

**Architecture:** 保留 `content-tree-interactions.js` 作为唯一 drag engine，不因文件长度创建第二套引擎。`content-drag-multi.js` 继续负责多选、ghost 和 auto-scroll；`content-drag-reflow.js` 继续负责 fold/shift/unfold。优化只增加内部 geometry snapshot 和 frame plan Interface，所有 DOM/layout read 在一帧开头完成，后续 drop-intent/reflow/feedback 只消费 snapshot。

**Tech Stack:** Vanilla JS、Pointer/DragEvent + `requestAnimationFrame`、Jest instrumented DOM mocks、Playwright headless Chromium layout fixture、现有 ESLint/smoke/package gates。

**Global Constraints:**

- Classic 与 Reflow 仍是同一个 drag engine 的模式分支；不增加第三种模式。
- Classic 是全局 preference，但 tree state 是 per notebook；每个 notebook load 都必须验证 Classic invariant。
- `content-drag-reflow` 的 unit test 用 deterministic computed-style mocks；真实 box model 只用 headless Chromium smoke 验证，不把 jsdom 当 layout engine。
- 性能结论只做同机 before/after 对比；CI 不设置跨机器毫秒阈值。
- 正确性优先于性能。任何 intent matrix、box model 或 recovery 测试失败时，不合并热路径优化。
- 不使用 NotebookLM 生成 CSS class，不增加 dependency/permission/host surface。
- 每个 task 更新 `CHANGELOG.md`；新增测试入口、文档或 helper 时同步 `docs/PROJECT_DIRECTORY.md`，视觉/交互契约同步 `UI_GUIDELINES.md`。
- 开始 Product Decision Gate 前执行 `git rev-parse HEAD`，把返回值写入
  `docs/superpowers/reports/2026-07-26-optimization-baseline.md` 唯一的
  `Drag Plan Start SHA:` 字段；若 report 不存在，先执行路线图 Task 1。不得依赖跨 shell
  临时变量。
- 每个 commit 前运行 `git diff --check`，commit 后运行
  `git show --check --oneline --stat HEAD`。

---

## Product Decision Gate and Performance Contract

### Filtered last-visible slot

底层序列 `[A, hidden-B, C, hidden-D]`，当前过滤只显示 `[A, C]` 时：

执行前必须在两个行为中明确选择一个：

1. **Anchor-relative（推荐）**：drop “after C” → 底层 index 3，即紧跟 C、位于
   hidden-D 之前；
2. **Container-end**：drop “after C” → 底层 index 4，即整个底层 container 末尾。

两种行为都会保持 hidden item 的内部相对顺序，但用户对“最后可见项之后”的理解不同。
Task 1 先锁当前行为并记录两种候选；未取得产品确认前不得修改 production、UI contract 或
CHANGELOG。确认后 root、group children、single source、multi-source、group reorder 必须
使用同一选择。底层空 list 是合法 index 0；底层非空但过滤后没有可见 anchor 时 fail
closed，不猜 index。

### Performance acceptance

- deterministic test：每 frame `readDragGeometry` 恰好一次；
- 同一 Element 每 frame `getBoundingClientRect()` 不超过一次；
- `querySelectorAll()` 次数不随行数线性增长；
- 第一笔 class/style mutation 后不得再发生 geometry read；
- opt-in 500-row Chromium benchmark 的 drag callback CPU p95 不得比同机 baseline
  恶化超过 10%；
- 500-row、50 个跨 container/non-contiguous source 的 drag-start prepare CPU p95 不得比
  同机 baseline 恶化超过 10%，batched folded probe 的 forced layout read phases ≤3；
- 优化后 500-row DOM geometry/query 总调用数必须低于 baseline；若只改善计数、p95 持平，允许合并并如实记录。

---

## File Structure

- `src/content/content-tree-interactions.js` — dragover/drop engine、drop intent、hover expand、frame scheduling。
- `src/content/content-drag-reflow.js` — item metrics、fold/shift/unfold。
- `src/content/content-drag-multi.js` — multi selection、ghost、auto-scroll controller。
- `src/content/index.js` — load finalizer、drag preference 与 critical save orchestration。
- `tests/content/content-tree.test.js` — intent/drag/drop integration、frame read-write guards。
- `tests/content/content-drag-reflow.test.js` — box-model unit tests。
- `tests/content/content-drag-multi.test.js` — auto-scroll controller。
- `tests/content/content-lifecycle.test.js` — per-notebook Classic normalization。
- `tests/smoke/drag-reflow-layout.smoke.spec.js` — real Chromium footprint/cancel。
- `tests/smoke/drag-performance.smoke.spec.js` — opt-in 100/500-row baseline。
- `docs/DRAG_PERFORMANCE_BASELINE.md` — environment + before/after counters/timing。

---

## Task 1: Product Decision Gate — filtered last-visible slot

**Files:**
- Modify: `src/content/content-tree-interactions.js`
- Modify: `tests/content/content-tree.test.js`
- Modify: `UI_GUIDELINES.md`
- Modify: `docs/superpowers/reports/2026-07-26-optimization-baseline.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `computeDropIntent(args)` 现有返回。
- Produces:

```javascript
VisibleIdentity =
    { type: 'source', key: string } |
    { type: 'group', id: string }

resolveVisibleAnchorInsertIndex({
    fullList,
    visibleIdentities,
    anchorIdentity,
    edge,
    lastVisiblePolicy
}) -> number | null
```

在 characterization 前，把本计划开始时 `git rev-parse HEAD` 的原始 40 位输出写入 baseline
report 的 `Drag Plan Start SHA:` 唯一字段；该 report 与本 task 一起提交。

`edge` 仅为 `'before' | 'after'`；`lastVisiblePolicy` 为
`'anchor-relative' | 'container-end'`。identity 比较必须同时匹配 type 和 key/id，避免
source key 与 group id 碰撞。`fullList.length === 0` 返回 0；full list 非空且无
visible anchor 返回 `null`。

- [ ] **Step 1: 写 current-behavior characterization**

使用底层 `[A, hidden-B, C, hidden-D]`，覆盖：

- root source before/after C；
- group child source before/after C；
- group reorder before/after visible group；
- active text search 与 quick-view filter；
- multi-source 保持选择顺序；
- visible list 为空时返回 invalid/no target。

- [ ] **Step 2: 运行并记录当前行为**

Run:

```bash
npm run test:unit -- --runTestsByPath tests/content/content-tree.test.js
```

Expected: characterization PASS；在 decision record 中分别记录 root/group 当前返回的
底层 index。若两条路径不一致，把不一致作为确认输入，不先改 production。

- [ ] **Step 3: 取得产品确认并把选择写入 test name/UI contract**

Decision record 固定写：

```md
Decision: anchor-relative | container-end
Example: [A, hidden-B, C, hidden-D], visible [A, C], after C -> index 3 | 4
Applies to: root, group children, source, group, multi-source
```

推荐 `anchor-relative`，因为落点与用户实际看到的 C 保持局部关系。没有明确 decision 时
本计划停在此 step。

- [ ] **Step 4: 先写所选行为的失败测试，再实现唯一映射**

```javascript
function resolveVisibleAnchorInsertIndex({
    fullList,
    visibleIdentities,
    anchorIdentity,
    edge,
    lastVisiblePolicy
}) {
    if (!Array.isArray(fullList) || !Array.isArray(visibleIdentities)) return null;
    if (fullList.length === 0) return 0;
    if (!visibleIdentities.some((item) => sameIdentity(item, anchorIdentity))) {
        return null;
    }
    const fullIndex = fullList.findIndex((entry) => (
        sameIdentity(toVisibleIdentity(entry), anchorIdentity)
    ));
    if (fullIndex < 0) return null;
    if (
        edge === 'after' &&
        lastVisiblePolicy === 'container-end' &&
        sameIdentity(visibleIdentities.at(-1), anchorIdentity)
    ) {
        return fullList.length;
    }
    return edge === 'after' ? fullIndex + 1 : fullIndex;
}
```

同 container drag 在实际 mutation 阶段再做“先移除 dragged item 后的 index 修正”，
不要在 anchor resolver 混入 mutation。

- [ ] **Step 5: 运行测试并更新 UI contract**

Run: 同 Step 2。

Expected: PASS；root/group 与 filter type 全部一致。

- [ ] **Step 6: Commit**

```bash
git add tests/content/content-tree.test.js \
  src/content/content-tree-interactions.js \
  UI_GUIDELINES.md \
  docs/superpowers/reports/2026-07-26-optimization-baseline.md \
  CHANGELOG.md
git commit -m "fix: align filtered drag slots to visible anchors"
```

---

## Task 2: 建立 opt-in 100/500 行性能基线

**Files:**
- Create: `tests/smoke/drag-performance.smoke.spec.js`
- Create: `docs/DRAG_PERFORMANCE_BASELINE.md`
- Modify: `package.json`
- Modify: `docs/PROJECT_DIRECTORY.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `npm run benchmark:drag`
  - benchmark result:

```javascript
{
    rowCount: 100 | 500,
    selectionCount: 1 | 50,
    warmupSessions: 5,
    measuredSessions: 20,
    warmupFrames: 10,
    measuredFrames: 50,
    prepareCpuMs: { p50: number, p95: number },
    prepareForcedLayoutReadPhases: { max: number },
    callbackCpuMs: { p50: number, p95: number },
    calls: {
        getBoundingClientRect: number,
        querySelector: number,
        querySelectorAll: number
    }
}
```

- [ ] **Step 1: 写 opt-in benchmark fixture**

复用 `tests/smoke/helpers/notebooklm-fixture.js` 的 synthetic NotebookLM shell，
创建 100/500 个带 deterministic synthetic title（例如 `Synthetic source 0001`）的
manageable source row，设置 `dragMode: 'reflow'`。空标题不可用，因为 source sync 会把
它视为 loading/unmanageable。在页面初始化前包装：

- `Element.prototype.getBoundingClientRect`
- `Element.prototype.querySelector`
- `Element.prototype.querySelectorAll`
- `requestAnimationFrame` callback duration

fixture 对 selectionCount 1/50 都测 5 次 warm-up + 20 次 drag-start prepare；50 项按固定
seed 分布到 root 与多个 group，包含 contiguous/non-contiguous selection。记录
`dragstart` handler/`prepareDragSession` 的同步 CPU，并把“DOM write 之后首次 geometry
read”计为一个 forced layout read phase。

只统计 manager-active drag frame：wrapper 在目标 callback 执行前后用
`performance.now()` 记录同步 CPU duration，并用 manager-active flag + callback 内 DOM
counter delta 排除无关 rAF。10 帧 warm-up 后测 50 个目标 callback；不得用相邻 rAF
timestamp/frame interval 代替 callback CPU。

- [ ] **Step 2: 添加显式命令，不进入默认 smoke**

`package.json`：

```json
"benchmark:drag": "DRAG_BENCHMARK=1 playwright test tests/smoke/drag-performance.smoke.spec.js"
```

spec 在 `DRAG_BENCHMARK !== '1'` 时 skip。默认 `npm run test:smoke` 不增加 timing
flake。

- [ ] **Step 3: 运行 baseline**

Run: `npm run benchmark:drag`

Expected: PASS；输出 100/500 × selectionCount 1/50 四组，均包含 Chrome version、OS、
CPU、sample count、prepare CPU/forced-layout phases、callback CPU p50/p95 和三种 DOM
call count。

- [ ] **Step 4: 写 baseline 文档**

`docs/DRAG_PERFORMANCE_BASELINE.md` 固定包含：

```md
# Drag Performance Baseline
## Environment
## Method
## Before Optimization
## After Optimization
## Acceptance Comparison
```

本 task 只填写 Before；After 保持空表头而不写占位词。

- [ ] **Step 5: 文档/路径校验并提交**

Run:

```bash
git diff --check -- package.json \
  tests/smoke/drag-performance.smoke.spec.js \
  docs/DRAG_PERFORMANCE_BASELINE.md \
  docs/PROJECT_DIRECTORY.md CHANGELOG.md
```

Expected: PASS。

```bash
git add package.json tests/smoke/drag-performance.smoke.spec.js \
  docs/DRAG_PERFORMANCE_BASELINE.md docs/PROJECT_DIRECTORY.md CHANGELOG.md
git commit -m "test: add 100 and 500 row drag benchmark"
```

---

## Task 3: 在每个 notebook load 强制 Classic placement invariant

**Files:**
- Modify: `src/content/index.js:1659-1673` 及 load finalizer
- Modify: `src/content/content-developer-logger.js:224-449`
- Test: `tests/content/content-lifecycle.test.js`
- Test: `tests/content/content-persistence.test.js`
- Test: `tests/content/content-developer-logger.test.js`
- Modify: `UI_GUIDELINES.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - `ensureDeveloperPreferencesLoaded(): Promise`
  - `getPreferencesLoadStatus(): 'idle'|'loading'|'loaded'|'failed'`
  - `treeInteractionsModule.sweepPositionedRootSourcesToBin(state): boolean`
  - `cloneSerializableData(buildPersistableState()): PersistedState`
  - `appendStateHistorySnapshot(snapshot, reason): Promise`
  - Storage plan 的 `saveState(...): Promise<SaveResult>`
- Produces:

```javascript
enforceClassicPlacementInvariant({
    trigger,
    expectedProjectId,
    instanceToken
}) -> Promise<{
    changed: boolean,
    saved: boolean,
    reason?: string
}>
```

- [ ] **Step 1: 写跨 notebook/load-path 失败测试**

覆盖：

1. notebook A 切 Classic 后 sweep；SPA 到 notebook B，B load 后也 sweep；
2. `dragMode: 'reflow'` 不改 state；
3. preference Promise 延迟返回 reflow 时，load 不提前误 sweep；
4. preference load failed/unknown 时，即使内存默认值为 Classic 也不 sweep，返回
   `preferences_unverified`；
5. normal load、deferred `flushPendingInitialLoadedState`、panel reattach 和 mode change
   走同一 invariant function；
6. 同 instance 重复 finalize 无变化、无第二次 save；
7. checkpoint failure/throw 时 state byte-for-byte 不变、不 save；
8. save failure 保留 recovery `{ failed: true, reason }`；
9. success 清 recovery；
10. checkpoint snapshot 含 positioned root source，证明发生在 sweep 前；
11. initial LOAD failed 后，`setDragMode('classic')` 的 SAVE 成功并返回完整 normalized
    preferences → status 变为 loaded，mode-change sweep 执行；
12. deferred apply 等待中 SPA 切 notebook → 旧 continuation 不 mutation/save；
13. history checkpoint 等待中 SPA 切 notebook → 旧 continuation 不 mutation/save。

- [ ] **Step 2: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-lifecycle.test.js \
  tests/content/content-persistence.test.js \
  tests/content/content-developer-logger.test.js
```

Expected: FAIL；当前 production sweep 只在 mode-change handler 直接执行，且 preference
failure 与默认 Classic 无法区分。

- [ ] **Step 3: 暴露可验证的 preference load status**

`content-developer-logger.js` 在 LOAD 开始/成功/失败时维护
`preferencesLoadStatus`；既有 getter/setter public behavior 不变。只有 background
response success 且 normalize 完成后状态为 `'loaded'`；runtime error、response
`success:false`、throw 均为 `'failed'`。任一 `SAVE_PREFERENCES` 只有在 background
`success:true` 且 response 携带完整 normalized preferences、`applyLoadedPreferences`
完成后，才把 status 更新为 `'loaded'`；因此 failed LOAD 后用户显式成功保存 Classic
可以提供新的 verified proof。partial/empty SAVE response 不改变 failed status。
`ensureDeveloperPreferencesLoaded()` 不把 failed 转换成可迁移的默认值。

- [ ] **Step 4: 统一 load/mode-change invariant，checkpoint 后才 mutation**

执行顺序固定：

1. await preferences；
2. `getPreferencesLoadStatus() !== 'loaded'` →
   `{ changed:false, saved:false, reason:'preferences_unverified' }`；
3. 校验 `projectId === expectedProjectId` 与 instance token 仍 live；
4. 等待 pending/deferred state 真正 apply；
5. 再校验 projectId 与 instance token；不一致返回 `stale_instance`。通过后捕获
   `const boundState = getState()`，后续 snapshot/sweep 只使用该引用；
6. 明确 `getDragMode() !== 'classic'` →
   `{ changed:false, saved:false, reason:'not_classic' }`；
7. `boundState.root` 没有 `{type:'source'}` → unchanged，不 save；
8. clone `preSweepSnapshot = buildPersistableState(boundState)`；
9. await `appendStateHistorySnapshot(preSweepSnapshot, 'before_classic_mode_sweep')`；
   false、`ok:false` 或 throw 均 fail closed，不 mutation；
10. 在紧邻 mutation 前第三次校验 projectId、instance token、`getState() === boundState`；
    不一致返回 `stale_instance`，且不得 save；
11. 对显式 `boundState` 调幂等 sweep；
12. `buildParentMap()`、`render()`；
13. await：

```javascript
saveState({
    immediate: true,
    critical: true,
    recordUndo: false,
    reason: 'classic_mode_root_sweep'
});
```

save false 时返回 `{ changed:true, saved:false, reason }`，不得显示成功状态。

删除 `applyDragModeChange()` 内现有 inline sweep + 普通 `saveState()`；mode change 在 preference
成功持久化后调用 `enforceClassicPlacementInvariant({ trigger:'mode_change', ... })`。normal
load、deferred restore、reattach 分别传稳定 trigger，但共享相同 Implementation。

- [ ] **Step 5: 运行 focused + full runtime matrix**

Run: 同 Step 2。

Expected: PASS。

Run: `npm run verify:full`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/content/index.js src/content/content-developer-logger.js \
  tests/content/content-lifecycle.test.js \
  tests/content/content-persistence.test.js \
  tests/content/content-developer-logger.test.js \
  UI_GUIDELINES.md CHANGELOG.md
git commit -m "fix: enforce classic placement invariant on notebook load"
```

---

## Task 4: Reflow 使用真实 vertical footprint 并正确取消展开

**Files:**
- Modify: `src/content/content-drag-reflow.js:18-188`
- Test: `tests/content/content-drag-reflow.test.js`
- Create: `tests/smoke/drag-reflow-layout.smoke.spec.js`
- Modify: `docs/PROJECT_DIRECTORY.md`
- Modify: `UI_GUIDELINES.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- `prepareDragSession()` signature 不变。
- Session 新增：

```javascript
itemMetrics: Map<string, {
    visualRect: { top: number, bottom: number, height: number },
    borderBoxHeight: number,
    contentHeight: number,
    marginTop: number,
    marginBottom: number,
    unfoldHeight: number,
    originalInlineHeight: string,
    originalInlineOpacity: string
}>,
draggedRuns: Array<{
    keys: string[],
    hostElement: Element,
    cumulativeDisplacement: number,
    footprint: number
}>,
probeMetrics: {
    forcedLayoutReadPhases: number,
    prepareCpuMs: number
}
```

- `totalDraggedHeight` 来自一次 batched all-selected folded probe 的 outer flow-end
  displacement；direct-host run footprint 用同 host 的累计 displacement 差分，nested host
  contribution 按 host/ancestor graph 去重，不把同一 child shrink 计算两次。
- `itemHeights` 暂时保留为 `borderBoxHeight`，兼容非 frame caller。
- Internal `measureVerticalMetrics(element): ItemMetrics` 使用 injected/global
  `getComputedStyle`。
- Internal `measureBatchedFoldProbe({ rootElement, runs, selectedElements })` 在 drag-start
  prepare phase 实测 exact folded end-state：

```javascript
const probe = createFoldProbeStructure(rootElement, runs);
const motionState = disableProbeMotion(selectedElements, probe.hosts);
let result;
try {
    const before = readAllProbeAnchors(probe); // read phase 1
    applyMeasurementFoldState(selectedElements); // one write phase
    const after = readAllProbeAnchors(probe); // read phase 2
    result = resolveProbeDisplacements({ probe, before, after });
} finally {
    try {
        restoreProbeBoxAndClasses(selectedElements);
        removeFoldProbeStructure(probe);
        commitRestoredProbeLayout(selectedElements); // read phase 3
    } finally {
        restoreProbeMotionAndOverflowAnchor(motionState);
    }
}
return result;
```

`createFoldProbeStructure` 按 direct layout host 与 ancestor relationship 建 inert、零尺寸、
不可匹配为 source/group 的 host sentinels 和一个 outer flow-end sentinel；before/after
期间结构完全相同。所有 before anchors 一次批量读取，随后**一次性**折叠全部 selected
elements，再一次批量读取 after，最后一次性 restore；禁止 per-run
read→write→read→restore。

measurement state 必须复用正式 fold terminal box styles，但临时用
`style.setProperty('transition', 'none', 'important')` 与
`style.setProperty('animation', 'none', 'important')` 禁止过渡/动画，并保存每个相关
inline value + priority + fold/unfold class membership。restore 必须分两段：先在 motion
仍被 `none !important` 压住时恢复 box/class、移除 sentinels，并用
`commitRestoredProbeLayout` 做第三次 read phase，确认 expanded used layout 已提交；随后
才恢复 transition/animation/overflow-anchor 的原 value + priority。这样恢复 motion
property 时没有新的 height/opacity change，不会产生 probe-induced unfold transition。
同步 after read 必须已经是 180ms transition 的真正终态，不是动画起点。

同 host 的 run 按 DOM 顺序用 cumulative survivor displacement 的相邻差得到 footprint；
outer sentinel 的 local flow coordinate（container top + scroll offset 校正）给出全部
selection 的 `totalDraggedHeight`。host/ancestor graph 记录 descendant host shrink，
ancestor cumulative 值先减已归属 descendant 的 contribution，确保跨 group/container
selection 只计一次。不得用 `marginTop + marginBottom`、
`next.top - first.top` 或逐 run 强制 layout 推导 footprint。

- [ ] **Step 1: 写 unit box-model 失败测试**

覆盖：

- content-box/border-box 的 `unfoldHeight` 转换；
- first/middle run：probe 后使用后继 survivor 的实际位移；
- last/only-child run：使用 container-end sentinel 的实际位移；
- source↔source、source↔group 的不同 collapsed margin stride；
- counterexample `prev margin-bottom:8`、drag margins `4/4`、next
  `margin-top:16` 不得返回 naive 56px；transition-enabled CSS 下同步 batched probe 仍
  返回真实终态 48px；
- contiguous multi 合并一个 run，non-contiguous multi 分 run 求和；
- root + 两个 group 的 50-item non-contiguous selection 最多发生三次 forced layout read
  phase，ancestor contribution 不重复；
- probe restore 后 transition/animation/overflow-anchor 的 value、priority、class
  byte-for-byte 恢复；
- `commitRestoredProbeLayout` 后 selected rect 与 pre-probe 相同，恢复 motion 后
  `getAnimations()` 无 probe-created transition；
- `getComputedStyle` unavailable 时安全回退现有 `offsetHeight`；
- animated cancel/unfold 最终恢复原 inline height/opacity；
- `animated:false` 立即恢复。

- [ ] **Step 2: 写 real Chromium layout smoke**

fixture 在 notebook navigation 前通过 extension bridge seed `dragMode:'reflow'`，创建带
deterministic synthetic title 的真实 CSS margin/padding/border rows。断言：

- first/middle/last、mixed source/group、contiguous/non-contiguous selection 在 fully
  folded + reflow preview 时，除明确的 insertion corridor 外，所有 non-dragged sibling
  rect 与 drag 前位置误差 ≤1px；
- 跨 root/group/container 的 50-item selection，prepare forced layout read phases ≤3，
  prepare CPU 纳入 500-row benchmark budget；
- `.sp-drag-folded` 保持真实 180ms transition 的 fixture 中，measurement probe 同步结果
  等于 transition 终态（counterexample 48px，误差 ≤1px）；
- probe 期间 sentinel 同步移除，DOM 中无 measurement node 残留；
- `prepareDragSession` 返回后、正式 fold rAF 前，selected rect 已恢复到 pre-probe
  （误差 ≤1px）、`getAnimations()` 无 probe transition、native dragstart 未被取消；
- synthetic Esc 后显式 dispatch `dragend`，经过 `TRANSITION_MS + 60ms` 后 border-box
  height 与 margins 误差 ≤1px；
- animation 中 element outer footprint 不超过原 footprint 1px 以上；
- 另用 `page.emulateMedia({ reducedMotion: 'reduce' })` 验证 reduced-motion 恢复；
- smoke 默认 headless。

- [ ] **Step 3: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-drag-reflow.test.js
npx playwright test tests/smoke/drag-reflow-layout.smoke.spec.js
```

Expected: FAIL；当前 slot 只用 `offsetHeight`，且 content-box unfold 直接写 border-box
measurement。

- [ ] **Step 4: 实现 metrics 与 restore**

`measureVerticalMetrics`：

```javascript
const borderBoxHeight = Number(element.offsetHeight) || 0;
const style = getComputedStyleFn?.(element);
const marginTop = parsePixel(style?.marginTop);
const marginBottom = parsePixel(style?.marginBottom);
const paddingBorder = parsePixel(style?.paddingTop)
    + parsePixel(style?.paddingBottom)
    + parsePixel(style?.borderTopWidth)
    + parsePixel(style?.borderBottomWidth);
const contentHeight = Math.max(0, borderBoxHeight - paddingBorder);
const unfoldHeight = style?.boxSizing === 'border-box'
    ? borderBoxHeight
    : contentHeight;
```

然后按 DOM/host/ancestor graph 把 dragged keys 切成 runs，调用一次
`measureBatchedFoldProbe`：批量 before read → 一次 all-selected terminal fold write →
批量 after read → motion-disabled box/class restore → restore-settle read → motion
property restore。用 cumulative displacement + descendant contribution dedupe 得
run/total footprint。`finally` 必须恢复所有 inline priority/class 并移除全部 sentinel。
Chromium smoke 是 footprint 真相源；unit 只验证 batched orchestration、
transition-disabled measurement mode、ancestor dedupe 与 counterexample，不自行实现 CSS
margin-collapse 算法。

fold 前保存原 inline values；unfold animation 用 `unfoldHeight`，transitionend/timeout
后恢复原 inline values，不把测量像素永久留在 DOM。

- [ ] **Step 5: 运行并提交**

Run: 同 Step 3。

Expected: PASS。

```bash
git add src/content/content-drag-reflow.js \
  tests/content/content-drag-reflow.test.js \
  tests/smoke/drag-reflow-layout.smoke.spec.js \
  docs/PROJECT_DIRECTORY.md UI_GUIDELINES.md CHANGELOG.md
git commit -m "fix: measure reflow footprint with box-model metrics"
```

---

## Task 5: Dragover 改成单帧 read → plan → write snapshot

**Files:**
- Modify: `src/content/content-tree-interactions.js:298-895, 2021-2405`
- Modify: `src/content/content-drag-reflow.js:134-188`
- Modify: `src/content/index.js`
- Test: `tests/content/content-tree.test.js`
- Test: `tests/content/content-drag-reflow.test.js`
- Test: `tests/content/content-module.test.js`
- Modify: `docs/DRAG_PERFORMANCE_BASELINE.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

```javascript
readDragGeometry({
    rootElement,
    session
}) -> {
    rootRect,
    bin,
    groups,
    rootItems,
    sourceElements,
    groupElements
}

GeometryEntry = {
    identity:
        { type: 'source', key: string } |
        { type: 'group', id: string },
    element,
    visualRect,
    ownShiftY,
    inheritedShiftY,
    layoutRect
}

GroupGeometry = GeometryEntry & {
    header: {
        element,
        visualRect,
        layoutRect
    },
    children: {
        element,
        visualRect,
        layoutRect
    }
}

computeDropIntentRaw({
    clientX,
    clientY,
    state,
    groupsById,
    parentMap,
    activeDragContext,
    prevIntent,
    geometrySnapshot
}) -> DropIntent

planDragFrame({
    pointer,
    geometrySnapshot,
    state,
    groupsById,
    parentMap,
    dragContext,
    previousIntent
}) -> {
    intent,
    isInvalid,
    dropEffect,
    shifts,
    feedback
}

applyDragFramePlan(plan) -> void

invalidateDragGeometry(reason, {
    schedule = true
} = {}) -> void
```

`layoutRect` 固定为 visual rect 扣除 own + inherited translateY；nested group 的
header/children layout band 必须扣 ancestor container shift，保留现有 nested-twitch
修复语义。source/group 使用两张 map，不把 source key 和 group id 放进同一个裸 key
namespace。

`content-drag-reflow.applyReflow/clearReflow` 增加 optional
`sourceElements: Map<string, Element>` 与 `groupElements: Map<string, Element>`；未提供时保留
现有 selector fallback，供非 dragover caller 与旧测试使用。

`geometryDirty` 只能在一次完整 `readDragGeometry` 成功后清为 false。所有 layout
invalidation 统一调用 `invalidateDragGeometry(reason)`：

- auto-scroll 或用户 scroll 实际改变 scroll position；
- hover expand/collapse 开始、完成或取消；
- drag active 期间 `render()`/source sync 替换 manager rows；
- source-list/group-children `ResizeObserver` 报告尺寸变化；
- 任何不能通过纯数据 patch 反映到 snapshot 的 class/style mutation。

纯 `translateY` reflow write 若 `applyDragFramePlan` 同步返回已应用 shift 的
`nextGeometrySnapshot`，可以保持 clean；否则也必须 invalidate。不得由各 consumer
直接写 `geometryDirty`。

- [ ] **Step 1: 先扩展 intent matrix**

测试覆盖：nested group、collapsed group、bin、root、multi、Classic/Reflow、Task 1
filtered anchor，以及“nested subfolder 随 ancestor visual transform 位移，但 layout
slot/intent 不变”。确保重构前全部 PASS。

- [ ] **Step 2: 写 read/write budget 失败测试**

Instrumented root 记录每次 geometry read/query 和 class/style write，断言：

- `_processDragOver` 每 frame 调 `readDragGeometry` 一次；
- 同一 element rect read ≤1；
- collapsed hover 使用 snapshot，无第二次 group scan；
- reflow typed element maps 命中时无 per-key selector；
- first write 之后 read count 不再增加；
- 100 与 500 行 querySelectorAll 次数相同。
- prime clean snapshot 后 hover-expand、drag-time render、user scroll、ResizeObserver
  任一发生时，snapshot 立即 dirty；
- `applyDragFramePlan` 只有在同步 patch 完 visual/layout rect 后才能保持 clean。

- [ ] **Step 3: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-tree.test.js \
  tests/content/content-drag-reflow.test.js \
  tests/content/content-module.test.js
```

Expected: FAIL；当前存在重复 scan、per-key query 和跨阶段 read/write。

- [ ] **Step 4: 实现 snapshot 和 frame plan**

执行顺序：

1. rAF 开始清理上一 frame 的纯逻辑 cache，不写 DOM；
2. `readDragGeometry` 一次性 query/measure，并为每个 entry 同时记录 visual/layout 坐标；
3. `computeDropIntentRaw`、`resolvePointerOverCollapsedGroupId`、reflow 全部消费 snapshot；
4. `planDragFrame` 只返回数据；
5. `applyDragFramePlan` 一次性更新 class/style/marker；
6. 纯 transform write 同步 patch snapshot；layout-affecting write 调
   `invalidateDragGeometry(reason)`；
7. 保存 current intent/snapshot 给 dropEffect 和 auto-scroll 使用。

删掉 `resolvePointerOverCollapsedGroupId` 内部 query/rect scan；不得为绕过测试把 read
藏到另一个 helper。drag session 安装 source-list passive scroll listener 与 scoped
`ResizeObserver`，dragend/teardown 必须移除；`index.js` 的 drag-time render seam 在 DOM
替换前调用 invalidation。

- [ ] **Step 5: 测试并回填 benchmark**

Run: 同 Step 3。

Expected: PASS，满足本计划 deterministic budgets。

Run: `npm run benchmark:drag`

Expected:

- 500-row callback CPU p95 ≤ baseline × 1.10；
- 500-row/50-selection prepare CPU p95 ≤ baseline × 1.10；
- batched probe forced layout read phases ≤3；
- geometry/query 总调用数 < baseline；
- 结果写入 `docs/DRAG_PERFORMANCE_BASELINE.md` 的 After/Comparison。

- [ ] **Step 6: Commit**

```bash
git add src/content/content-tree-interactions.js \
  src/content/content-drag-reflow.js src/content/index.js \
  tests/content/content-tree.test.js \
  tests/content/content-drag-reflow.test.js \
  tests/content/content-module.test.js \
  docs/DRAG_PERFORMANCE_BASELINE.md CHANGELOG.md
git commit -m "perf: snapshot geometry once per drag frame"
```

---

## Task 6: Auto-scroll 在没有新 dragover 时刷新 intent

**Files:**
- Modify: `src/content/content-drag-multi.js:246-316`
- Modify: `src/content/content-tree-interactions.js:909-915, 2021-2405`
- Test: `tests/content/content-drag-multi.test.js`
- Test: `tests/content/content-tree.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:**

```javascript
createAutoScrollController({
    getContainer,
    onDidScroll
})

onDidScroll({
    container,
    before,
    after,
    velocity
}) -> void

flushDragFrameNow({
    pointer,
    reason
}) -> DragFramePlan
```

只在 `after !== before` 时 callback。tree engine 保存 `lastDragPointer`，
callback 调 `invalidateDragGeometry('auto_scroll')`；该统一 seam 标 dirty 并调用
coalesced `scheduleDragFrame(lastDragPointer, 'auto-scroll')`，consumer 不直接写 flag。
保留现有 auto-scroll rAF 与 tree
drag-frame rAF 两个协调 loop，不创建第二套 drag engine；drop 时若 dirty，必须同步
`flushDragFrameNow` 后才 mutate。

- [ ] **Step 1: 写 stationary-pointer 失败测试**

覆盖：

- pointer 停在底边，连续 scroll rAF，无新 dragover；
- current intent/slot key 随 scroll 后 geometry 更新；
- 到 scroll boundary 后不 callback；
- dragend/drop `stop()` 后无 callback；
- scroll 后在 scheduled drag frame 执行前立即 drop，drop 同步刷新并使用 fresh intent；
- ordinary scheduled refresh 使用 coalesced rAF，不为每个 scroll tick 堆积 callback。

- [ ] **Step 2: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-drag-multi.test.js \
  tests/content/content-tree.test.js
```

Expected: FAIL；当前 controller 改 scrollTop 但不请求新的 intent frame。

- [ ] **Step 3: 实现 callback 与统一 scheduler**

controller tick 在成功改变 scrollTop 后调用 `onDidScroll`；tree callback 走统一
invalidation seam，若已有 pending rAF 则 coalesce。`handleDrop` 读取 current intent 前：

```javascript
if (geometryDirty && lastDragPointer) {
    flushDragFrameNow({
        pointer: lastDragPointer,
        reason: 'drop_after_geometry_invalidation'
    });
}
```

同步 flush 复用 Task 5 的 read/plan/apply functions；不得复制 intent Implementation。

- [ ] **Step 4: 运行并提交**

Run: 同 Step 2。

Expected: PASS；无 rAF 泄漏。

```bash
git add src/content/content-drag-multi.js \
  src/content/content-tree-interactions.js \
  tests/content/content-drag-multi.test.js \
  tests/content/content-tree.test.js CHANGELOG.md
git commit -m "fix: refresh drop intent during auto-scroll"
```

---

## Task 7: 同步设置 native `dropEffect`

**Files:**
- Modify: `src/content/content-tree-interactions.js:2021-2405`
- Test: `tests/content/content-tree.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:**

```javascript
resolveSynchronousDropEffect({
    clientX,
    clientY,
    geometrySnapshot,
    geometryDirty,
    state,
    groupsById,
    activeDragContext,
    parentMap,
    prevIntent
}) -> 'move' | 'none'
```

该函数不得查询 DOM/读取新 geometry，也不得用 `event.target.closest()` 推导 intent。
snapshot 可用且 clean 时，用 Task 5 的 pure `computeDropIntentRaw` 对当前 client pointer
重新算 intent/invalid；snapshot 缺失或因 render/scroll dirty 时保守 `move`，真正 drop
由 fresh intent fail closed。unsupported drag payload 可仅凭 active context 返回 `none`。

- [ ] **Step 1: 写 pending-rAF 失败测试**

先完成一帧以 prime clean geometry snapshot，再安装未执行的下一 rAF，断言 handler 返回前：

- 当前 pointer 移到 invalid coordinate 已 `dropEffect = 'none'`；
- 下一 event pointer 移到 valid coordinate，同步恢复 `'move'`，不复用 stale none；
- snapshot missing/dirty 时返回 `'move'`，不猜 invalid；
- prime snapshot 后 hover-expand/render/scroll invalidation、下一 rAF 尚未执行时返回
  conservative `'move'`；
- 上述 dirty 状态下立即 drop 会同步 fresh flush，再使用新 intent mutate；
- setter throw 被 catch，不阻止 frame schedule；
- single/multi source 与 group-descendant 均覆盖。

- [ ] **Step 2: 运行并确认红灯**

Run: `npm run test:unit -- --runTestsByPath tests/content/content-tree.test.js`

Expected: FAIL；当前写入发生在 rAF callback。

- [ ] **Step 3: 在原 DragEvent 生命周期内写 feedback**

`handleDragOver(event)` 在 `preventDefault()` 后、schedule rAF 前，每次都尝试赋值
`event.dataTransfer.dropEffect`。它把 current coordinates + clean cached snapshot 交给
`resolveSynchronousDropEffect`；frame plan 只更新视觉 marker/cache，不再依赖异步
DataTransfer mutation。

- [ ] **Step 4: 运行并提交**

Run: 同 Step 2。

Expected: PASS；没有额外 rect/query。

```bash
git add src/content/content-tree-interactions.js \
  tests/content/content-tree.test.js CHANGELOG.md
git commit -m "fix: synchronize native invalid-drop feedback"
```

---

## Full Verification Gate

- [ ] **Step 1: Focused matrix**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-tree.test.js \
  tests/content/content-drag-reflow.test.js \
  tests/content/content-drag-multi.test.js \
  tests/content/content-lifecycle.test.js \
  tests/content/content-persistence.test.js \
  tests/content/content-developer-logger.test.js
```

Expected: PASS。

- [ ] **Step 2: Runtime/package matrix**

Run:

```bash
npm run verify:full
npm run package
git diff --check
DRAG_PLAN_START_SHA=$(sed -nE \
  's/^Drag Plan Start SHA: `([0-9a-f]{40})`$/\1/p' \
  docs/superpowers/reports/2026-07-26-optimization-baseline.md | tail -n 1)
test -n "$DRAG_PLAN_START_SHA"
git cat-file -e "${DRAG_PLAN_START_SHA}^{commit}"
git diff --check "$DRAG_PLAN_START_SHA"..HEAD
```

Expected: PASS；SHA 从持久 report 重新读取并验证为 commit。

- [ ] **Step 3: Performance/layout gate**

Run:

```bash
npx playwright test tests/smoke/drag-reflow-layout.smoke.spec.js
npm run benchmark:drag
```

Expected:

- layout error ≤1px；
- 500-row callback CPU p95 ≤ baseline × 1.10；
- 500-row/50-selection prepare CPU p95 ≤ baseline × 1.10，forced layout read phases ≤3；
- geometry/query calls 低于 baseline；
- deterministic read→write guards PASS。

- [ ] **Step 4: Rollback checks**

- Task 3 是持久化迁移：发布前确认 `before_classic_mode_sweep` history 可恢复；
- 只有 Task 4 的 fold/unfold 行为受 `dragMode: 'reflow'` Beta gate 保护；
- Task 5 重写 shared drop intent，Task 6 auto-scroll、Task 7 dropEffect 也运行于 Classic，
  三项必须同时通过 Classic/Reflow matrix，不能靠关闭 Beta 回滚；
- 任一 intent 契约回归、layout error >1px、p95 退化 >10% 时，只回滚对应 commit；
- 不通过删除测试、放宽 1px/10% 门槛或改 benchmark fixture 来接受退化。
