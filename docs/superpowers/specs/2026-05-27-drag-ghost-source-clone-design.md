# 拖拽 Ghost 改为 Source 行克隆 — 设计 Spec

**日期：** 2026-05-27
**状态：** 已实现 (Implemented)。本文档为当时的设计意图快照；后续动画收尾（`.sp-drag-unfolding` 平滑反向展开、fly-in / scaleY landing / flash 等）请参阅 [CHANGELOG.md](../../../CHANGELOG.md) 与 [UI_GUIDELINES.md](../../../UI_GUIDELINES.md) §13.4。

## 目标

把当前"小 pill 显示数字"的 drag ghost 改成"真实 source-item 行的视觉克隆"，让人拖动时感觉真的"抓起这一项"在拖。

## 范围

**In scope**
- 单源拖拽：ghost = 该 source-item 的 1:1 克隆 + 5% 缩小（scale 0.95）
- 多源拖拽：stack 堆叠前 3 项克隆 + 右上角数字 badge；整个 stack 缩小 5%
- 跨 Shadow DOM 边界：用 getComputedStyle 把样式 inline 化到 ghost 子树
- dragImage offset：让 ghost 在指针下"对齐"原 source-item 的相对位置

**Out of scope**
- 触摸拖拽
- 列表内容（让位 / 折叠）改动 — 上一个 feature 已落地，本次不改
- 拖拽 invalid 视觉 — 沿用 `.drag-invalid` outline

## 视觉行为

### 单源拖拽 (dragstart)

- 找到原 source-item element（`shadowRoot.querySelector('[data-source-key="<key>"]')` 或同等 lookup）
- `cloneNode(true)` 完整克隆 DOM 子树
- 遍历克隆树，对每个 element 用 `getComputedStyle(original)` 取 resolved values，写到克隆 element 的 inline style（覆盖整个 subtree）
- 克隆 root 加 `transform: scale(0.95)` + `transform-origin: center`
- 包装一层 `.sp-drag-ghost` wrapper，添加 box-shadow 强化"飘起"
- 附加到 `document.body`，定位在 `-9999px` 等浏览器 capture 后即可

### 多源拖拽 (N ≥ 2)

- 取被选中的前 3 个 source（按 selection.keys 顺序，最多 3 个克隆即可表达"一叠"）
- 3 个克隆从下到上：
  - 第 3 层（底）：`translate(8px, 8px) rotate(-2deg) scale(0.95)` opacity 0.7
  - 第 2 层：`translate(4px, 4px) rotate(-1deg) scale(0.95)` opacity 0.85
  - 第 1 层（顶 / origin）：`translate(0, 0) rotate(0) scale(0.95)` opacity 1
- 整个 stack wrapper 不额外缩放（缩放在每层）；wrapper 只负责定位
- N < 3 时少几层（N=2 → 2 层，N=1 走单源路径）
- 顶层 origin 克隆右上角叠一个 badge：圆形，主色背景，白字，显示总数 N（即使 N=2 也显示）
- Badge absolute 定位在顶层克隆的 top: -8px / right: -8px

### setDragImage offset

- offsetX = 鼠标在原 source-item 内的 X 位置（`pointerX - sourceItemRect.left`）
- offsetY = 鼠标在原 source-item 内的 Y 位置（`pointerY - sourceItemRect.top`）
- 退化：取不到 pointer 时用 (12, 12)

### dragend / drop

- 沿用现有 `destroyMultiDragGhost` 清理（不变）

## 技术设计

### `cloneSourceItem(originalEl)` helper

在新模块 `src/content/content-drag-ghost-clone.js` 或 `content-drag-multi.js` 内：

```js
function cloneSourceItem(originalEl) {
    if (!originalEl || typeof originalEl.cloneNode !== 'function') return null;
    const clone = originalEl.cloneNode(true);
    inlineStylesRecursive(clone, originalEl);
    return clone;
}

function inlineStylesRecursive(cloneNode, originalNode) {
    if (!cloneNode || !originalNode) return;
    if (cloneNode.nodeType === 1 && originalNode.nodeType === 1) {
        const computed = window.getComputedStyle(originalNode);
        let cssText = '';
        for (let i = 0; i < computed.length; i += 1) {
            const prop = computed[i];
            cssText += `${prop}: ${computed.getPropertyValue(prop)}; `;
        }
        cloneNode.style.cssText = cssText;
    }
    const origChildren = originalNode.children || [];
    const cloneChildren = cloneNode.children || [];
    for (let i = 0; i < cloneChildren.length; i += 1) {
        inlineStylesRecursive(cloneChildren[i], origChildren[i]);
    }
}
```

### `createMultiDragGhost` API 改造

签名变化：

```js
// 旧
createMultiDragGhost({ count, root })

// 新
createMultiDragGhost({ count, sourceClones, root })
// sourceClones: Element[]（已经 inline 化样式的克隆，长度 1-3）
```

实现：
- 创建 `.sp-drag-ghost` wrapper
- 单源（count=1 且 sourceClones.length=1）：直接把 clone 作为唯一 child，加 scale(0.95) 和 shadow
- 多源：构建 stack（最多 3 层 absolute 定位）+ badge with count

兼容性：如果调用方没传 `sourceClones`，fallback 到当前小 pill 行为？**不需要**——这是单一改动，全替换。

### `handleDragStart` 接入

```js
const originalSources = keys.slice(0, 3).map((k) => {
    return sourcesListEl && typeof sourcesListEl.querySelector === 'function'
        ? sourcesListEl.querySelector(`[data-source-key="${cssEscape(k)}"]`)
        : null;
}).filter(Boolean);

const sourceClones = originalSources.map(cloneSourceItem).filter(Boolean);

const ghost = dragMulti.createMultiDragGhost({
    count: keys.length,
    sourceClones,
    root: doc.body
});

// setDragImage offset based on pointer in source-item
const originalEl = sourcesListEl.querySelector(`[data-source-key="${cssEscape(originKey)}"]`);
const rect = originalEl ? originalEl.getBoundingClientRect() : null;
const offsetX = rect && e.clientX ? Math.max(0, e.clientX - rect.left) : 12;
const offsetY = rect && e.clientY ? Math.max(0, e.clientY - rect.top) : 12;
e.dataTransfer.setDragImage(ghost, offsetX, offsetY);
```

### CSS 变化

`globalOverlayStyleText`：

- 删除现有 `.sp-drag-ghost` pill 样式（padding 8px 12px / border-radius 999px / background #fff / 等）
- 新增：
```css
.sp-drag-ghost {
    position: fixed;
    top: -9999px;
    left: -9999px;
    pointer-events: none;
    user-select: none;
}
.sp-drag-ghost-stack {
    position: relative;
}
.sp-drag-ghost-stack > * {
    position: absolute;
    top: 0;
    left: 0;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
}
.sp-drag-ghost-stack > *:nth-child(1) {
    z-index: 3;
    transform: scale(0.95);
}
.sp-drag-ghost-stack > *:nth-child(2) {
    z-index: 2;
    transform: translate(4px, 4px) rotate(-1deg) scale(0.95);
    opacity: 0.85;
}
.sp-drag-ghost-stack > *:nth-child(3) {
    z-index: 1;
    transform: translate(8px, 8px) rotate(-2deg) scale(0.95);
    opacity: 0.7;
}
.sp-drag-ghost-single {
    transform: scale(0.95);
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
}
.sp-drag-ghost-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    min-width: 22px;
    height: 22px;
    border-radius: 11px;
    background: var(--sp-accent, #007AFF);
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    line-height: 22px;
    text-align: center;
    padding: 0 6px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    z-index: 10;
}
```
- 删除 `.sp-drag-ghost-count` 规则（不再有 count span）

## 文件改动

| 文件 | 类型 | 备注 |
|---|---|---|
| `src/content/content-drag-multi.js` | Modify | `cloneSourceItem` + `inlineStylesRecursive` helpers；`createMultiDragGhost` 改造为接收 `sourceClones[]` + 输出 stack/single + badge |
| `src/content/content-tree-interactions.js` | Modify | `handleDragStart` 找原 source-item DOM → cloneNode → 传 ghost factory；setDragImage offset 基于 pointer |
| `src/content/content-style-text.js` | Modify | 删除现有 `.sp-drag-ghost` pill 样式 / `.sp-drag-ghost-count`；新增 stack / single / badge / shadow |
| `tests/content/content-drag-multi.test.js` | Modify | 更新 ghost 测试断言（不再 hash count span，改为 sourceClones + 结构） |
| `tests/content/content-tree.test.js` | Modify | dragstart ghost 测试断言更新 + setDragImage offset |
| `CHANGELOG.md` | Modify | Changed 一条 |
| `UI_GUIDELINES.md` | Modify | §13.4 ghost 描述更新 |

## 测试矩阵

**单测**（content-drag-multi.test.js）
- `inlineStylesRecursive`：对一个 mock element + children 应用 computed style → inline style 写入
- `cloneSourceItem`：null safe；克隆 + 样式 inline 完成
- `createMultiDragGhost` 单源：单 clone，wrapper.children.length=1
- `createMultiDragGhost` 多源：3 层 stack（N ≥ 3）+ badge 显示 N
- `createMultiDragGhost` 多源 N=2：2 层 stack + badge "2"

**集成**（content-tree.test.js）
- dragstart 单源：调用 cloneSourceItem 1 次 + ghost wrapper 包含 1 个克隆
- dragstart 多源 N=3：调用 cloneSourceItem 3 次 + stack
- setDragImage offset 用 pointer 相对位置
- 缺 sourcesListEl 时退化到 (12, 12) 不崩

## 风险 / 取舍

1. **`getComputedStyle` 性能**：单 source-item subtree ~10-20 element，每个 ~300 properties → 5-20ms。dragstart 一次性，可接受。
2. **NotebookLM 字体**：source-item 用系统字体栈，inline 化无 fallback 问题。如果有 Google Symbols icon，`@font-face` 已经在 globalOverlayStyleText（之前 multi-source 设置）保留。
3. **Source-item DOM 引用 image (favicon)**：cloneNode 保留 src，浏览器 capture dragImage 时图片可能尚未 load → 退化为 alt text 或空。可接受（现有列表 favicon 已经 cached，dragstart 时通常已 load 完）。
4. **`.sp-drag-folded` 与 ghost 视觉**：dragstart 同步：先 clone + ghost setup（基于"未折叠"原状）→ setDragImage capture → fold 通过 RAF 延后一帧执行。ghost 内容是"正常"快照，无折叠样式干扰。✓
5. **NotebookLM 暗色模式**：getComputedStyle 取的是 resolved 值（包含当前 prefers-color-scheme），ghost 显示与当前主题一致。✓
6. **拖拽 cursor 偏移异常**：如果 source-item 极宽 / 鼠标在边缘，setDragImage offset 计算可能 > rect 宽。clamp 到 [0, rect.width] 范围。

## 实施分期

**Task 1 — helpers + 单测**
- 新增 `inlineStylesRecursive` + `cloneSourceItem` helpers in `content-drag-multi.js`
- 单测覆盖 helpers

**Task 2 — `createMultiDragGhost` 改造 + CSS**
- 接收 `sourceClones[]`，构造 stack 或 single + badge
- 更新 `globalOverlayStyleText` CSS（删 pill / 加 stack / single / badge / shadow）
- 更新对应单测

**Task 3 — `handleDragStart` 接入 + setDragImage offset + 收尾**
- 在 handleDragStart 找原 source-item DOM → cloneSourceItem → 传 ghost factory
- setDragImage offset 基于 pointer-in-source-item 偏移
- 更新 dragstart 测试
- CHANGELOG / UI_GUIDELINES 更新
- 全套 verify

## 不变项

- 让位 / 折叠 / 反向展开 / 蓝条删除（已落地）
- hover-expand / auto-scroll / batch mode
- drop / dragend cleanup
- invalid drop outline
