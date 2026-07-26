# Storage Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让配置导入、状态保存/读取、生命周期清理、历史恢复点与开发者日志满足可证明的数据完整性契约；任何不支持的版本、失败的 critical write 或跨 notebook 请求都必须 fail closed，且不静默覆盖现有数据。

**Architecture:** 保留 `content-persistence.js → chrome.runtime.sendMessage → background service worker → chrome.storage.local` 的本地持久化链路。先用局部行为修复稳定契约，再把跨 content/background 重复的 key/version 定义抽成一个无 DOM、无 Chrome API 的 Storage Contract Module。主状态写入仍由 background per-notebook FIFO 和 revision guard 所有；session recovery 只作未确认写入的兜底。

**Tech Stack:** Vanilla JavaScript IIFE、MV3 service worker、Chrome Storage API、Jest callback/queue fixtures、现有 headless smoke/package verifier。

**Global Constraints:**

- 不增加远程后端、dependency、permission、host permission 或 storage key。
- `sourcesPlusState_<projectId>`、`__backup`、history、recovery、developer-log 既有 key 均保持兼容。
- future schema 只读保护按 notebook load 生命周期生效；一次非法导入不得永久锁住当前 notebook。
- 生命周期异步消息不承诺一定完成；在 background 未确认成功前不得清除 session recovery。
- 自动 quota 裁剪不得删除 `manual === true` 的用户恢复点；空间仍不足时拒绝增长写入。
- 日志 payload 继续遵守 `docs/DEVELOPER_LOGGING.md` 的脱敏白名单。
- 每个任务都先写失败测试，focused PASS 后独立提交；Task 7 的共享 Module 抽取最后执行，避免行为修复与结构重构混审。
- 开始 Task 1 前执行 `git rev-parse HEAD`，把返回值写入
  `docs/superpowers/reports/2026-07-26-optimization-baseline.md` 唯一的
  `Storage Plan Start SHA:` 字段；若 report 不存在，先执行路线图 Task 1。不得依赖跨 shell
  临时变量。
- 每个 commit 前运行 `git diff --check`，commit 后运行
  `git show --check --oneline --stat HEAD`；最终 gate 不能只检查空 working tree。

---

## File Structure

- `src/content/content-persistence.js` — schema compatibility、content-side save/load/recovery、lifecycle flush。
- `src/content/content-import-export.js` — envelope version、preview/apply、atomic rollback。
- `src/content/content-state-apply.js` — snapshot → runtime，包括 `customHeight` 完整恢复。
- `src/content/index.js` — import rollback Adapter 与 disable/teardown 编排。
- `src/background/index.js` — per-key FIFO、revision guard、state/history/log message routes、quota policy。
- `src/utils/storage-contract.js` — 最后抽取的 key/version 纯契约 Module。
- `tests/content/content-persistence.test.js` — content save/load/recovery/future-schema。
- `tests/content/content-import-export.test.js` — envelope/atomic import。
- `tests/content/content-state-apply.test.js` — runtime 与容器高度恢复。
- `tests/content/content-lifecycle.test.js` — disable/teardown flush。
- `tests/background.test.js` — background queue、quota、sender ownership、logs。
- `tests/storage-contract.test.js` — 共享 key/version contract。
- `docs/STORAGE_SCHEMA.md`、`docs/MESSAGE_CONTRACTS.md`、`docs/DEVELOPER_LOGGING.md` — 权威契约。

---

## Task 1: 对 future schema 与未知导入 envelope fail closed

**Files:**
- Modify: `src/content/content-persistence.js:1219-1308`
- Modify: `src/content/content-import-export.js:4, 89-95, 297-329`
- Test: `tests/content/content-persistence.test.js`
- Test: `tests/content/content-import-export.test.js`
- Modify: `docs/STORAGE_SCHEMA.md`
- Modify: `docs/superpowers/reports/2026-07-26-optimization-baseline.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `storageSchemaVersion === 5`；既有 legacy raw-state import。
- Produces:
  - `isUnsupportedFutureSchema(stateData): boolean`
  - `IMPORT_EXPORT_FORMAT_VERSION = 1`
  - `unwrapImportConfigPayload(parsedConfig): object|null`
  - notebook-scoped `futureSchemaWriteBlocked: boolean`
- Contract:
  - 无 `format`/`formatVersion`/`data` envelope marker 的 object 继续按 legacy raw state 解析。
  - 出现任一 envelope marker 时，必须同时满足精确 `format`、`formatVersion === 1` 和 object `data`。
  - `schemaVersion` 为整数 1–5 才可 normalize；缺失按 legacy；大于 5 或非法值返回 `null`。

在任何 production/test edit 前，把本计划开始时 `git rev-parse HEAD` 的原始 40 位输出写入
baseline report 的 `Storage Plan Start SHA:` 唯一字段；该 report 与本 task 一起提交。

- [ ] **Step 1: 写未知 envelope 的失败测试**

在 `tests/content/content-import-export.test.js` 增加：

```javascript
it('rejects a wrapped config with an unknown formatVersion', () => {
    const deps = createDeps();
    const { IMPORT_EXPORT_FORMAT, parseImportConfigText } = createContentImportExport(deps);
    expect(parseImportConfigText(JSON.stringify({
        format: IMPORT_EXPORT_FORMAT,
        formatVersion: 2,
        data: {
            schemaVersion: 5,
            root: [],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {}
        }
    }))).toEqual({ ok: false, reason: 'invalid' });
});

it('rejects an unknown envelope instead of treating data as a bare state', () => {
    const { parseImportConfigText } = createContentImportExport(createDeps());
    expect(parseImportConfigText(JSON.stringify({
        format: 'unknown-config',
        formatVersion: 1,
        data: {
            schemaVersion: 5,
            root: [],
            groupsById: {},
            ungrouped: [],
            sourceStateById: {}
        }
    }))).toEqual({ ok: false, reason: 'invalid' });
});
```

- [ ] **Step 2: 写 future schema 不迁移、不覆盖的失败测试**

在 `tests/content/content-persistence.test.js` 增加：

```javascript
it('rejects a schema newer than v5 without scheduling a storage upgrade', () => {
    expect(mod.normalizeLoadedState({
        schemaVersion: 6,
        root: [{ type: 'source', key: 'future-source' }],
        groupsById: {},
        ungrouped: [],
        sourceStateById: {
            'future-source': { enabled: true }
        }
    })).toBeNull();
    expect(mod._getPendingStorageUpgrade()).toBe(false);
});
```

再加 load integration：storage 返回 `schemaVersion: 6` 后调用
`saveState({ immediate: true })`，`chrome.runtime.sendMessage` 不得收到 `SAVE_STATE`；
`pendingStructuralStateRepair` 与 pending migration 均不得设置。

- [ ] **Step 3: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-import-export.test.js \
  tests/content/content-persistence.test.js
```

Expected: FAIL；当前 unknown `formatVersion` 被 normalize，v6 落入 legacy branch。

- [ ] **Step 4: 实现精确 envelope gate**

在 `content-import-export.js` 定义并导出：

```javascript
const IMPORT_EXPORT_FORMAT_VERSION = 1;

function unwrapImportConfigPayload(parsedConfig) {
    if (!parsedConfig || typeof parsedConfig !== 'object') return null;
    const hasEnvelopeMarker = ['format', 'formatVersion', 'data']
        .some((key) => Object.prototype.hasOwnProperty.call(parsedConfig, key));
    if (!hasEnvelopeMarker) return parsedConfig;
    if (
        parsedConfig.format !== IMPORT_EXPORT_FORMAT ||
        parsedConfig.formatVersion !== IMPORT_EXPORT_FORMAT_VERSION ||
        !parsedConfig.data ||
        typeof parsedConfig.data !== 'object'
    ) {
        return null;
    }
    return parsedConfig.data;
}
```

`parseImportConfigText` 必须先检查 `unwrapImportConfigPayload()` 非空，再调用
`normalizeLoadedState()`；`createExportConfigPayload()` 复用该常量。

- [ ] **Step 5: 实现 future-schema notebook write block**

`normalizeLoadedState` 在读取/记忆 revision 前分类 schema。future/invalid 直接返回
`null`，不得设置 pending migration。

`loadState()` 必须在 `pickPreferredStoredState(primary, backup, history)` 进入 structural
repair 前先执行 raw compatibility gate：

1. 用既有 revision/quality comparator 新增
   `pickAuthoritativeRawState(primary, backup)`；该函数只比较 metadata/shape，不 normalize、
   不 repair；
2. 对 authoritative raw candidate 调 schema compatibility；
3. future/invalid 时设置当前 manager instance 的
   `futureSchemaWriteBlocked = true`；
4. 调用：

```javascript
setSaveStatus({
    state: 'failed',
    lastError: 'unsupported_schema'
});
```

5. 不进入 `pickPreferredStoredState`、不 inspect history repair candidates、不 apply、不 save；
6. legacy/supported 时才把 primary/backup 和仅包含 legacy/supported snapshot 的 history
   交给既有 normalize/repair；
7. 在下一次不同 `projectId` / manager instance load 开始时重置 write-block flag。

`canPersistManagerState()` 将该 flag 纳入结果；import parser 的 v6 失败不设置该 flag。

- [ ] **Step 6: 运行测试**

Run: 同 Step 3。

Expected: PASS；既有 bare raw-state import 测试继续通过，所有 wrapped fixture 带
`formatVersion: 1`。

- [ ] **Step 7: 更新契约并提交**

`docs/STORAGE_SCHEMA.md` 写明 v1–v5/legacy/future/invalid 四种结果和“future 不自动降级写回”。

```bash
git add src/content/content-persistence.js \
  src/content/content-import-export.js \
  tests/content/content-persistence.test.js \
  tests/content/content-import-export.test.js \
  docs/STORAGE_SCHEMA.md \
  docs/superpowers/reports/2026-07-26-optimization-baseline.md \
  CHANGELOG.md
git commit -m "fix: reject unsupported storage and import versions"
```

---

## Task 2: 导入原子提交与失败回滚

**Files:**
- Modify: `src/content/content-import-export.js:14-42, 394-451`
- Modify: `src/content/content-persistence.js`
- Modify: `src/content/index.js:3541-3568, 3645-3718`
- Modify: `src/content/content-state-apply.js:50-160`
- Test: `tests/content/content-import-export.test.js:256-335`
- Test: `tests/content/content-persistence.test.js`
- Test: `tests/content/content-state-apply.test.js`
- Modify: `docs/STORAGE_SCHEMA.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - `buildPersistableState(): PersistedState`
  - `appendStateHistorySnapshot(snapshot, reason): Promise`
  - `saveState({ immediate, critical, recordUndo }): Promise<SaveResult>`
- Produces:
  - dependency `rollbackImportSnapshot(snapshot): boolean`
  - `applyImportConfig(text)` failure result includes `rolledBack: boolean`
  - critical save option `recoveryFallbackSnapshot: PersistedState`
  - key-bound recovery API:
    `writeRecoverySnapshot(snapshot, { recoveryKey, ...metadata })` /
    `clearRecoverySnapshot(recoveryKey)`
  - immutable `SaveOperationContext` captured before enqueue:

```javascript
{
    projectId,
    stateKey,
    recoveryKey,
    instanceToken,
    clientSaveId,
    saveSnapshot,
    recoverySnapshot
}
```

- Success return shape and exported function names remain unchanged.

- [ ] **Step 1: 写 save failure/throw/deferred 回滚测试**

主测试：

```javascript
it('restores the pre-import runtime when the critical save fails', async () => {
    const before = {
        schemaVersion: 5,
        root: [],
        groupsById: {},
        ungrouped: [],
        sourceStateById: {},
        customHeight: null
    };
    const deps = createDeps();
    deps.buildPersistableState.mockReturnValue(before);
    deps.saveState.mockResolvedValue({
        ok: false,
        reason: 'storage_quota_exceeded'
    });
    deps.rollbackImportSnapshot = jest.fn(() => true);

    const result = await createContentImportExport(deps)
        .applyImportConfig(JSON.stringify({
            schemaVersion: 5,
            root: [{ type: 'group', id: 'after' }],
            groupsById: {
                after: { id: 'after', children: [] }
            },
            ungrouped: [],
            sourceStateById: {}
        }));

    expect(result).toMatchObject({
        ok: false,
        reason: 'storage_quota_exceeded',
        rolledBack: true
    });
    expect(deps.rollbackImportSnapshot).toHaveBeenCalledWith(before);
    expect(deps.saveState).toHaveBeenCalledWith(expect.objectContaining({
        recoveryFallbackSnapshot: before
    }));
});
```

同组覆盖：

- `saveState` throw；
- `restoreInitialLoadedState()` 返回 `deferred: true`；
- pre-import `customHeight: null` 时清除 imported inline height；
- rollback 返回 false 时结果为 `rolledBack: false`，且无 success toast。
- critical save failure 后 `readRecoverySnapshot().snapshot` 是 pre-import snapshot，reason
  为 `import_rollback_required`；
- critical save Promise 永不 settle / manager context 随即销毁时，recovery 从请求开始
  就是 pre-import snapshot，reason 为 `import_pending`；
- 一个旧 save 已在飞、critical import 尚排队未 dispatch 时立即 destroy，import recovery
  也已在 enqueue 当下写成 pre-import snapshot；
- deferred 路径未发 critical save，因此保留此前已有 recovery，不清除、不覆盖。
- notebook A save pending 后切到 B，A success 只清 A recovery/更新 A revision ledger，
  不清 B recovery、不更新 B status；
- 同样切换后 A failure 只标记 A recovery failed，不覆盖 B recovery/status/revision。
- `runtime_unavailable` 即使 local fallback helper 可成功，也不得清 recovery；import
  critical write 禁止 local fallback。
- runtime callback 返回 `undefined` 或缺少 boolean `success` → import 返回
  `import_ack_unknown`、runtime rollback、pre-import recovery 不清除；reload 时 recovery
  status/actions 显示 reconciliation。
- failure mapping：rollback 返回 false → `rollback_failed`；quota →
  `storage_quota_exceeded`；stale/runtime unavailable/其它明确 reject → `save_failed`。

- [ ] **Step 2: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-import-export.test.js \
  tests/content/content-persistence.test.js \
  tests/content/content-state-apply.test.js
```

Expected: FAIL；当前 save failure 保留 imported runtime。

- [ ] **Step 3: 实现 rollback Adapter**

`content-import-export.js` destructure 并验证：

```javascript
rollbackImportSnapshot = () => false,
```

在任何 runtime mutation 前：

```javascript
const beforeImportSnapshot = cloneSerializableData(buildPersistableState());
await appendStateHistorySnapshot(beforeImportSnapshot, 'before_import');
writeImportBackupSnapshot();
```

save 返回 false、throw 或 deferred 时统一调用：

```javascript
const rolledBack = rollbackImportSnapshot(beforeImportSnapshot);
render();
return {
    ...preview,
    ok: false,
    reason: mapImportFailureReason({
        saveReason: reason,
        rolledBack
    }),
    rolledBack
};
```

mapping 固定为：

```javascript
function mapImportFailureReason({ saveReason, rolledBack }) {
    if (!rolledBack) return 'rollback_failed';
    if ([
        'runtime_message_error',
        'runtime_exception',
        'empty_response'
    ].includes(saveReason)) {
        return 'import_ack_unknown';
    }
    if (saveReason === 'storage_quota_exceeded') {
        return 'storage_quota_exceeded';
    }
    return 'save_failed';
}
```

parser validation 仍返回 `invalid`，尚未发 save 的 deferred path 仍返回 `deferred`；二者不走
上述 mapping。底层 `stale_revision`、`runtime_unavailable` 等 reason 只写 sanitized
save status/log，不泄漏成未声明的 `ImportApplyResult.reason`。

critical save 调用必须携带：

```javascript
saveState({
    immediate: true,
    critical: true,
    recoveryFallbackSnapshot: beforeImportSnapshot,
    allowLocalFallback: false
});
```

失败路径不得显示 imported success toast；session import backup 保留，供 rollback 失败时人工恢复。
不得从 import module 调 `clearRecoverySnapshot()`。

- [ ] **Step 4: 在 index/state-apply 完成完整状态恢复**

`src/content/index.js` 新增：

```javascript
function rollbackImportSnapshot(snapshot) {
    pendingInitialLoadedState = null;
    return applyPersistableSnapshotToRuntime(snapshot);
}
```

将其注入 import/export factory。

`content-persistence.js` 在 enqueue 前捕获上述 `SaveOperationContext`。`stateKey`、
`recoveryKey`、`projectId`、`instanceToken` 不得在 async callback 中重新读取当前 `ctx`。
revision 改为 per-state-key ledger；operation 真正轮到 dispatch 时从
`saveRevisionByStateKey.get(operation.stateKey)` 取得并固定 `baseRevision`，A 的 queue
永远不读取 B 的 current revision。

`sendStateToRuntimeStorage` 的 success gate 固定为：

```javascript
if (!response || typeof response.success !== 'boolean') {
    resolve({ ok: false, reason: 'empty_response' });
    return;
}
const storageMetadata = getStorageMetadataFromResponse(response);
if (response.success === false) {
    if (response.errorCode === 'stale_revision') {
        resolve({
            ok: false,
            reason: 'stale_revision',
            stale: true,
            currentRevision: Number(response.currentRevision) || 0,
            ...storageMetadata
        });
        return;
    }
    resolve({
        ok: false,
        reason: response.errorCode || response.reason || 'runtime_failure',
        ...storageMetadata
    });
    return;
}
resolve({
    ok: true,
    stale: Boolean(response.stale),
    saveRevision: Number(response.saveRevision) || 0,
    savedAt: response.savedAt || '',
    ...storageMetadata
});
return;
```

只有明确 `success:true` 才能成为 background acknowledgement；空/malformed response
不得落入 success 或清 recovery。该代码位于现有 Promise callback 内，所有分支必须显式
`resolve(...); return;`；stale/currentRevision 与 quota/storage metadata 原样保留。
undefined/malformed test 必须断言 Promise settled，而不只检查最终 recovery。revision
ledger 更新留在 key-bound operation completion，不在此 callback 写当前 notebook 的全局
revision。

critical queue 在 dispatch background request **之前**选择并写 recovery：

```javascript
const recoverySnapshot = operation.recoverySnapshot;
writeRecoverySnapshot(recoverySnapshot, {
    recoveryKey: operation.recoveryKey,
    reason: options.recoveryFallbackSnapshot
        ? 'import_pending'
        : (options.reason || 'save_pending'),
    clientSaveId: operation.clientSaveId,
    failed: false
});
```

background failure 时保留同一 `recoverySnapshot`，只更新 metadata：

```javascript
const isAmbiguousAck = [
    'runtime_message_error',
    'empty_response',
    'runtime_exception'
].includes(result.reason);
writeRecoverySnapshot(recoverySnapshot, {
    recoveryKey: operation.recoveryKey,
    reason: isAmbiguousAck && options.recoveryFallbackSnapshot
        ? 'import_ack_unknown'
        : options.recoveryFallbackSnapshot
            ? 'import_rollback_required'
        : (result.reason || 'save_failed'),
    clientSaveId: operation.clientSaveId,
    failed: true
});
```

只有 `result.runtimeResult?.ok === true` 才调用
`clearRecoverySnapshot(operation.recoveryKey)`；`result.ok === true` 但仅 local fallback
成功不算 background success。completion 始终只更新 operation.stateKey 的 revision
ledger；只有当前 projectId + instanceToken 仍与 operation 相同，才更新当前 UI/save
status。这样 callback 永不 settle、context 丢失或 A→B 切换时都不会把未确认的 imported
snapshot 当作恢复真相，也不会碰 B 的 recovery/status。

对已收到 background 明确 pre-commit reject（quota/stale/unsupported）的 import，primary
保持导入前；对 `runtime_message_error`/response 丢失等 commit acknowledgement ambiguous
情况，runtime 立即 rollback，`ImportApplyResult.reason` 与 recovery reason 都改为
`import_ack_unknown` 并保留 pre-import snapshot。下一次 load 必须先显示/暴露该
recovery reconciliation，不得把 primary 的不确定状态静默当作已确认导入。
`detectRecoverySnapshotAvailability()` 对 `import_ack_unknown` 固定返回 available，并保留
现有“恢复/忽略”显式 action；load 不自动 clear 或把 primary 标记为 confirmed。

`applyPersistableSnapshotToRuntime` 无论 snapshot height 是否为空都同步：

```javascript
runtime.customHeight = normalizedState.customHeight ?? null;
const container = runtime.shadowRoot?.querySelector?.('.sp-container');
if (container) {
    container.style.height = runtime.customHeight == null
        ? ''
        : `${runtime.customHeight}px`;
}
```

- [ ] **Step 5: 运行测试并提交**

Run: 同 Step 2。

Expected: PASS；groups/tags/source enabled/root/ungrouped/customHeight 全部恢复。

```bash
git add src/content/content-import-export.js src/content/content-persistence.js \
  src/content/index.js \
  src/content/content-state-apply.js \
  tests/content/content-import-export.test.js \
  tests/content/content-persistence.test.js \
  tests/content/content-state-apply.test.js \
  docs/STORAGE_SCHEMA.md CHANGELOG.md
git commit -m "fix: roll back failed config imports"
```

---

## Task 3: 生命周期保存统一进入 background FIFO，teardown 前 flush

**Files:**
- Modify: `src/content/content-persistence.js:775-1059, 1158-1190`
- Modify: `src/content/index.js:2029-2033, 3853-3921, 4458-4465`
- Test: `tests/content/content-persistence.test.js`
- Test: `tests/content/content-lifecycle.test.js`
- Modify: `docs/STORAGE_SCHEMA.md`
- Modify: `docs/MESSAGE_CONTRACTS.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `enqueueStateSave`、background `SAVE_STATE` FIFO。
- Produces:
  - `sendStateToStorage(key, data, { allowLocalFallback = true, ...options })`
  - `writeStateToLocalStorage` 对同 revision 不同 snapshot 返回
    `{ ok: false, reason: 'equal_revision_conflict' }`
  - lifecycle options:

```javascript
{
    immediate: true,
    critical: true,
    recordUndo: false,
    reason: 'page_lifecycle',
    allowLocalFallback: false
}
```

  - `beginManagerCleanup({ preserveReattach, reason }): Promise<SaveResult>`
  - `disableManagerRuntime(): { success, disabled, saveStarted }`

- [ ] **Step 1: 写 lifecycle 与 disable 的失败测试**

覆盖：

1. `visibilitychange:hidden` / `pagehide` 发送 `SAVE_STATE`，不直接
   `chrome.storage.local.set` primary。
2. 普通 save 在飞时，lifecycle save 排在其后。
3. runtime 无法发送时 recovery snapshot 保留，primary 不被 direct local write 覆盖。
4. debounce save pending 时 `DISABLE_MANAGER` 和 test destroy 都在
   `cancelPendingStateSave()` 前同步 dispatch `SAVE_STATE`。
5. local fallback 收到与 stored `_saveRevision` 相同但内容不同的 snapshot 时拒绝写入；
   Promise 必须 settle、`chrome.storage.local.set` 为 0 次；内容相同的 equal-revision
   retry 仍幂等成功。
6. flush callback 保持挂起时，manager host 已立即 remove，且 cleanup 后不能再产生新的
   interaction save。

- [ ] **Step 2: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/content/content-persistence.test.js \
  tests/content/content-lifecycle.test.js
```

Expected: FAIL；当前 lifecycle 走 `skipRuntimeMessage: true`，cleanup 直接 cancel。

- [ ] **Step 3: 将 lifecycle 改走 background**

删除 lifecycle 对 `skipRuntimeMessage: true` 的使用。只有当
`allowLocalFallback !== false` 且 reason 为 `runtime_unavailable` 时，
`sendStateToStorage` 才允许旧 local fallback。

在 `writeStateToLocalStorage` 现有 stale check 后增加 equal-revision conflict gate：

```javascript
const incomingRevision = getSnapshotSaveRevision(data);
const storedRevision = getSnapshotSaveRevision(currentState);
if (
    incomingRevision > 0 &&
    incomingRevision === storedRevision &&
    !arePersistableSnapshotsEquivalent(data, currentState)
) {
    resolve({
        ok: false,
        reason: 'equal_revision_conflict'
    });
    return;
}
```

该代码位于 `writeStateToLocalStorage()` 的 Promise callback 内，必须显式 `resolve`
后 return，不能只 return object。该 gate 不修改 storage；相同内容的 retry 继续成功。
background 正常路径仍以 key-bound `baseRevision` guard 为准。

`handlePageLifecyclePersistence()` 调用 critical background path；critical queue 已负责：

- 写 recovery；
- background success 后清 recovery；
- failure 标记 recovery `{ failed: true, reason }`。

不得再写第二份 lifecycle recovery。

- [ ] **Step 4: 用一个同步 teardown seam 阻止新 mutation**

新增：

```javascript
function beginManagerCleanup({
    preserveReattach = false,
    reason = 'teardown'
} = {}) {
    const savePromise = Promise.resolve(flushPendingStateSave());
    if (preserveReattach) {
        pendingPanelReattachState = capturePendingPanelReattachState();
    }
    cleanupManagerResources();
    return savePromise;
}
```

关键时序是“同步 dispatch flush → 同步 cleanup”，不是 await 后 cleanup。这样 UI/事件源立即
消失，不会在等待 save callback 时产生第二次 mutation；save Promise 继续在后台 settle。

`disableManagerRuntime`：

```javascript
function disableManagerRuntime() {
    isExtensionEnabled = false;
    const savePromise = beginManagerCleanup({
        reason: 'extension_disabled'
    });
    managerStatusReason = projectId
        ? 'extension_disabled'
        : 'not_on_notebook_page';
    Promise.resolve(savePromise).catch(() => undefined);
    return {
        success: true,
        disabled: true,
        saveStarted: true
    };
}
```

message router 必须显式注册
`DISABLE_MANAGER: () => disableManagerRuntime()`，不得用丢弃 return value 的 wrapper。
`DISABLE_MANAGER` 保持立即 response；panel collapse/source detail 使用
`preserveReattach:true`；teardown/destroy/route leave/switch 全部复用
`beginManagerCleanup`。`cleanupManagerResources` 内的 cancel 只能清已经由 flush 取走的
debounce timer。

- [ ] **Step 5: 运行、更新契约并提交**

Run: 同 Step 2。

Expected: PASS；失败 save 会保留 recovery，不阻止用户关闭 manager。

```bash
git add src/content/content-persistence.js src/content/index.js \
  tests/content/content-persistence.test.js \
  tests/content/content-lifecycle.test.js \
  docs/STORAGE_SCHEMA.md docs/MESSAGE_CONTRACTS.md CHANGELOG.md
git commit -m "fix: preserve saves across lifecycle teardown"
```

---

## Task 4: `LOAD_STATE` 等待同 notebook pending `SAVE_STATE`

**Files:**
- Modify: `src/background/index.js:1029-1164, 1280-1304`
- Test: `tests/background.test.js`
- Modify: `docs/MESSAGE_CONTRACTS.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `loadStateNow(request, sendResponse): void`
  - `loadState(request, sendResponse): void`
- `loadState` 只等待 `stateSaveQueueByKey.get(request.key)`；不同 key 不互相阻塞。

- [ ] **Step 1: 写 queue ordering 的失败测试**

测试时序：

1. 发同 key `SAVE_STATE`，挂起 storage callback；
2. 发 `LOAD_STATE`；
3. save 完成前 load 不发 response、不启动第二次 storage read；
4. save settle 后 load 返回新 revision；
5. 不同 notebook 的 load 立即执行。

- [ ] **Step 2: 运行并确认红灯**

Run: `npm run test:unit -- --runTestsByPath tests/background.test.js`

Expected: FAIL；当前 `LOAD_STATE` 直接 `chrome.storage.local.get`。

- [ ] **Step 3: 实现 load-after-save**

把原 `LOAD_STATE` body 移到 `loadStateNow`。`loadState`：

```javascript
function loadState(request, sendResponse) {
    const pendingSave = stateSaveQueueByKey.get(request.key);
    if (!pendingSave) {
        loadStateNow(request, sendResponse);
        return;
    }
    Promise.resolve(pendingSave)
        .catch(() => undefined)
        .then(() => loadStateNow(request, sendResponse));
}
```

route 保持 async channel open。等待失败的前序 save settle 后仍执行 load，使调用方读到实际 persisted state。

- [ ] **Step 4: 运行、记录 message contract、提交**

Run: 同 Step 2。

Expected: PASS；同 key linearized，不同 key 保持并行。

```bash
git add src/background/index.js tests/background.test.js \
  docs/MESSAGE_CONTRACTS.md CHANGELOG.md
git commit -m "fix: serialize state loads behind saves"
```

---

## Task 5: quota emergency 裁剪保留 manual restore points

**Files:**
- Modify: `src/background/index.js:746-884, 1045-1104`
- Test: `tests/background.test.js`
- Modify: `docs/STORAGE_SCHEMA.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:

```javascript
trimHistoryForQuota(entries): HistoryEntry[]
```

- Rule: 保持原顺序；保留全部 `manual === true`；automatic 只保留最新一条。若全部 manual，不删除任何条目。

- [ ] **Step 1: 写 manual retention 的失败测试**

覆盖：

- 5 automatic + 2 manual → 1 automatic + 2 manual；
- all manual → 数组不变，仍超 quota 时返回 `storage_quota_exceeded`；
- all automatic → length 1；
- shrinking state save 即使 critical ratio 仍成功。

- [ ] **Step 2: 运行并确认红灯**

Run: `npm run test:unit -- --runTestsByPath tests/background.test.js`

Expected: FAIL；当前两条 emergency path 使用 `slice(0, 1)`。

- [ ] **Step 3: 实现并接入两个 emergency path**

```javascript
function trimHistoryForQuota(entries) {
    const history = Array.isArray(entries) ? entries : [];
    const newestAutomaticIndex = history.findIndex((entry) => !entry?.manual);
    return history.filter((entry, index) => (
        Boolean(entry?.manual) || index === newestAutomaticIndex
    ));
}
```

`trimStateStorageHistory()` 与 `appendStateHistoryNow()` 共用该函数。
“全部 manual + 最新 automatic”仍过临界时，拒绝增长写且不改 storage；现有
shrink-only escape hatch 保留。

- [ ] **Step 4: 运行、更新 policy、提交**

Run: 同 Step 2。

Expected: PASS。

```bash
git add src/background/index.js tests/background.test.js \
  docs/STORAGE_SCHEMA.md CHANGELOG.md
git commit -m "fix: preserve restore points during quota trimming"
```

---

## Task 6: developer log append 串行化并精确绑定 notebook key

**Files:**
- Modify: `src/background/index.js:502-595, 1107-1129, 1201-1226`
- Test: `tests/background.test.js`
- Test: `tests/content/content-developer-logger.test.js`
- Modify: `docs/MESSAGE_CONTRACTS.md`
- Modify: `docs/DEVELOPER_LOGGING.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces:
  - `appendDeveloperLogNow(request, sendResponse): void`
  - `clearDeveloperLogsNow(request, sendResponse): void`
  - `loadDeveloperLogsNow(request, sendResponse): void`
  - `appendDeveloperLog(request, sendResponse): void`
  - `clearDeveloperLogs(request, sendResponse): void`
  - `loadDeveloperLogs(request, sendResponse): void`
- `APPEND_DEVELOPER_LOG`、`LOAD_DEVELOPER_LOGS`、`CLEAR_DEVELOPER_LOGS` 同时要求：
  - `isValidDeveloperLogKey(key) === true`
  - `getNotebookProjectIdFromSenderUrl(sender.tab.url)` 返回非空 projectId
  - `key === getDeveloperLogKey(projectId)` 精确相等
- append/clear 使用现有 `enqueueStorageTask(request.key, task)`，同 key FIFO、不同 key
  并行；load 等待同 key pending task settle 后再调用 `loadDeveloperLogsNow`。

- [ ] **Step 1: 写跨 notebook 与并发 lost-update 失败测试**

覆盖：

- notebook 123 请求 `sourcesPlusDeveloperLogs_999` → `unauthorized_sender`，0 次 storage read/write；
- notebook 123 请求 `sourcesPlusDeveloperLogs_other_123` → reject；
- notebook 123/1234 的 exact-key collision cases 分别只接受自己的完整 key；
- sender URL 为裸 `/notebook/`、无法解析 projectId → reject；
- 两个同 key append：第二个 get 在第一个 set callback 前不得开始，最终两条均存在；
- append get 挂起时 clear 排队在后，最终 storage 为 `[]`；
- append pending 时 load 不抢读，append settle 后返回包含新 entry 的数组；
- 不同 notebook key 独立执行；
- 500 条/512 KiB 限制与 sanitized entry shape 不变。

- [ ] **Step 2: 运行并确认红灯**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/background.test.js \
  tests/content/content-developer-logger.test.js
```

Expected: FAIL；当前 append 是未排队 read-modify-write，logs route 未全部做 exact ownership。

- [ ] **Step 3: 拆 now/queued Adapter 并复用 sender guard**

把现有 append/clear/load body分别移入三个 `*Now` helper；append wrapper：

```javascript
function appendDeveloperLog(request, sendResponse) {
    enqueueStorageTask(request.key, () => new Promise((resolve) => {
        appendDeveloperLogNow(request, (response) => {
            sendResponse(response);
            resolve(response);
        });
    }));
}
```

clear 使用同一 queue；load 仿照 `loadStateHistory()` 查询该 key 的 pending task，
settle 后再读。clear 与 append 的执行顺序以收到 message 的 FIFO 顺序为准。

Task 6 在 background 先增加：

```javascript
function getDeveloperLogKey(projectId) {
    return projectId
        ? `${DEVELOPER_LOG_KEY_PREFIX}${projectId}`
        : '';
}

function senderOwnsExactDeveloperLogKey(sender, key) {
    const projectId = getNotebookProjectIdFromSenderUrl(sender?.tab?.url);
    return Boolean(projectId) && key === getDeveloperLogKey(projectId);
}
```

route 在任何 storage call 前执行 valid-prefix 与 exact ownership 两道 gate。不得复用当前
suffix-based `senderOwnsNotebookKey`，也不得在 projectId 缺失时 fail open。日志内容和
trim 算法不在此 task 改写。

- [ ] **Step 4: 运行、更新安全契约并提交**

Run: 同 Step 2。

Expected: PASS；无 lost update、无跨 notebook log access。

```bash
git add src/background/index.js tests/background.test.js \
  tests/content/content-developer-logger.test.js \
  docs/MESSAGE_CONTRACTS.md docs/DEVELOPER_LOGGING.md CHANGELOG.md
git commit -m "fix: serialize and scope developer logs"
```

---

## Task 7: 行为稳定后抽取 Storage Contract Module

**Files:**
- Create: `src/utils/storage-contract.js`
- Create: `tests/storage-contract.test.js`
- Modify: `src/background/index.js`
- Modify: `src/content/content-config.js`
- Modify: `src/content/content-persistence.js`
- Modify: `src/content/content-import-export.js`
- Modify: `src/content/content-developer-logger.js`
- Modify: `manifest.json`
- Modify: `tests/helpers/load-content-module.js`
- Modify: `tests/helpers/content-test-harness.js`
- Modify: `tests/manifest-loader-sync.test.js`
- Modify: `tests/background.test.js`
- Modify: `docs/PROJECT_DIRECTORY.md`
- Modify: `docs/STORAGE_SCHEMA.md`
- Modify: `docs/MESSAGE_CONTRACTS.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

factory/export 固定为：

```javascript
function createStorageContract() {
    return Object.freeze({
        STORAGE_SCHEMA_VERSION: 5,
        IMPORT_EXPORT_FORMAT: 'notebooklm-source-management-config',
        IMPORT_EXPORT_FORMAT_VERSION: 1,
        STATE_KEY_PREFIX: 'sourcesPlusState_',
        STATE_HISTORY_KEY_PREFIX: 'sourcesPlusHistory_',
        RECOVERY_KEY_PREFIX: 'sourcesPlusRecovery_',
        DEVELOPER_LOG_KEY_PREFIX: 'sourcesPlusDeveloperLogs_',
        getStateKey,
        getStateBackupKey,
        getStateHistoryKey,
        getStateKeyFromHistoryKey,
        getRecoveryKey,
        getDeveloperLogKey,
        isNotebookScopedKeyForProject,
        getStateSchemaCompatibility
    });
}

globalThis.NSM_CREATE_STORAGE_CONTRACT = createStorageContract;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = createStorageContract;
}
```

调用方统一：

```javascript
const storageContract = globalThis.NSM_CREATE_STORAGE_CONTRACT();
```

Node tests：

```javascript
const createStorageContract = require('../src/utils/storage-contract.js');
const storageContract = createStorageContract();
```

上述函数签名固定为：

```javascript
{
    getStateKey(projectId),
    getStateBackupKey(stateKey),
    getStateHistoryKey(stateKey),
    getStateKeyFromHistoryKey(historyKey),
    getRecoveryKey(projectId),
    getDeveloperLogKey(projectId),
    isNotebookScopedKeyForProject(key, prefix, projectId),
    getStateSchemaCompatibility(value)
}
```

`getStateSchemaCompatibility(value)` 固定返回：

- `'legacy'`：缺少 schema 或版本 1；
- `'supported'`：整数 2–5；
- `'future'`：整数大于 5；
- `'invalid'`：非整数、0、负数或不可解析。

Module 无 DOM、Chrome API、runtime state 或 logging dependency。

- [ ] **Step 1: 写 Module 失败测试**

`tests/storage-contract.test.js` 覆盖：

- 所有 key builder 精确输出；
- history→state 只接受 `sourcesPlusHistory_` 前缀；
- sender project `123` 不拥有 `..._1234`；
- schema 四种 classification；
- 返回值不包含可变全局 state；
- source-level guard 扫描 background/content，全部七个 contract 常量与八个 key/schema
  builder 只能在 `src/utils/storage-contract.js` 定义。

- [ ] **Step 2: 运行并确认红灯**

Run: `npm run test:unit -- --runTestsByPath tests/storage-contract.test.js`

Expected: FAIL，Module 尚不存在。

- [ ] **Step 3: 实现 factory 与无 bundler 加载顺序**

- `manifest.json`：`src/utils/index.js` 后、所有 content helper 前加载
  `src/utils/storage-contract.js`。
- background：`importScripts('../utils/storage-contract.js')`；Node test fallback
  `require('../utils/storage-contract.js')`。
- `tests/helpers/load-content-module.js` 同顺序 require。
- harness globals/cleanup 加 `NSM_CREATE_STORAGE_CONTRACT`。
- 扩展 `tests/manifest-loader-sync.test.js` 的 extraction：不能只过滤
  `src/content/*.js`；必须同时读取 manifest 中实际 content-script 使用的
  `src/utils/*.js` 与 loader require，并显式断言 `src/utils/storage-contract.js` 在
  `content-config`、`content-persistence`、`content-import-export`、
  `content-developer-logger` 之前。若 utils 在两侧同时漏掉，测试必须失败，不能假绿。
- content/background 各创建一次 contract object，并删去被替代的常量/key builder。
- 新 contract 的 `getStateHistoryKey(stateKey)` 接受完整 state key；现有 content
  `getStateHistoryKey(projectId)` 调用全部迁移为
  `getStateHistoryKey(getStateKey(projectId))`，不得把 projectId 直接传入。

- [ ] **Step 4: 迁移调用方并证明没有重复 contract**

Run:

```bash
if rg -n \
  -e "(const|let|var) (STORAGE_SCHEMA_VERSION|IMPORT_EXPORT_FORMAT|IMPORT_EXPORT_FORMAT_VERSION|STATE_KEY_PREFIX|STATE_HISTORY_KEY_PREFIX|RECOVERY_KEY_PREFIX|DEVELOPER_LOG_KEY_PREFIX)" \
  -e "function (getStateKey|getStateBackupKey|getStateHistoryKey|getStateKeyFromHistoryKey|getRecoveryKey|getDeveloperLogKey|isNotebookScopedKeyForProject|getStateSchemaCompatibility)" \
  -e "(const|let|var) (getStateKey|getStateBackupKey|getStateHistoryKey|getStateKeyFromHistoryKey|getRecoveryKey|getDeveloperLogKey|isNotebookScopedKeyForProject|getStateSchemaCompatibility) =" \
  src/background src/content; then
  echo "Duplicate storage contract definitions remain" >&2
  exit 1
fi
```

Expected: PASS；无 duplicate constant/builder 命中。`tests/storage-contract.test.js` 运行
同一 source guard，防止人工 gate 被跳过。

- [ ] **Step 5: 运行 focused + loader guard**

Run:

```bash
npm run test:unit -- --runTestsByPath \
  tests/storage-contract.test.js \
  tests/content/content-import-export.test.js \
  tests/content/content-persistence.test.js \
  tests/content/content-developer-logger.test.js \
  tests/background.test.js \
  tests/manifest-loader-sync.test.js
```

Expected: PASS。

- [ ] **Step 6: 更新目录/契约并提交**

`docs/PROJECT_DIRECTORY.md` 更新目录树、Runtime 加载树和 Storage 功能域“先看”列表。

```bash
git add src/utils/storage-contract.js src/background/index.js \
  src/content/content-config.js src/content/content-persistence.js \
  src/content/content-import-export.js \
  src/content/content-developer-logger.js manifest.json \
  tests/storage-contract.test.js tests/helpers/load-content-module.js \
  tests/helpers/content-test-harness.js tests/manifest-loader-sync.test.js \
  tests/background.test.js \
  docs/PROJECT_DIRECTORY.md docs/STORAGE_SCHEMA.md \
  docs/MESSAGE_CONTRACTS.md CHANGELOG.md
git commit -m "refactor: centralize storage contract"
```

---

## Full Verification Gate

- [ ] **Step 1: Full matrix**

Run:

```bash
npm run lint
npm run test:unit
npm run test:smoke
npm run package
git diff --check
STORAGE_PLAN_START_SHA=$(sed -nE \
  's/^Storage Plan Start SHA: `([0-9a-f]{40})`$/\1/p' \
  docs/superpowers/reports/2026-07-26-optimization-baseline.md | tail -n 1)
test -n "$STORAGE_PLAN_START_SHA"
git cat-file -e "${STORAGE_PLAN_START_SHA}^{commit}"
git diff --check "$STORAGE_PLAN_START_SHA"..HEAD
```

Expected: 全部 PASS；从持久 report 重新读取的 SHA 存在且指向 commit，range 验证本计划
已提交 patch，而不只检查当前 working tree。

- [ ] **Step 2: Package/security assertions**

- release zip 不包含 tests、plans、reports 或私有数据；
- manifest permissions/host permissions 与任务前相同；
- `package.json` / `package-lock.json` 无 dependency 变化；
- storage key 集合无变化；
- developer logs 不含 title、body、tag/group name、full URL 或 raw JSON。

- [ ] **Step 3: End-state acceptance**

1. future schema/import envelope 不迁移、不 apply、不覆盖；
2. import 明确 pre-commit reject 后 runtime/persisted 均为导入前；ack ambiguous 时 runtime、
   DOM enabled、tree、tags、height 回到导入前，pre-import recovery 以
   `import_ack_unknown` 保留并在 reload 提供 reconciliation；
3. primary state 正常写入全部经过 background FIFO；
4. disable/teardown 不静默丢弃 debounce 中的最后一次变更；
5. 同 notebook `LOAD_STATE` 不越过 pending `SAVE_STATE`；
6. quota emergency 不删除 manual restore point；
7. developer logs 无并发 lost update、无跨 notebook access；
8. 所有 recovery 只在 background success 后清除。

## Rollback Strategy

- Task 1–6 每项单独回滚；不要回退或删除用户 storage。
- Task 2 rollback 代码若出问题，回滚该 commit 后禁用 config import 入口，比保留非原子导入更安全。
- Task 3 pagehide 在不同 Chrome 版本可能仍无法完成异步消息；保留 recovery 是发布前置条件。
- Task 5 更早拒绝增长写是有意取舍，不得以删除 manual restore point 换取保存成功。
- Task 7 只做结构抽取；focused/full test 任一行为变化时整体回滚 Task 7，保留 Task 1–6 的行为修复。
