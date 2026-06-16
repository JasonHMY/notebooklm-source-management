# 设计：规范化「设置」面板布局

- 日期：2026-06-16
- 范围：仅内容面板的 Settings modal（`.sp-settings-modal`）布局/结构/分区顺序
- 性质：**纯 UI 规范化** —— 不改任何功能、行为、持久化 schema、消息协议；只动 DOM 结构、少量 CSS、分区拼装顺序，并新增 2 个 i18n key
- 用户已批准的范围：「彻底统一」(A+B+C+D)，开发者按钮用「带小标题的子分区」

## 1. 背景与问题

当前 Settings modal 在视觉上不统一，定位到 4 个具体问题：

1. **控件行有两套布局**
   - 「偏好设置」用 `.sp-settings-preference-row`（两列网格：左「标题+说明」、右控件），整齐。
   - 「外观自定义」「开发者功能」把开关塞进 `.sp-settings-section-header`（其内部用 `.sp-settings-action-row`，`flex` + `justify-content:flex-end` + `wrap`），导致勾选框飘到标题栏右上角，而说明文字被单独拆成卡片底部的 `<p>`，**控件与其说明对应关系断裂**。
2. **用浏览器原生 checkbox**，而非项目自带开关。违反 UI_GUIDELINES §9.2（持久开关应用 `.sp-toggle-switch`）与「避免在面板内用原生 checkbox」。
3. **分区顺序混杂**：备份(维护) → 偏好(配置) → 外观(配置) → 帮助(信息) → 开发者(高级)，没有按职责分组。
4. **开发者 5 个按钮**挤成一团（单个 wrapping `.sp-settings-action-row`），且混了两类用途：日志管理 vs 测试弹窗。

## 2. 目标 / 非目标

### 目标
- 所有设置项控件统一到唯一的 `.sp-settings-preference-row` 行模式（符合 UI_GUIDELINES §12.2）。
- 外观 2 个开关 + 开发者模式 1 个开关，从原生 checkbox 换成 `.sp-toggle-switch`。
- 分区按「配置 → 维护 → 信息 → 高级」重排。
- 开发者按钮按用途分两个带小标题的 `.sp-settings-subsection`。

### 非目标
- 不改任何开关/按钮的**功能、回调、toast、状态、存储 key**。
- 不动备份/导入导出/历史/诊断/源指纹修复/命令面板/语言 的内部实现。
- 不引入新依赖、新视觉语言、Tabs、新组件类（除一条对齐用 CSS 规则外）。

## 3. 关键事实（实现依据）

- 主入口 `renderSettingsModal(modalState)` 在 [src/content/content-modal-settings.js:372](../../../src/content/content-modal-settings.js)。
- 分区拼装顺序在 [content-modal-settings.js:538-602](../../../src/content/content-modal-settings.js)：
  `backupSection → createLanguagePreferenceSection() → appearanceSection → helpSection → (repairSection if issues) → developerSection / developerUnlockRow`。
- `createAppearanceSettingsSection()` [content-modal-settings.js:238](../../../src/content/content-modal-settings.js)：当前把两个 toggle row 作为 `.sp-settings-section-header` 的子节点，body 文案作为 section 底部的 `<p>`。
- `createDeveloperSettingsSection()` [content-modal-settings.js:199](../../../src/content/content-modal-settings.js)：toggle 在 header 内，5 个按钮在单个 `.sp-settings-action-row`。
- 偏好分区参考实现 `createLanguagePreferenceSection()` [src/content/content-modals.js:982](../../../src/content/content-modals.js)（header 只放 `<h4 class="sp-settings-section-title">`，每项一个 `.sp-settings-preference-row`）。
- 开关样式 `.sp-toggle-switch` [content-style-text.js:2885](../../../src/content/content-style-text.js)：选中态键于 `.sp-group-toggle-checkbox:checked + .sp-toggle-slider`（绿色 `--sp-accent-success`）。复用结构：
  ```
  <label class="sp-toggle-switch">
    <input type="checkbox" class="sp-group-toggle-checkbox <原类名>" ...>
    <span class="sp-toggle-slider"></span>
  </label>
  ```
- `.sp-settings-preference-row` [content-style-text.js:2255](../../../src/content/content-style-text.js)：`grid-template-columns: minmax(0,1fr) minmax(132px,auto)`。
- **安全性结论**：复用 `.sp-group-toggle-checkbox` 类不会冲突。唯一读取该类的 JS 是委托处理器 `handleInteraction`（[content-tree-interactions.js:1342](../../../src/content/content-tree-interactions.js)），它仅绑定在 `#sources-list` / viewState 容器 / 源动作菜单层（[index.js:4309-4311](../../../src/content/index.js)）。Settings modal 是 shadowRoot 的直接子节点，不在这些容器内，事件传不到该处；且该分支要求 `target.dataset.groupId` 命中 `groupsById` 才动作，设置开关无 `data-group-id`，即便误触也是 no-op。设置开关的 `change` 只由其自身 `bindAppearanceSettingsActions` / `bindDeveloperSettingsActions` 处理。
- 受影响的 marker 类（`.sp-settings-appearance-body`、`.sp-settings-drag-mode-body`、`.sp-settings-developer-body`、`.sp-settings-appearance-toggle-row`、`.sp-settings-developer-toggle-row`、`.sp-settings-developer-actions`）**均无独立 CSS 规则**（布局来自 `.sp-settings-helper-text` / `.sp-settings-action-row`），故重构无需删 CSS。

## 4. 详细设计

### A. 统一控件行
所有设置项一律使用 `.sp-settings-preference-row`（**无需新增修饰类**，开关右对齐由 §B 的结构选择器规则负责）：
```
<div class="sp-settings-preference-row">
  <div class="sp-settings-preference-copy">
    <div class="sp-settings-preference-title">{标题}</div>
    <p class="sp-settings-helper-text">{说明}</p>
  </div>
  {控件：select / button / 开关}
</div>
```
- 偏好设置：保持不变（已是该模式）。
- 外观自定义：改造 `createAppearanceSettingsSection()`——header 只留 `<h4 class="sp-settings-section-title">`；「悬浮光晕」「避让拖拽」各成一个 `.sp-settings-preference-row`，原 body 文案搬进各自 row 的 `.sp-settings-preference-copy > p.sp-settings-helper-text`。删除 section 底部两个独立 `<p>`。
- 开发者功能：改造 `createDeveloperSettingsSection()`——header 只留标题；开发者模式 toggle 成一个 `.sp-settings-preference-row`，原 `sp-settings-developer-body` 文案搬进该行说明。

### B. 开关样式统一
外观 2 个（hover spotlight、drag mode）+ 开发者模式 1 个，input 由原生 checkbox 包成 `.sp-toggle-switch` 结构（见 §3）。**input 上保留原类名**（`sp-settings-appearance-hover-spotlight-toggle` / `sp-settings-drag-mode-toggle` / `sp-settings-developer-mode-toggle`）并追加 `sp-group-toggle-checkbox`；绑定逻辑（监听 `change`）不变。
- 在 `.sp-settings-preference-row` 内放开关时右对齐，新增 CSS：
  ```
  .sp-settings-preference-row > .sp-toggle-switch {
      justify-self: end;
      margin-right: 0;   /* 抵消 .sp-toggle-switch 默认 margin-right:8px，使其贴右与 select/button 对齐 */
  }
  ```
- `aria-label` 保留在 input 上（已有）。开关旁不再需要文字标签（标题已在 `.sp-settings-preference-title`）。
- 失败回滚分支里对 `toggle.checked`/`attrs.checked` 的复位逻辑保持不变（input 仍是同一节点）。

### C. 分区重排
`renderSettingsModal` 中 `content.appendChild` 顺序改为：
1. `createLanguagePreferenceSection()`（偏好 / 配置）
2. `appearanceSection`（外观 / 配置）
3. `backupSection`（备份与恢复 / 维护，collapsible）
4. `helpSection`（帮助与反馈 / 信息，collapsible）
5. `repairSection`（源指纹修复，仅有问题时；保持其条件渲染与默认展开行为）
6. `developerSection` 或 `developerUnlockRow`（高级）

仅调整 append 顺序；`bindAppearanceSettingsActions(appearanceSection)` 仍紧跟其创建调用。`backupSection.initiallyExpanded`（依赖 importText/preview）逻辑不变。

### D. 开发者按钮分两组（带小标题子分区）
`createDeveloperSettingsSection()` 把单个 action-row 拆成两个 `.sp-settings-subsection`（复用现有子分区样式，与备份的 导出/导入/历史 一致；`.sp-settings-subsection + .sp-settings-subsection` 自带上分隔线）：
- 子分区「日志」(`ui_settings_developer_logs_title`)：复制 / 下载 / 清空 开发者日志，三按钮置于 `.sp-settings-action-row`。
- 子分区「测试工具」(`ui_settings_developer_test_tools_title`)：测试欢迎弹窗 / 测试更新介绍弹窗，两按钮置于 `.sp-settings-action-row`。

按钮类名与 `bindDeveloperSettingsActions` 的 selector 全部保留，绑定不变。

## 5. i18n 新增 key（×3 locale，键集与占位符须一致）
| key | zh_CN | en | es |
|---|---|---|---|
| `ui_settings_developer_logs_title` | 日志 | Logs | Registros |
| `ui_settings_developer_test_tools_title` | 测试工具 | Test tools | Herramientas de prueba |

（具体英/西译以实现时对照同分区既有译法的语气为准；无占位符。）

## 6. 受影响文件
- `src/content/content-modal-settings.js`：`createAppearanceSettingsSection`、`createDeveloperSettingsSection` 重构；`renderSettingsModal` append 顺序。
- `src/content/content-style-text.js`：新增 `.sp-settings-preference-row > .sp-toggle-switch` 对齐规则（无删除）。
- `_locales/{en,es,zh_CN}/messages.json`：新增 2 个 key。
- `CHANGELOG.md`：新增条目（遵循 Changelog Writing Guidelines + `**影响**` 规则）。
- `UI_GUIDELINES.md`：§12.2/§9.2 注明外观与开发者开关现统一为 `.sp-toggle-switch`、设置项统一 `.sp-settings-preference-row`（对齐文档与代码）。
- 测试：见 §7。

## 7. 测试与验证
- 既有 Settings 相关单测（`tests/content/` 下涉及 settings modal 结构/绑定的文件）：按新 DOM 结构更新断言（如查 `.sp-toggle-switch` / `.sp-settings-preference-row` 而非原生 checkbox 位置）；确保 toggle `change` 行为与 toast 断言仍通过。
- `tests/locales.test.js`：3 locale 加入新 key 后保持键集一致。
- 验证命令（AGENTS.md 验证矩阵）：`npm run lint` → `npm run test:unit` →（涉及 UI 渲染/DOM 接缝）`npm run test:smoke`，即 `npm run verify:full`。
- 手动核对：浅色/深色两种主题下开关、对齐、分区顺序、开发者解锁路径（未解锁显示 unlock 按钮）均正常。

## 8. 风险
- **跨接缝**：本次不动 `state.*` 形状，主要风险是 module-local 单测断言依赖旧 DOM；完成判据以 `verify:full`（含 smoke）为准（参见 memory `state-migration-cross-seam-gap` 的"假绿"教训，机理类似）。
- **开关绿色语义**：`.sp-toggle-switch` 选中为 success 绿（既有约定，原用于 group enable）。外观/开发者开关沿用该绿，属现有视觉约定，不新增 token。
- **解锁后插入的 developer section**：`unlockDeveloperSettings` 调用同一个 `createDeveloperSettingsSection()`，重构后自动一致，无需单独处理。

## 9. 用户可感知的变化（用户视角）
- 「外观自定义」「开发者功能」里的勾选项变成和「偏好设置」一样的整齐行：左边是名称+说明，右边是一个开关（绿色=开）。
- 这些开关从系统原生方框勾选变成了和文件夹启用开关一致的滑动开关。
- 设置面板分区顺序调整为：偏好设置 → 外观自定义 → 备份与恢复 → 帮助与反馈 →（出问题时）源指纹修复 → 开发者功能。
- 开发者功能里的按钮分成「日志」和「测试工具」两组，各有小标题。
- 所有开关、按钮点了之后的效果与原来完全一样。
