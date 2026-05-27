# Appearance Customization Design

## Summary

在设置 modal 内新增「外观自定义」分区，首期承载一个用户可控的开关：**鼠标悬浮在来源行/分组头时的蓝色光晕（spotlight）**。

分区命名空间式设计 — 偏好键嵌套在 `appearance.*` 下，未来可以无迁移地加入更多外观开关（关闭悬浮过渡、关闭分组阴影等）。当前版本只交付 `appearance.hoverSpotlightEnabled` 一项。

## Goals

- 给用户一个一目了然的方式关闭或开启来源行的蓝色 spotlight 光晕。
- 关闭时：spotlight ::before 伪元素不绘制、不参与过渡、不占 GPU layer。
- 开关默认开启 — 保持当前已发布的视觉行为。
- 偏好持久化为 global（与现有偏好一致，不分 notebook）。
- 设计为可扩展的"外观自定义"容器，未来加项零迁移成本。

## Non-Goals

- 不重做 spotlight 的视觉效果（颜色、半径、过渡参数都不变）。
- 不为每个 spotlight 子样式（颜色、强度、范围）暴露子开关 — 只暴露总开关。
- 不持久化 per-notebook 的外观偏好。
- 不暴露任何与 spotlight 无关的外观开关（动画、阴影、字体等）— 留给未来变更，本次只搭框架。
- 不为本次改动加 Playwright smoke 测试（CSS gate 是声明性的，单元 + locale 测试已足够覆盖回归面）。

## Architecture

```text
┌─────────────────────────────────────────────────────┐
│ chrome.storage.local                                │
│   PREFERENCES_KEY = {                               │
│     ... existing flat preferences ...               │
│     appearance: { hoverSpotlightEnabled: boolean }  │
│   }                                                 │
└─────────────────────────────────────────────────────┘
              │ (background SW: getPreferences / setPreferences)
              ▼
┌─────────────────────────────────────────────────────┐
│ content/index.js                                    │
│   applyLoadedPreferences()                          │
│     → appearancePreferences = { hoverSpotlightEnabled } │
│     → applyAppearancePreferencesToHost()            │
│                                                     │
│   applyAppearancePreferencesToHost()                │
│     if !hoverSpotlightEnabled                       │
│       extensionRoot.classList.add('sp-appearance-no-spotlight') │
│     else                                            │
│       extensionRoot.classList.remove(...)           │
└─────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────┐
│ content-style-text.js                               │
│   :host(.sp-appearance-no-spotlight)                │
│     .source-item.sp-spotlight-surface::before,      │
│   :host(.sp-appearance-no-spotlight)                │
│     .group-header.sp-spotlight-surface::before {    │
│       display: none;                                │
│     }                                               │
└─────────────────────────────────────────────────────┘
              ▲
              │ user toggles in settings modal
              │
┌─────────────────────────────────────────────────────┐
│ content-modal-settings.js                           │
│   createAppearanceSettingsSection()                 │
│     → collapsible section                           │
│     → toggle row → setHoverSpotlightEnabled(bool)   │
│     → setHoverSpotlightEnabled writes preference,   │
│       then re-applies host class (no re-render)     │
└─────────────────────────────────────────────────────┘
```

## Storage Schema

`chrome.storage.local` 的 `PREFERENCES_KEY` 对象新增字段：

```json
{
  "appearance": {
    "hoverSpotlightEnabled": true
  }
}
```

- 默认 `true`（保持当前行为）。
- 归一化规则（在 `normalizeAppearancePreferences()` 中实现）：
  - `appearance` 字段缺失 / `null` / 非对象 → `{ hoverSpotlightEnabled: true }`
  - `hoverSpotlightEnabled === false`（严格 boolean false）→ `false`
  - 其他任何值（含 `undefined` / `true` / `0` / `''` / 非空字符串 / 对象 / `null`）→ `true`
  - 规则简记：**只有显式 `false` 才关闭**，缺省 + 容错均回到默认 `true`，保守地保留视觉特性。
- 与 `developerModeEnabled = Boolean(value)`（默认 `false`）的规则形式相反，但语义一致 — 都是 *单向容错回退到默认值*，方向取决于哪个值是默认。
- 该字段进入 `normalizePreferences()` 的输出对象，与现有字段一同被读写。
- `docs/STORAGE_SCHEMA.md` 同步更新偏好结构示例。

## Message Contracts

复用现有 `setPreferences` / `getPreferences` 消息 — 不新增 message 名。

`setPreferences` request payload `preferences` 可以包含部分字段；background 用 `mergePreferences` 合并到现有偏好上。因此 content 侧调用：

```js
chrome.runtime.sendMessage({
  type: 'setPreferences',
  preferences: { appearance: { hoverSpotlightEnabled: false } }
});
```

`mergePreferences` 当前是 shallow merge — 需要在 background 内对 `appearance` 子对象做深合并（详见 Implementation Notes）。`docs/MESSAGE_CONTRACTS.md` 同步说明该 payload 字段。

## UI

### Settings Modal Section

- 标题：`ui_settings_appearance_title` → 外观自定义
- 结构：使用现有 `createCollapsibleSettingsSection()` 容器
- `className`: `sp-settings-appearance-section`
- `contentId`: `sp-settings-appearance-content`
- `initiallyExpanded`: `false`
- 插入位置：language preference section 之后、help section 之前
- 当前只渲染一项：hover spotlight 开关行

### Toggle Row

复用 `.sp-settings-developer-toggle-row` 的视觉模式（label + checkbox + helper text）：

- `<input type="checkbox" class="sp-settings-appearance-hover-spotlight-toggle">` checked = `getHoverSpotlightEnabled()`
- helper text：`ui_settings_appearance_hover_spotlight_body`
- toggle 变更 → `setHoverSpotlightEnabled(bool)`：
  - 成功 → toast `ui_settings_appearance_hover_spotlight_enabled` / `_disabled`（variant: success）
  - 失败 → toast `ui_settings_appearance_hover_spotlight_failed`（variant: error），同时回滚 checkbox

### CSS Gate

在 `content-style-text.js` 现有 spotlight 规则块（line 901-986 区域）末尾新增：

```css
:host(.sp-appearance-no-spotlight) .source-item.sp-spotlight-surface::before,
:host(.sp-appearance-no-spotlight) .group-header.sp-spotlight-surface::before {
    display: none;
}
```

`display: none` 让伪元素彻底退出渲染管线 — 跳过 opacity 过渡、跳过 GPU layer 合成。

Pseudo-hover 和 spotlight-active 这两条状态切换规则（line 975-986）也都建立在 `::before` 上，被 `display: none` 自然兜底，无需额外 gate。

### 不动 content-render.js

`source-item` / `group-header` 仍然附带 `sp-spotlight-surface` 类。这样即使用户切换偏好也不需要重新 render — host 类一变，CSS 立刻生效。

## i18n

三个 locale (`en`, `es`, `zh_CN`) 同步新增以下 key：

| Key | en | es | zh_CN |
|---|---|---|---|
| `ui_settings_appearance_title` | Appearance | Apariencia | 外观自定义 |
| `ui_settings_appearance_hover_spotlight_title` | Hover spotlight | Resaltado al pasar el cursor | 悬浮光晕 |
| `ui_settings_appearance_hover_spotlight_body` | Show a soft blue glow under the source when your cursor hovers over it. | Muestra un suave resplandor azul debajo de la fuente cuando pasas el cursor sobre ella. | 鼠标悬浮在来源上时显示柔和的蓝色光晕。 |
| `ui_settings_appearance_hover_spotlight_enabled` | Hover spotlight enabled | Resaltado al pasar el cursor activado | 已开启悬浮光晕 |
| `ui_settings_appearance_hover_spotlight_disabled` | Hover spotlight disabled | Resaltado al pasar el cursor desactivado | 已关闭悬浮光晕 |
| `ui_settings_appearance_hover_spotlight_failed` | Could not update hover spotlight | No se pudo actualizar el resaltado | 无法更新悬浮光晕设置 |

文案以信息性为主，无营销语言（遵守 CHANGELOG Writing Guidelines 同源风格）。`tests/locales.test.js` 会自动验证三 locale key 集合一致。

## Runtime Flow

### Startup

1. content script 启动 → 请求 `getPreferences`
2. background 返回 `normalizePreferences(stored)` — 已经填好 `appearance.hoverSpotlightEnabled` 默认值
3. content `applyLoadedPreferences` 写入 runtime 字段 `appearancePreferences`
4. content `applyAppearancePreferencesToHost()` 根据偏好给 `extensionRoot` 添加/移除 `sp-appearance-no-spotlight` 类
5. 首次 render 时 spotlight CSS 已经按偏好 gate

### Toggle Change

1. 用户在设置 modal 切换 checkbox
2. content `setHoverSpotlightEnabled(bool)`：
   - 乐观更新 runtime `appearancePreferences.hoverSpotlightEnabled`
   - 立刻调用 `applyAppearancePreferencesToHost()`（视觉立即响应）
   - 异步 `chrome.runtime.sendMessage({ type: 'setPreferences', preferences: { appearance: { hoverSpotlightEnabled: bool } } })`
   - 失败 → 回滚 runtime 状态、回滚 host 类、回滚 checkbox、显示 error toast
   - 成功 → 显示 success toast

### Subsequent Sessions / Other Tabs

无 broadcast 需求（与 popup toggle 不同 — 视觉偏好只影响 manager UI，不影响其他扩展行为）。其他 NotebookLM 标签页下次 content script 启动时通过 `getPreferences` 读到新值。

## Implementation Notes

### `mergePreferences` 深合并

`src/background/index.js` 的 `mergePreferences` 当前是 shallow merge。如果 content 只发 `{ appearance: { hoverSpotlightEnabled: false } }`，shallow merge 会用这个 partial 对象**覆盖**整个 `appearance` — 没问题（当前只有一个子键），但未来加第二个 appearance 子键时会丢字段。

**解决方案**：在 `mergePreferences` 内对 `appearance` key 单独做一层 `Object.assign({}, prev.appearance, next.appearance)`，写为通用 helper `mergeAppearancePreferences(prev, next)`。

这是 forward-compatibility 的关键 — 留给未来的我们一条干净的扩展路径。

### Host class 应用时机

- 偏好首次加载后
- 偏好变更 setter 调用时
- manager 重建（notebook 切换）时 — `applyLoadedPreferences` 会被重新调用，自然覆盖；但 host element 是新建的，需要在 manager 挂载逻辑中**首次** apply 一次。

定位：`src/content/index.js` 中创建 `extensionRoot` 的位置（line 4080 附近），在 attach shadow root 后立即 call `applyAppearancePreferencesToHost()`。

### content-modal-settings dep injection

新增四个 dep：
- `getHoverSpotlightEnabled: () => boolean`
- `setHoverSpotlightEnabled: (enabled: boolean) => Promise<boolean>`

`createContentModalSettings` 的 dep 默认值都按现有 noop 模式声明（`() => false` / `() => Promise.resolve(false)`）。`src/content/index.js` 的 factory 装配处传入实际 getter/setter。

### Section 渲染条件

无条件渲染 — 不像 developer section 需要密码解锁。`createAppearanceSettingsSection()` 直接 append 到 modal content 之后即调用 `bindAppearanceSettingsActions()`。

## Testing

### Unit Tests

- `tests/content/content-modal-settings.test.js`
  - 渲染：调用 `renderSettingsModal` 时 DOM 含 `.sp-settings-appearance-section` 和 hover spotlight toggle
  - 切换：toggle change → 调用 `setHoverSpotlightEnabled` 一次，参数与 checked 一致
  - 失败回滚：`setHoverSpotlightEnabled` reject → checkbox 复原、显示 error toast
  - 初始 checked：`getHoverSpotlightEnabled()` 返回 false 时，渲染后 toggle 应为 unchecked

- `tests/background.test.js`
  - `normalizePreferences({})` → `appearance.hoverSpotlightEnabled === true`
  - `normalizePreferences({ appearance: { hoverSpotlightEnabled: false } })` → 透传
  - `normalizePreferences({ appearance: null })` → 默认 `{ hoverSpotlightEnabled: true }`
  - `normalizePreferences({ appearance: { hoverSpotlightEnabled: 'no' } })` → `true`（只有严格 `false` 才关闭，其余值回退到默认）
  - `normalizePreferences({ appearance: { hoverSpotlightEnabled: false } })` → `false`
  - `mergePreferences` 在面对 partial `appearance` 时正确 deep-merge

- `tests/locales.test.js`
  - 自动覆盖三 locale key 一致性 — 不需要额外断言

### 不需要测什么

- spotlight CSS 视觉表现 — 声明式 `display: none`，不需要 smoke。
- host class 切换 — host element 加/移类是 1 行代码，单元测纯函数 `applyAppearancePreferencesToHost` 即可。

## Files To Touch

按 update-checklist 顺序：

1. `manifest.json` — 不动（不加 content 模块）
2. `_locales/en/messages.json` — 6 个新 key
3. `_locales/es/messages.json` — 6 个新 key
4. `_locales/zh_CN/messages.json` — 6 个新 key
5. `src/background/index.js` — `normalizePreferences` + `mergePreferences` + `normalizeAppearancePreferences`
6. `src/content/content-modal-settings.js` — `createAppearanceSettingsSection` + `bindAppearanceSettingsActions` + 装入 modal
7. `src/content/index.js` — `appearancePreferences` runtime 字段 + `applyAppearancePreferencesToHost` + 在 host 创建处 apply + 偏好 setter
8. `src/content/content-style-text.js` — 新增 `:host(.sp-appearance-no-spotlight)` 规则
9. `tests/content/content-modal-settings.test.js` — 新 describe 块
10. `tests/background.test.js` — `normalizePreferences` + `mergePreferences` 断言扩展
11. `docs/STORAGE_SCHEMA.md` — 偏好结构示例同步
12. `docs/MESSAGE_CONTRACTS.md` — `setPreferences` payload 示例同步
13. `docs/PROJECT_DIRECTORY.md` — §3 功能域树补一行"外观偏好"指向 content-modal-settings + index.js
14. `CHANGELOG.md` — Unreleased 段加 `**外观自定义 (Appearance Customization)**: 设置中新增外观自定义分区，可关闭来源悬浮蓝色光晕`
15. `UI_GUIDELINES.md` — 如果未来加更多外观项需要在这里记录命名约定；本次只需提一句"`appearance.*` 偏好命名空间用于纯视觉开关"

## Verification Matrix

- `npm run lint` — 0 errors / 0 warnings 保持
- `npm run test:unit` — 所有单元（含新加断言）通过
- 手测：
  - 打开设置 → 看到「外观自定义」collapsible section
  - 默认展开后看到 toggle，默认 on
  - 关闭 toggle → 立刻看到 source-item / group-header 悬浮时不再有蓝光
  - 切换 notebook → 偏好持久（关掉的还是关掉）
  - 重新打开浏览器 → 偏好持久
  - 多语言：切到 en / es → 文案正确

## Open Questions

无 — 设计已收敛。
