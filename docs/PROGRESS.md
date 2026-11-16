# 进度

本项目唯一的进度记录。每做完一件事就更新这里，并改最上面的日期。怎么接手见 [MAIN_THREAD.md](MAIN_THREAD.md)。

最后更新：2026-11-17

## 正在做

- 没有进行中的开发工作。
- 本地 `main` 比 `origin/main` 多三个提交，都已完成、还没推送：
  - `654e15c`：`CLAUDE.md` 改成只导入 `AGENTS.md` 的薄入口，新建 `docs/ARCHITECTURE.md`，清掉本机遗留的 Cursor、Gemini/Antigravity、Superpowers 配置和 `cookies.json`。
  - `4a1aed9`：删除 `copySkills.js`，把已合并的旧 worktree `trusting-antonelli-2056bb` 移到废纸篓。
  - `docs: Add main thread entry and progress file`（2026-11-17）：新建这份文件和 `MAIN_THREAD.md`；之后修这两份文件的提交也只在本地。

## 暂停的事和原因

- 同步功能保持暂停，不在真实笔记本上做破坏性测试。迁移交接里没写暂停的具体原因；现在 `package.json` 里已经没有 `sync:local` 脚本。要恢复先问 Jason。
- 2026-11-10 优化审查报告（库外，`分项报告/06-其余个人项目.md` 第 8 到 10 条）里有一条：`nsm-discipline` skill 和 `AGENTS.md` 的文档索引二选一保留。没做，因为不确定 Jason 还要不要合并成一处。现在的分工是 `AGENTS.md` 管文档索引，skill 只按任务指路。

## 等 Jason 的事

- 要不要把上面这三个本地提交推到 `origin/main`。推完看 CI。
- 三项可选清理，还没问过他：
  - 删除分支 `claude/trusting-antonelli-2056bb`（已合并，还在）。
  - 移除 Ego Lite 里的旧开发版扩展（ID `ioigjphnbifadmailejddedbnpkhajae`），它指向已经删掉的桌面旧目录。
  - 移除 Codex 浏览器分区里的另一份旧开发版扩展，同样指向桌面旧目录。
- 要不要在 `AGENTS.md` 的文档索引里加一行指向 `docs/MAIN_THREAD.md`。改 `AGENTS.md` 要他在本线程确认，所以这次只新增了文件。总指挥已说会转告他。

## 最近一次发布

- 26.10.27 版：2026-10-27 打包提交 Chrome 商店（提交 `e3fcdbe`），审核通过并已上线。
- 2026-10-28 商店描述改用 Gemini Notebook 名称（英文、简体中文、西班牙文），审核通过，Jason 已确认发布成功。这次没有改扩展本身。
- 之后推送到 `origin/main` 的顺序：`3a31fbc`（隐藏原生的自动分类、排序和全选那一行，代码修复，记在 `CHANGELOG.md` 的 Unreleased 里，还没发版）→ `ec51e03`（记录商店描述更新）→ `38f4da9`（审核规则，最近一次推送，CI run `40661715212` 通过）。

## 最近完成

- 2026-11-17：按「上下文落到文件」试点，新建 `docs/MAIN_THREAD.md` 和这份进度文件；总指挥的接手测试通过，按它指出的问题修正了这份文件和 `CHANGELOG.md` 里商店描述的状态。
- 2026-11-16：线程从旧电脑的 Claude 桌面应用迁到 T3 Code。迁移交接在库外 `~/.local/share/agent-sync/handoff/t3-migration-20261116/claude-notebooklm.md`，只作历史参考，现状以这份文件为准。
- 2026-11-10：`654e15c`、`4a1aed9`（见上）。
