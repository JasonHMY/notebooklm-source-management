# 双拖拽模式(经典蓝线 / 避让 Beta)设计文档

**日期**: 2026-06-14
**状态**: 已与用户确认设计,待写实现计划
**版本归属**: 折叠进 **26.6.14**(已 push GitHub,尚未上 Chrome 商店)—— 见 §9

## 目标

让用户在两套拖拽体验之间自选,**默认经典**、新拖拽降级为可选 Beta:

- **经典(`classic`,默认)** = 26.5.26 的体验:拖动时目标行上/下出现**蓝色横线**指示落点,其它来源不动;散源只能进文件夹或底部「未分组」桶,**不能插到文件夹之间**。
- **避让(`reflow`,Beta)** = 现 26.6.14 的体验:拖动时兄弟项 `translateY` **避让让位**开槽 + 拖入文件夹蓝竖条;散源可定位到根层级任意位置(含文件夹之间)。

用户更新后默认经典;在「设置 → 外观自定义」有长期开关;在 What's-New 弹窗里有"一键启用 Beta"按钮。

## 架构决策(已确认)

**单引擎 + 模式开关**(不做两套并行引擎)。理由:经典模式也必须跑在 v5 `state.root` 数据上(无法按用户回退持久化结构),26.5.26 旧代码无论如何都要为 v5 重写,"两套并行"只是把同一份 v5 落点逻辑写两遍、徒增重复与 drift。单引擎在 `computeDropIntent` 与拖拽反馈处加 `dragMode` 分支,给出与 26.5.26 完全一致的手感。

**关键事实**:26.6.14(带根层级定位)从未上商店,所以现有用户 `state.root` 目前只有文件夹、无"已定位散源";定位散源仅在用户开 Beta 后才产生。

## 偏好模型(已核实)

新增**顶层标量偏好** `dragMode`(枚举 `'classic' | 'reflow'`,默认 `'classic'`),与 `languageOverride` 同构(非嵌套、有枚举校验、非法值回退默认)。整条链照搬 `languageOverride` / `appearance.hoverSpotlightEnabled`:

1. `src/utils/preference-normalizers.js`:新增 `normalizeDragMode(value)` → 非 `'reflow'` 一律回退 `'classic'`;加进导出对象(bg + content 共享)。
2. `src/background/index.js`:
   - `normalizePreferences`:补 `dragMode` 默认项。
   - `mergePreferences`:加一个 `hasOwnProperty('dragMode')` 合并块(照 `languageOverride` 块)。
3. `src/content/content-developer-logger.js`:新增 `getDragMode()` / `setDragMode(mode)`,镜像 `getHoverSpotlightEnabled` / `setHoverSpotlightEnabled`(setter 经 `SAVE_PREFERENCES` 落 background)。
4. `src/content/index.js`:把 `getDragMode` / `setDragMode` 注入拖拽与弹窗模块(见下)。

> **简化**:拖拽反馈完全 JS 驱动(处理器按 `dragMode` 决定加哪些 class),**不需要 host class、不需要 applyDragModePreferenceToHost**。拖拽处理器通过注入的 `getDragMode()` 实时读偏好。

## 经典 vs 避让的真正差异(仅三点)

| 维度 | classic | reflow(Beta) |
|---|---|---|
| 拖拽反馈 | 目标行 `.drag-over-top/.drag-over-bottom` 蓝横线 + 圆点伪元素 + 文件夹头 `.drag-into` 高亮;**不折叠、不避让** | 兄弟项 `translateY` 避让 + 拖入文件夹蓝竖条 `.sp-drag-guide`;`.drag-into` 高亮 |
| 散源落到根层级 | **降级为落到底部 ungrouped 桶**(不产生定位散源)= v4 行为 | 定位到 `state.root` |
| 落地动画 | 无,直接 render | FLIP + 淡入 |

**其余完全共用**(v4 本就有):文件夹内部排序、拖进文件夹嵌套、文件夹之间互相排序、多选拖拽、自动滚动、悬停展开。

## 实现要点(单引擎分支)

涉及文件与改动(行号以实现时为准核对):

### A. 落点闸门(DRY,一处)
`src/content/content-tree-interactions.js` 的 `computeDropIntent`:计算出 intent 后,若 `getDragMode() === 'classic'` 且该 intent 会产生"根层级定位散源"(source 落入 `state.root` 的某根位置,即 `isRootList && 非 into-group && 拖的是 source`),则**改写为落到底部 ungrouped 桶**的 intent(`targetList = state.ungrouped`、追加到末尾)。其它 intent(into-group、组内 before/after-source、文件夹之间 before/after-group、group 拖拽)不变。
- 单源走 `handleDrop` 用此 intent;多源 `content-drag-multi.js` 的 `applyMultiSourceDrop` 也用同一份 intent,**故一处闸门覆盖单/多源**(实现时验证多源确实复用 intent)。

### B. 反馈分支
`src/content/content-tree-interactions.js`:
- `_processDragOver`:`classic` → 清旧 classic class,按 intent 给目标行加 `.drag-over-top`/`.drag-over-bottom`(before/after)或文件夹 `.drag-into`;**跳过** `computeReflow`/`applyReflow` 与 `.sp-drag-guide`。`reflow` → 现状不变。
- `handleDragStart`:`classic` → 仅加 `.dragging`,**跳过 fold**(`foldDraggedItems`)。
- `handleDrop`:`classic` → 跳过 FLIP/落地动画,直接 splice + render。
- `handleDragEnd` / `clearDragFeedback`:补清 classic class(`.drag-over-top/.drag-over-bottom`)。
- 多选 ghost、自动滚动、悬停展开两模式都保留(用户关心的差异是"蓝线 vs 避让",不含 ghost)。

### C. 恢复经典 CSS
`src/content/content-style-text.js`:从 `e6e74d3`(26.5.26)搬回 `.drag-over-top` / `.drag-over-bottom`(含 `::before`/`::after` 圆点、box-shadow)与必要的 `.drag-invalid` 配合规则;补 reduced-motion 降级(去阴影/动画即可)。标注"经典模式拖拽反馈"。

### D. 切回经典扫桶(幂等归一化)
新增小helper(置于 `content-tree-interactions.js` 或就近 state 工具):把 `state.root` 中所有 `{type:'source'}` 条目移到 `state.ungrouped` 末尾(保持相对顺序),`state.root` 只剩 `{type:'group'}`。调用点:
- `setDragMode('classic')` 成功后(content/index.js setter 包装里)→ 归一化 + render + save。
- 载入完成后若当前为 `classic` → 跑一次(幂等;无定位散源时 no-op)。

## 设置面板

`src/content/content-modal-settings.js`:在现有「外观自定义」分区追加一个开关行(复用 spotlight 开关的 `create*Section` + `bind*Actions` + 测试模式):

- 控件:**单个复选框** `☐ 启用避让拖拽(Beta)`(默认关 = 经典)。
- 说明文字一行:简述两种模式区别 + Beta 提示。
- change → `setDragMode(checked ? 'reflow' : 'classic')` → 成功 toast / 失败回滚 + 错误 toast。
- 切到 classic 时触发 §D 扫桶(由 setter 包装统一处理,UI 只调 setter)。

## What's-New 弹窗

`src/content/content-modal-whats-new.js`:
- 头号 feature row(拖拽那条)标题加 **Beta** 标记;正文改写为"这是可选 Beta,默认仍是经典拖拽"。
- **在该 row 后面**渲染一个按钮 `启用避让拖拽(Beta)`:点击 → `setDragMode('reflow')` → toast「已切换到避让拖拽」+ `markSeenOnce()` + 关弹窗。
- 打开时若已是 `reflow`:按钮渲染为禁用「已启用」态,避免重复。
- 底部「知道了」= 关闭并保持经典(默认)。
- 依赖注入:`content-modals.js` 给 `createContentModalWhatsNew` 注入 `setDragMode` + `getDragMode` + `showToast`;`createContentModalWhatsNew` deps 解构补默认 no-op。

## 已解决的子决策

1. 设置控件 = **单个复选框**(默认关)。
2. What's-New 按钮 = **启用 + 关弹窗**(带 toast)。
3. 发布 = **折叠进 26.6.14**(见 §9)。
4. 切回经典 = **扫定位散源回底部桶**(彻底像 26.5.26;切回 Beta 不自动恢复位置)。

## 测试策略(TDD)

- 单测(`tests/content/content-developer-logger.test.js` 或 `tests/background.test.js`):`normalizeDragMode` 校验/回退;`mergePreferences` 对 `dragMode` 的合并。
- 单测(`tests/content/content-tree.test.js`):classic 落点闸门(根层级 source → 桶;into-group / 组内 reorder / group reorder 不受影响);§D 扫桶(定位散源→ungrouped、幂等)。
- 单测(`content-modal-settings.test.js`):开关初值/切换调 setter/失败回滚。
- 单测(`content-modal-whats-new.test.js`):按钮调 `setDragMode('reflow')` + 已启用禁用态;现有断言(键名/icon/结构)保持。
- 单测(`tests/locales.test.js`):新 i18n 键三语齐全。
- smoke:经典模式端到端——拖源显示蓝横线、散源落底部桶、无避让动画;Beta 模式现有 smoke 不回归。
- 收尾 `npm run verify:full`(lint 0/0 + unit + smoke)。

## 同步更新清单(按 update-checklist)

- `_locales/{en,es,zh_CN}/messages.json`:新增设置开关 5 键 + What's-New 按钮/Beta 标记/已启用 等键;并调整拖拽 feature row 文案(标 Beta)。三语键集一致。
- `docs/STORAGE_SCHEMA.md`:preferences 加 `dragMode` 字段。
- `docs/MESSAGE_CONTRACTS.md`:`SAVE_PREFERENCES` 提一句支持 `dragMode`。
- `UI_GUIDELINES.md`:记经典拖拽反馈 `.drag-over-*`(恢复)+ 设置新开关 + Beta 拖拽模式。
- `docs/PROJECT_DIRECTORY.md`:若功能域树需要,补"拖拽模式"说明(**无新模块**,故无 manifest/loader/harness 同步)。
- `CHANGELOG.md`:26.6.14 段补 Added/Changed 条目(双拖拽模式 + 默认经典)。
- `README.md`:可选,"What It Does" 提一句可切换拖拽模式。

## 9. 发布打法(折叠进 26.6.14)

26.6.14 已 push GitHub 但未上商店。本功能让"经典成为默认",应在**商店首发前**并入,避免先发"新拖拽默认"再翻"经典默认"。落地后:更新 26.6.14 的 CHANGELOG 段、重跑 verify:full、重新 `npm run package`、再由用户上传商店。版本号维持 26.6.14(若用户后续偏好独立版本号再议)。

## 非目标(YAGNI)

- 不做两套并行引擎 / 不新增拖拽模块。
- 不为经典模式恢复 26.5.26 的多选 ghost 细节(差异只在"蓝线 vs 避让")。
- 不做 per-notebook 拖拽模式(全局偏好)。
- 不引入 host class / 新依赖 / TS / bundler。
