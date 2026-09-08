# 避让拖拽转正审查（2026-09-08）

## 当前结论

当前仍保留 **Beta**。常规真实鼠标拖放与 100/500 来源拖拽性能验证通过，但大数据量验收尚未全部通过，不能据此宣称已满足转正条件。`classic` 默认值、用户已保存的 `reflow` 偏好及 storage schema 均保持不变。

本次按用户要求评估是否可以去掉 Beta；先修复审查中有明确复现、可以独立验证的小范围缺陷。窗口化几何变更需要专门验收，不能以改标签替代。

## 代码审查与修复

### 拖放身份校验：已修复

此前 multi-source drop 比对完整拖动集合，但 single-source/group drop 直接接受 `DataTransfer` 的对象身份。已用回归复现：当前拖动 A，落下的 payload 是 B，会实际移动 B 并保存。

现在在读取树状态或几何前要求 payload 与当前本地 `activeDragContext` 的类型、身份和顺序完全匹配；不存在本地会话、跨类型、混合类型、不同来源/分组的 payload 均拒绝，并走原有清理路径。合法 single、group、multi 的落点行为不变。

证据：[交互实现](../src/content/content-tree-interactions.js)、[287 项 tree 单元测试](../tests/content/content-tree.test.js)。新增拒绝回归先出现 5 项失败，修复后全部通过。

### 取消后快速重拖：已修复

旧拖动取消后会在 240ms 后恢复元素；此时若同一元素已开始新拖动，旧回调仍会清掉新会话的折叠 class、高度和透明度。新增 A 取消 → B 立即重拖 → A 旧回调执行的回归，修复前失败。

现在为每个元素保存恢复令牌，新拖动在测量前同步结清旧动画并恢复原始样式，新折叠或立即恢复也会使旧令牌失效。另有参数化回归覆盖空值/自定义 inline 的 A 取消 → B prepare → A 旧 timer → B 下一帧 fold/unfold，防止旧动画高度成为新会话基线。[Reflow helper](../src/content/content-drag-reflow.js) 的 [44 项单元测试](../tests/content/content-drag-reflow.test.js) 全部通过。

### 窗口化拖动：已复现，尚未修复

独立临时 Chromium fixture 从首次加载即包含 260 个来源。启用 Reflow、多选第 2 与第 178 个来源，回到首个来源启动拖动，再滚动到远端窗口。此探针用浏览器 DOM 和生产 handler，但 dragstart/scroll 是脚本触发，不能称为真实鼠标自动滚动验收。

- 滚动前：拖放 payload 有 2 个 key；起点已折叠；远端未挂载；当前挂载的选中项=1。
- 滚动后：payload 仍是相同的 2 个 key；远端已挂载且选中，但 `sp-drag-folded=false`，高度约 31.52px；当前挂载选中项=2，已折叠项=0。
- 截图前重新读取当前 DOM：远端来源 top=251.55、bottom=283.07，完整处在列表视口 195..473 内；可见的选中来源正常显示，而它仍在正在拖动的 payload 中。这证明活动拖动经过窗口重渲染后丢失折叠状态，不能把它解释成只跳过不可见行的性能取舍。

本机运行证据为生成文件，不进入扩展 ZIP 或 Git：[观察数据](../output/reflow-readiness/reflow-window-observation.json)、[截图](../output/reflow-readiness/reflow-window-mid-drag.png)、[可运行探针](../output/reflow-readiness/repro-reflow-windowing.js)。探针命令为 `node output/reflow-readiness/repro-reflow-windowing.js`，它只操作独立临时 fixture。

代码链：[windowing 重新渲染](../src/content/content-render.js) 只生成普通选中行；[applyReflowAfterRender](../src/content/content-tree-interactions.js) 重放位移却不恢复选中行的折叠。初始 session 仅测量已挂载行；如何更新跨窗口的占位和几何应与折叠一起设计，不能只隐藏一行就宣称修复。

## 已通过的真实鼠标路径

[reflow-stable.smoke.spec.js](../tests/smoke/reflow-stable.smoke.spec.js) 在独立临时浏览器 profile 和合成 Notebook 上运行。拖动使用 Playwright mouse 产生的可信 `dragstart/drop/dragend`；不人工填入 MIME payload，也不预先添加落点 class。

- 单条来源从未分组插到两个折叠文件夹之间：校验精确根层顺序、Undo、Redo、独立 storage 读回和刷新恢复。
- 第 1、3 条分别预先放在两个文件夹，第 5 条仍在未分组；跨三处非连续多选拖入目标文件夹：校验完整顺序、原文件夹腾空、每条恰好出现一次、退出批量模式与刷新恢复；使用深色模式。
- 240px 窄面板、reduced-motion 下拖动再按 Escape：确认折叠/位移清理、存储不变、刷新后仍有全部来源。

原有 smoke 另外覆盖混合/fixed box model、嵌套选择、50 项布局占位、滚动恢复、真实 Chromium Escape 与 Classic 路径。

## 拖拽性能

测量对象：基于 `b3eb68b`、包含本轮两项修复的最终工作树；平台：macOS、Apple M3 Max（14 逻辑处理器）、HeadlessChrome 145.0.0.0。每组合 5 次预热 + 20 次 prepare，10 次预热 + 50 次 dragover 回调；计时方法与门槛见 [DRAG_PERFORMANCE_BASELINE.md](DRAG_PERFORMANCE_BASELINE.md)。因取消恢复的修复涉及 prepare，本轮在最终代码上重新执行了完整四组合基准。

| 来源数 / 选择数 | prepare p50 / p95 (ms) | callback p50 / p95 (ms) | 强制布局阶段 max | geometry/query 调用 |
| --- | ---: | ---: | ---: | ---: |
| 100 / 1 | 2.5 / 2.6 | 0.5 / 0.8 | 3 | 439 |
| 100 / 50 | 14.7 / 16.2 | 0.8 / 1.5 | 3 | 699 |
| 500 / 1 | 2.0 / 2.2 | 0.9 / 1.5 | 3 | 660 |
| 500 / 50 | 12.7 / 14.8 | 0.4 / 2.4 | 3 | 1200 |

既有门槛全部满足：500/50 prepare p95 ≤18.59ms，500/1 callback p95 ≤2.64ms，500/50 callback p95 ≤5.83ms，强制布局阶段 ≤3；四组 geometry/query 总数均低于各自门槛。500/50 保持全部 50 个逻辑选择，当前窗口挂载 40 个选中项；这只证明数据集合和已有基准通过，不能证明跨窗口滚动预览正确。

## Manager 全量基准：未通过

完整执行 `npm run benchmark:manager`，每档 5 次预热 + 20 次测量，没有放宽原门槛。

| 来源数 | 搜索 p50 / p95 (ms) | 搜索门槛 p95 (ms) | 结果 |
| --- | ---: | ---: | --- |
| 100 | 19.8 / 23.7 | 100 | 通过 |
| 500 | 24.3 / 47.6 | 100 | 通过 |
| 1000 | 23.4 / 93.7 | 100 | 通过 |
| 5000 | 47.4 / 735.3 | 250 | 未通过 |

5000 档的输入同步 p95=1.9ms，Quick View=23.0ms，Tag filter=8.7ms，批量选择=24.1ms；这些项通过。窗口化仍生效，500/1000/5000 档均挂载 36 个来源。15 个监测 API 安装/恢复正常。

搜索慢尾包含 source replacement 后的来源扫描、调度和渲染。5000 档 `searchSchedulingMs` p95=290ms，`searchRenderTotalMs` p95=176.4ms，单靠当前日志不能把原因确定为 Reflow 或独立搜索算法。下一步应分别测量“来源同步已完成后的搜索”和“替换来源同时搜索”，为每阶段单独计数，确认原因后再优化；不得把失败改成通过或提高门槛。

## 转正前剩余条件

1. 完成跨窗口多选拖动的真实复现和修复验收，覆盖滚动中新挂载选中行、预览、最终顺序与取消。
2. 保持本次快速取消后重新拖动的回归通过，确保旧任务不能改变当前拖动。
3. 解释并解决 5000 来源基准失败，按原 5 + 20 全矩阵重新通过。
4. 对大量展开分组、嵌套和不同高度来源补真实布局边界测试；静态分析提示窗口估算未计入全部分组头高度，目前属于待验证风险。
5. 最后才同步三语 Beta 文案、README、UI/storage/message 合同和更新说明；保持默认模式与用户选择兼容。

浏览器验证仅代表上述环境和场景，不含用户真实 Notebook 内容的修改，也不等于 Chrome Web Store 发布。

## 本轮修复验证

最终代码通过 lint、52 个单元测试套件 / 1830 项用例和 `npm run test:smoke` 的 40 项默认 smoke；2 项 opt-in 性能用例按默认 smoke 规则跳过，二者的独立实际运行结果已在上文分别报告。真实拖放测试先等待折叠后的几何稳定，再使用 Playwright 原生 `dragTo`，避免把动画中预先测得的边缘坐标当成固定落点；三项用例另连续运行三轮，9/9 通过。以上绿色检查不覆盖或消除已经记录的窗口化未修复问题。

本地 `26.9.8` ZIP 已重建，包含 70 个运行时文件；包内文件与本轮代码逐一核对，CRC 检查通过，三语 Beta 文案保持不变。
