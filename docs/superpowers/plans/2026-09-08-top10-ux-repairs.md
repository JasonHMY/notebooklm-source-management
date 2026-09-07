# Top 10 UX Repairs Implementation Plan

> **For agentic workers:** 使用 superpowers:subagent-driven-development 按任务实现、审查并由主代理整合；共享文件按下述所有权串行修改，不另建用户任务。

**Goal:** 修复同日审查的全部十项问题，并为每项提供当前代码及可重复的验收证据。

**Architecture:** 保留现有MV3无bundler结构。以来源身份、异步实例生命周期、真实保存版本和可观察UI状态为边界做局部修复；复用既有确认、恢复和同步组件。

**Tech Stack:** Plain JavaScript, Chrome MV3, Shadow DOM, chrome.storage.local, Jest 29, Playwright。

**Spec:** [Top 10 UX Repair Design](../specs/2026-09-08-top10-ux-repair-design.md)

## Global Constraints

- 不新增依赖、权限、manifest host；保留原有不相关改动。
- 所有变更记入CHANGELOG，结构/功能/测试/维护说明同步PROJECT_DIRECTORY。
- 默认只使用隔离headless测试；禁止真实Notebook删除/重命名或线上发布。
- main入口、共享文档和全量验证由主代理负责；独立agent仅修改约定模块与focused测试。
- 单项变更先有可失败的行为回归用例，再修生产代码；不得用改变测试预期掩盖原问题。
- 完成gate：lint → unit → smoke → package → ZIP integrity → git diff --check；本地提交，不push。

## 执行与文件所有权

- 主代理：任务2/5/7/9，src/content/index.js、content-source-sync.js、content-view-state.js、content-style-text.js、smoke、计划/契约/README/UI/CHANGELOG/地图。
- 持久化agent：任务3/4，content-persistence.js、content-state-repair.js、persistence/background相关单元测试；所需index集成由主代理完成。
- 身份agent：任务6/10，source-descriptor-helpers.js、content-state-reconcile.js、source-sync单元测试；所需source-sync生产集成先与主代理确认。
- 操作agent：任务1，content-source-actions.js、对应单元测试；完成后可接任务8的queue模块，所需index/render集成交主代理。
- locales新key统一由主代理整合，避免同文件并发覆盖。

## Task 1: 单条删除确认

**Files:** src/content/content-source-actions.js; src/content/index.js; _locales/*/messages.json。

**Tests:** tests/content/content-source-actions.test.js。

**Interfaces:** handleSourceActionSelection / deleteNativeSourceFromAction -> confirmed deleteNativeSource。

**验收:** 菜单 delete-source 只打开确认；取消/路由变化不调用 native delete；确认一次才继续且仍使用新鲜identity；批量不重复确认。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-source-actions.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(confirmButton.click).not.toHaveBeenCalled();
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 2: 拆除取消异步来源工作

**Files:** src/content/index.js; src/content/content-source-sync.js。

**Tests:** tests/content/content-lifecycle.test.js; tests/content/content-source-sync.test.js; tests/smoke/extension-smoke.spec.js。

**Interfaces:** cleanupManagerResources -> debouncedScanAndSync.cancel；source-sync context validator。

**验收:** native title mutation排队后立即disable，推进所有timer，storage中的root/groups不变，旧回调不点击也不保存；新实例正常同步。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-lifecycle.test.js tests/content/content-source-sync.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(savedState.groupsById).toEqual(beforeState.groupsById);
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 3: 尊重正常持久化整理

**Files:** src/content/content-persistence.js; src/content/content-state-repair.js。

**Tests:** tests/content/content-persistence.test.js。

**Interfaces:** pickPreferredStoredState -> raw authority selection；explicit recovery APIs preserved。

**验收:** rev9空folder+ungrouped对rev8已分组backup，pickPreferredStoredState保持rev9；显式恢复rev8仍可行；真正畸形树按规范化处理。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-persistence.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(selected.groupsById.g.children).toEqual([]);
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 4: 冲突重试禁止覆盖远端

**Files:** src/content/content-persistence.js; src/content/index.js; _locales/*/messages.json。

**Tests:** tests/content/content-persistence.test.js; tests/background.test.js。

**Interfaces:** save revision map remains true local base；stale status refresh action。

**验收:** A写rev2后B旧rev1连续重试都失败且primary仍是A；本地recovery仍含B；加载新状态后正常写入。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-persistence.test.js tests/background.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(retry.errorCode).toBe("stale_revision");
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 5: 仅看与回答来源分离

**Files:** src/content/content-view-state.js; src/content/content-tree-interactions.js; src/content/index.js; _locales/*/messages.json。

**Tests:** tests/content/content-view-state.test.js; tests/content/content-render.test.js; tests/smoke/extension-smoke.spec.js。

**Interfaces:** isSourceWithinActiveIsolation affects rendering only；isSourceEffectivelyEnabled uses source + ancestors。

**验收:** 进入/退出仅看与disable后native checked均为原数组；仍只渲染目标树；用户显式toggle folder仍改变回答来源。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-view-state.test.js tests/content/content-render.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(nativeStatesAfter).toEqual(nativeStatesBefore);
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 6: 故障检测排除标题

**Files:** src/content/source-descriptor-helpers.js。

**Tests:** tests/content/content-source-sync.test.js; tests/smoke/extension-smoke.spec.js。

**Interfaces:** hasSourceFailureSignal -> status-only signals。

**验收:** 错误处理、为什么失败、Failure Analysis正常ready；独立可见failed状态/属性保留识别；隐藏状态不误伤。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-source-sync.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(descriptor.isFailed).toBe(false);
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 7: 搜索保留完整操作路径

**Files:** src/content/content-style-text.js; src/content/content-view-state.js。

**Tests:** tests/content/content-view-state.test.js; tests/smoke/extension-smoke.spec.js。

**Interfaces:** syncSearchUi + sp-controls layout preserve toolbar。

**验收:** 360px输入query后批量按钮可点击；筛选保持并选中匹配来源移动；无不可见tab目标、无横向溢出或隐藏toolbar高占位。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-view-state.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
await expect(page.locator("#sp-batch-action-btn")).toBeVisible();
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 8: 勾选队列响应与进度

**Files:** src/content/content-tree-interactions.js; src/content/content-view-state.js; src/content/content-render.js; src/content/index.js; _locales/*/messages.json。

**Tests:** tests/content/content-tree.test.js; tests/smoke/extension-smoke.spec.js。

**Interfaces:** native selection queue -> bounded work + actual-state confirmation + progress callback。

**验收:** 100个立即生效checkbox不再需14.925秒；每项仍确认、慢checkbox不会重复乱点；中途取消/替换同source请求都正确；进度与实际确认数一致。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-tree.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(completed.every((result) => result.ok)).toBe(true);
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 9: 折叠面板不强制刷新

**Files:** src/content/index.js; src/content/content-panel-dom.js。

**Tests:** tests/content/content-lifecycle.test.js; tests/smoke/extension-smoke.spec.js。

**Interfaces:** getSourcePanelState -> route recovery waiting states。

**验收:** SPA目标panel存在但scrollArea display:none，推进重试不会reload；之后展开正常挂载；真实missing有界恢复仍正确。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-lifecycle.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(window.location.reload).not.toHaveBeenCalled();
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## Task 10: 重复弱身份稳定绑定

**Files:** src/content/source-descriptor-helpers.js; src/content/content-state-reconcile.js; src/content/content-source-sync.js; src/content/content-persistence.js; src/content/content-snapshot-transaction.js; src/content/index.js; src/content/content-modals.js。

**Tests:** tests/content/content-source-sync.test.js。

**Interfaces:** descriptor identity metadata -> byElement/strong identity resolution before unsafe weak-key match。

**验收:** [A,B]同fingerprint节点重排为[B,A]，标签/分组/enabled仍跟原节点；reload全新歧义节点不抢旧状态；独立stable tokens和唯一fallback正常。

- [x] 写最小回归场景并运行以下focused入口；确认失败与上面的实际行为一致。

```sh
npx jest tests/content/content-source-sync.test.js --runInBand
```

核心行为断言（依测试既有harness变量命名实现）：

```js
expect(afterByElement.get(sourceA).tagIds).toEqual(beforeByElement.get(sourceA).tagIds);
```

- [x] 沿既有接口实施局部修复，保留规格中的取消、身份、保存和兼容边界。
- [x] 运行focused回归及邻近原有用例；UI/生命周期另执行隔离浏览器完整流程。
- [x] 主代理审查生产调用链与断言覆盖，更新CHANGELOG/PROJECT_DIRECTORY相关描述并记录证据。

**Status:** complete; regression, integration review and final verification passed

## 全部完成验收

- [x] 十项Status均有具体实现文件、focused回归及验证结果；所有未决定行为已按当前用户输入落实。
- [x] `npm run lint`
- [x] `npm run test:unit`
- [x] `npm run test:smoke`
- [x] `npm run package`，核对ZIP内部版本、allowlist和完整性。
- [x] 重走删除取消、延迟sync后disable、移回未分组reload、多tab冲突、仅看、标题误判、先搜索后批量、勾选进度、折叠SPA及重复身份场景。
- [x] 复查UI截图、所有文档链接和 `git diff --check`。
- [x] 独立整体代码审查，发现已处理；最终本地提交以Git记录核验，原有未提交变更保留。

## 决策与验证记录

- 2026-09-08：当前用户已授权修复上轮完整Top10；以十个既有流程的局部修复执行，不重复要求批准相同范围。当前原有修改已复制到 `/tmp/nsm-top10-fix-baseline-20260908`，提交时只纳入本轮改动。
- 2026-09-08：保持版本26.8.24作为未发布开发变更，package仅用于验证；不把本地ZIP称为正式发布。

- 2026-09-08：任务1–9已有独立审查与focused/browser证据；任务8补第二次点击延迟生效、单条失败立即重试入口。Task4额外browser发现并修复刷新时failed recovery被生命周期覆盖的问题。
- 2026-09-08：Task10完整初始恢复链检查确认安全停止仍会造成永久pending；扩大该项内部实现为现有SourceRepair中的显式live element绑定、单事务canonical snapshot保存/失败回滚，保持不自动猜测身份。

- 2026-09-08：真实隔离浏览器SourceRepair下拉选择验证通过：初始两份同名来源默认不选，手动交换对应行后canonical保存包含正确folder/tag/enabled；重排原生DOM后再次打开设置无未解决项。测试已加入smoke。
- 2026-09-08：Task8同一100来源fixture单次前后样本：HEAD baseline原生全部取消确认17,050.7ms，当前快照2,196.7ms；两侧均100/100原生false。只是单次样本，不作统计性性能保证。
- 2026-09-08：全unit 52 suites / 1809 tests通过。全smoke抓到真实native视图切换会替换整页DOM，strict旧实例guard正确拒绝旧回调但导致合法切换无法完成；正在为同notebook的已授权native切换补有界新实例handoff，不放宽一般旧回调guard。最终全套gate待此修复。


## 最终验收（2026-09-08）

| 项目 | 证据 |
|---|---|
| 1 单条删除确认 | source-actions 回归；browser确认前零native菜单点击，Escape取消，明确确认后才开始native流程 |
| 2 旧实例工作取消 | lifecycle取消/route/label监听/poll回归；browser native title mutation排队后disable，持久化groups/root/ungrouped保持 |
| 3 正常移出不被恢复 | persistence较新空folder回归；browser移出最后来源后reload仍空folder，2来源保持ungrouped |
| 4 双标签冲突 | stale连续重试保留原base；browser A保存→B冲突→Refresh，A仍为primary且B recovery仍在 |
| 5 仅看纯视觉 | view-state/render回归；browser进入/退出/禁用后native [true,true]保持 |
| 6 标题故障误判 | title、hidden/visible状态、child error属性回归；browser健康错误/失败标题可勾选 |
| 7 搜索批量路径 | browser360px先搜索再进入batch移动；240/320px与高缩放无控件重叠，短面板批量栏内部滚动 |
| 8 原生队列与反馈 | 100项bounded-timer、两次点击完整确认窗口、取消/supersede回归；browser慢项真实进度与timeout→Retry→成功；实际100项单次17.05s→2.20s |
| 9 折叠SPA不reload | lifecycle与browser collapsed destination保持0个document请求，展开后挂载；正常native视图DOM重建由有界handoff确认 |
| 10 模糊身份与修复 | 同DOM重排/fresh DOM停止自动匹配；browser手动交换对应行→canonical保存/正确native选择→重排后匹配健康；事务save/history/rollback上下文回归 |

最终串行运行 `npm run lint` → `npm run test:unit` → `npm run test:smoke` → `npm run package` 全部成功。Unit为52 suites / 1820 tests；smoke为37 passed / 2 skipped（默认opt-in benchmark）。ZIP 70个文件与当前源码逐字节一致，CRC及版本元数据检查通过；`git diff --check`和文档链接检查通过。保持26.8.24为未发布开发修复，不发布商店。

完整运行日志：`/tmp/nsm-top10-final-verification-2.log`。当前截图与一次性100来源对比摘要在 `/Users/hmy/.codex/visualizations/2026/09/07/01a07dae-9df2-7932-a59a-e80bfdf4b140/plugin-fixes/`。原发布包已保留到 `/tmp/nsm-top10-fix-baseline-20260908/release-original/`。
