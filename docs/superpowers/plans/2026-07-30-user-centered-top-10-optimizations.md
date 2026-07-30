# User-Centered Top 10 Optimization Implementation Plan

**Goal:** 以真实用户能否进入扩展、是否会误删或误判保存、完成常见整理任务所需步骤，以及键盘/辅助技术可用性为排序标准，完成十项可验证的功能与体验改进。

**Audit inputs:** 三路独立只读审查（功能与端到端任务、数据可靠性与测试、UI 与无障碍）、当前代码与测试、以及 2026-07-30 对正式 Gemini Notebook 页面的一次只读检查。正式入口当前会跳转到 `notebook.google.com`；旧 `notebooklm.google.com` 仍作为兼容入口保留。

**Architecture:** 保持现有 MV3、无 bundler 的 content-script 加载顺序、`globalThis.NSM_CREATE_*` factory、storage schema 和稳定的 `NSM_*` 协议标识。优先扩展现有 `.sp-*` 组件与 helper，不引入依赖、权限、存储 key 或新的远程服务。

**Verification policy:**

- 每项先补或更新 focused Jest 测试，再实现最小改动。
- 修改 runtime、manifest、storage message 或自动化后，最终运行 `npm run verify:full`、`npm run package` 和 `git diff --check`。
- 新旧 Gemini Notebook 域名都必须有测试；当前正式域名是主要验收路径。
- 原生删除等高风险自动化必须 fail closed：没有唯一目标、明确用户同意或删除后的缺失证据时，不提交本地删除。
- 新文案同步 `en`、`es`、`zh_CN`，不把来源标题写入 developer logs。
- 不更改版本号或创建发布包版本；本次正常工作记录在顶部 `Unreleased`。

---

## Top 10 and delivery order

### 1. 支持当前 Gemini Notebook 域名，并让 Popup 只报告已确认的成功

**User problem:** 正式站点已使用 `https://notebook.google.com/`，扩展目前只在旧域名注入。Popup 的部分动作还会把空响应当成成功，可能关闭窗口或显示并未发生的状态变化。

**Scope:**

- `manifest.json` 同时匹配当前与旧域名。
- Background 的 sender 校验、notebook ID 提取、tab 查询、聚焦和新建页同时支持两域名，优先当前域名。
- Popup 的页面识别和 tab 查询同时支持两域名；动作只有收到 `response.success === true` 才显示成功。
- 资源 URL 信任列表增加当前域名；不扩大到其他主机。
- 更新背景、popup、manifest、source descriptor 和 smoke fixture 测试。

**Acceptance:**

- 当前域名 notebook 页面会加载全部 content scripts。
- 当前域名 sender 可读写自己的 notebook key，其他来源仍被拒绝。
- 旧域名测试保持通过。
- Popup 对 `null`、`undefined` 或缺少 `success` 的响应保持打开并显示可重试错误。

**Rollback:** 两域名常量集中定义；若旧站点不再可用，后续可单独移除旧域名而不改稳定协议或 storage key。

### 2. 原生批量删除增加明确确认，并在真实缺失后才提交本地删除

**User problem:** 目前一次误点即可启动不可 Undo 的真实来源删除；原生对话框关闭但来源仍存在时，也可能被当作成功。

**Scope:**

- 批量删除前显示扩展确认 modal，展示数量、有限标题预览和“插件 Undo 无法恢复”的说明。
- 取消不触发任何 native click、marker 或本地状态修改。
- 原生确认后重新解析 fresh source row；只有唯一 identity 在 ready panel 的完整扫描中确认不存在，才返回成功。
- 对话框关闭但行仍存在、扫描 partial、identity 模糊或超时均返回失败。

**Acceptance:**

- 单元测试证明未确认不删除、确认后才进入自动化。
- “dialog closed + row still present” 返回失败，不写删除 marker，不删除本地记录。
- 确认文案和按钮在三种语言中存在，焦点被 modal trap 管理。

**Rollback:** 确认 modal 与底层 deletion evidence 分离；可独立禁用批量入口而不影响单项来源菜单。

### 3. 将 Undo 升级为可靠、可发现的 Undo/Redo

**User problem:** 目前只有隐藏的键盘 Undo 和短时 toast 入口，没有 Redo；保存失败时操作仍可能被报告为已撤销。

**Scope:**

- history 模块维护有上限的 undo/redo stacks；新普通保存清空 redo，undo/redo 自身不互相污染。
- Undo/Redo 先保留当前 snapshot，应用目标 snapshot，并等待 critical save 结果；失败时回滚 runtime、保留历史项且不显示成功。
- 工具栏提供带 disabled 状态和 accessible name 的 Undo/Redo 图标；支持 Cmd/Ctrl+Z、Cmd/Ctrl+Shift+Z，以及 Windows 常用 Ctrl+Y。
- 全局 capture handler 只有在对应扩展 history 项真实可用时才拦截；空栈或 transaction pending 时把快捷键完整留给 Gemini Notebook。
- Command Palette 增加 Undo/Redo，现有 toast Undo 继续工作。

**Acceptance:**

- 多步 undo → redo 顺序正确；普通新改动后 redo 被清空。
- save reject/throw/stale 时 runtime 回滚，stack 不丢失，无成功 toast。
- 工具栏 disabled 状态随 history 变化；快捷键在 input/textarea/contenteditable 内不劫持输入。

**Rollback:** History stack 仍使用可序列化 snapshot，不改变持久化 schema。

### 4. 在主面板持续显示保存/恢复健康状态和就地操作

**User problem:** 保存失败目前主要依赖短暂 toast；Retry、Refresh、Restore 被藏在 Settings，用户无法持续判断刷新后是否安全。

**Scope:**

- 在 manager 主界面加入复用现有 `.sp-save-status` 的状态区。
- `saving`、`failed`、`stale`、`recovery_available` 在主界面可见；短暂 `saved` 自动收起，`idle` 隐藏。
- 失败提供 Retry；stale 提供 Retry/Refresh；recovery 提供 Restore/Dismiss。
- Settings header 和主面板由同一 render helper 同步更新，避免状态分叉。

**Acceptance:**

- 状态变化同时更新已存在的两个容器；任一容器的 Retry 都发出 critical save。
- error/stale 使用 `role=alert`，其他状态使用 polite `status`。
- 主面板状态不会遮挡 toolbar、搜索或来源列表，窄宽度可换行。

**Rollback:** 状态逻辑不变，仅增加第二个 render target；移除主容器即可回到现状。

### 5. 新建文件夹和子文件夹后立即命名

**User problem:** 创建动作会直接保存多个 “New Group”，用户还要寻找编辑按钮完成第二步。

**Scope:**

- 新建后立即进入现有 inline rename 流程并选中文本。
- 输入有本地化 accessible name、长度限制和现有样式 token。
- Enter 保存非空名称；Escape 取消新建并恢复焦点；blur 提交；空名称不落盘。
- 新建 subgroup 使用同一流程并维持正确 parent。
- rows patch 前捕获草稿，重绘后恢复 editor；任何同时发生的普通保存都从 snapshot 中剔除未确认临时 group 及 parent/root edge。
- pending group 与祖先路径在 search/tag/Quick View/isolation/collapse 下临时强制可见；确认后清除视图约束并展开必要祖先，取消则保留原视图。

**Acceptance:**

- 新建时不会先持久化占位标题。
- Enter 只保存一次；Escape 删除临时 group，不产生 undo baseline。
- 输入期间发生重绘后，草稿与 inline editor 保持可继续；未确认占位记录不会出现在 `buildPersistableState()`。
- filtered、isolated 或 collapsed-parent 场景仍能看到命名输入；确认后新文件夹与焦点目标保持可见。
- rename 结束后焦点返回新建按钮或对应 group 操作区。

**Rollback:** 临时 group 只存在 runtime；取消路径通过现有 placement invariant 删除。

### 6. “Move to folder” 中可直接创建目标文件夹

**User problem:** 没有文件夹时，Move modal 只有 “Create one first” 和 Cancel，用户必须退出、创建、再重新打开菜单。

**Scope:**

- Move modal 空状态提供 “Create folder and move”。
- 有文件夹时提供轻量 “New folder” 入口。
- 新文件夹名称在 modal 内完成，验证规则与普通 group rename 一致。
- 成功创建后立即把当前单项或 batch selection 移入目标，并只保存一次。

**Acceptance:**

- 零文件夹场景能在一个 modal 流程中完成创建和移动。
- 空名、重复提交或取消不改变树。
- 新文件夹与来源移动形成一个 undoable snapshot。

**Rollback:** 新入口调用现有 placement/move callback；原有 folder list 路径保持不变。

### 7. 批量模式增加“选择当前可见”和“清空选择”

**User problem:** 大型 notebook 必须逐个勾选；现有操作栏没有明确的总选中数或范围说明。

**Scope:**

- 操作栏持续显示已选数量。
- 增加“Select visible”与“Clear selection”；范围明确为当前搜索、Quick View、tag、isolation 和 group collapse 后仍可见且可操作的来源。
- 不暗中选择过滤掉、failed 或正在删除的来源。
- 选择变化后更新 checkbox、row state、buttons disabled state 和 live announcement。

**Acceptance:**

- focused test 覆盖无过滤、search、tag/quick view、failed/deleting source 和清空。
- 重复 Select visible 幂等；切换过滤器不会丢失已有选择，但计数保持真实。
- 操作栏在 320px 宽度仍可操作。

**Rollback:** 两个按钮只修改现有 `pendingBatchKeys`，不改变 state schema。

### 8. 区分“没有来源”和各种筛选无结果，并提供恢复 CTA

**User problem:** 空 notebook 也显示 “No sources match current filters”，既误诊也没有下一步。

**Scope:**

- 区分：真实零来源、文本搜索无结果、tag/Quick View 无结果、group isolation 无结果。
- 搜索无结果提供 Clear search；组合筛选提供 Clear filters；isolation 提供 Show all。
- 真正零来源说明应先在 Gemini Notebook 添加来源，不伪造扩展能完成的 native 操作。
- CTA 复用现有 filter reset/apply helpers。

**Acceptance:**

- 每种状态有不同 i18n 文案和正确 CTA。
- Clear action 只清理文案声明的条件，不误改来源、文件夹或标签数据；任何退出 isolation 的 CTA 都同步恢复 native effective checkbox state。
- 状态区有 `role=status`，恢复操作后焦点回到搜索或来源列表。

**Rollback:** renderer 仍返回单一 empty-state component，只是按 view context 选择配置。

### 9. 标签筛选支持搜索并暴露当前选中状态

**User problem:** 标签上限很高，但 modal 只能滚动查找；当前 tag 的选中状态主要靠视觉。

**Scope:**

- Tag filter modal 在有标签时显示 search input、结果计数和 no-match 状态。
- 匹配使用已存在的安全字符串归一化，不注入 HTML。
- 每个 tag option 使用 `aria-pressed`，active tag 有文本/视觉状态。
- 打开时优先聚焦搜索；无标签时仍聚焦 Cancel。

**Acceptance:**

- 大小写和首尾空白不影响匹配；清空搜索恢复完整顺序。
- active tag 的 `aria-pressed=true`；再次选择按现有 toggle 语义清除。
- 无匹配和无标签是不同状态，键盘焦点路径完整。

**Rollback:** 搜索只过滤 modal DOM，不持久化新状态。

### 10. 让核心树、折叠、焦点和窄面板真正可用

**User problem:** 来源/分组的视觉层级缺少程序化语义；折叠内容仍可能被 Tab 访问；重复控件没有上下文名称；长译文和窄面板可能被裁掉。

**Scope:**

- 来源容器与 group children 使用嵌套 list/listitem 语义，不冒充未完整实现键盘模型的 ARIA tree。
- checkbox、switch、caret、rename/delete/source actions 的 accessible name 包含对应来源或分组上下文。
- caret 同步 `aria-expanded`/`aria-controls`；折叠内容同步 `aria-hidden` 和 `inert`，展开前恢复。
- Tag pill 暴露 `aria-pressed`；inline rename 恢复焦点。
- group switch 增加 `:focus-visible` ring；隐藏 color input 不进入 Tab 顺序。
- toolbar/batch bar 允许在窄面板和长译文下换行；浅色 tertiary 小字改用满足 4.5:1 的现有 secondary token。

**Acceptance:**

- DOM tests 验证 list 关系、contextual names、expanded/controls、折叠后的不可聚焦状态和 tag pressed state。
- CSS tests 锁定 focus ring、可换行 toolbar、窄宽度规则和对比 token。
- 现有 mouse、drag、keyboard ordering 与 reduced-motion 测试保持通过。

**Rollback:** 只增加标准属性和现有 token 规则，不改树数据、拖拽协议或 native DOM selector。

---

## Cross-cutting documentation and release hygiene

**Files to update before completion:**

- `CHANGELOG.md`: 顶部 `Unreleased`，按用户可感知结果拆分 `Added`、`Changed`、`Fixed`。
- `docs/PROJECT_DIRECTORY.md`: 当前/旧域名、UI surface、undo/redo、save status、batch、modal、测试入口与本计划。
- `README.md`: 当前站点支持、Undo/Redo、批量选择和安全删除。
- `UI_GUIDELINES.md`: save status placement、inline rename、contextual empty state、tag filter search、折叠语义和 responsive toolbar。
- `docs/MESSAGE_CONTRACTS.md`: 两域 sender、严格 popup acknowledgement。
- `docs/SECURITY_THREAT_MODEL.md`: host surface 和 deletion evidence。

**Final verification:**

1. Focused Jest tests per task.
2. `npm run lint`
3. `npm run test:unit`
4. `npm run test:smoke`
5. `npm run package`
6. `git diff --check`
7. Check package contents and confirm version remains `26.7.27`.
8. Inspect `git diff --stat` and `git diff` for unrelated or private data.
9. Create one coherent local commit; do not push.

**Known out-of-scope follow-ups:** Incremental source-sync performance, previous-generation backup semantics, full transactional recovery/import/repair framework, and backend developer-log sanitizer remain important reliability work. They require broader storage/sync migrations and are intentionally not mixed into this user-experience batch without separate characterization and rollout controls.
