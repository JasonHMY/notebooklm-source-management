# 进度

本项目唯一的进度记录。每做完一件事就更新这里，并改最上面的日期。怎么接手见 [MAIN_THREAD.md](MAIN_THREAD.md)。

最后更新：2026-11-17

## 正在做

- 没有进行中的开发工作。
- 本地 `main` 比 `origin/main` 多两个提交，都已完成、还没推送：
  - `654e15c`：`CLAUDE.md` 改成只导入 `AGENTS.md` 的薄入口，新建 `docs/ARCHITECTURE.md`，清掉本机遗留的 Cursor、Gemini/Antigravity、Superpowers 配置和 `cookies.json`。
  - `4a1aed9`：删除 `copySkills.js`，把已合并的旧 worktree `trusting-antonelli-2056bb` 移到废纸篓。
- 再加上 2026-11-17 新建这份文件和 `MAIN_THREAD.md` 的提交（`docs: Add main thread entry and progress file`），也只在本地。

## 暂停的事和原因

- 同步功能保持暂停，不在真实笔记本上做破坏性测试。交接里没写暂停的具体原因；现在 `package.json` 里已经没有 `sync:local` 脚本。要恢复先问 Jason。
- 审查报告里有一条：`nsm-discipline` skill 和 `AGENTS.md` 的文档索引二选一保留。没做，因为不确定 Jason 还要不要合并成一处。现在的分工是 `AGENTS.md` 管文档索引，skill 只按任务指路。

## 等 Jason 的事

- 要不要把上面这几个本地提交推到 `origin/main`。推完看 CI。
- 三项可选清理，还没问过他：
  - 删除分支 `claude/trusting-antonelli-2056bb`（已合并，还在）。
  - Ego Lite 里一份旧开发版扩展（ID `ioigjphnbifadmailejddedbnpkhajae`），以及 Codex 浏览器分区里的另一份，都指向已经删掉的桌面旧目录。
- 要不要在 `AGENTS.md` 的文档索引里加一行指向 `docs/MAIN_THREAD.md`。改 `AGENTS.md` 要他在本线程确认，所以这次只新增了文件。

## 最近一次发布

- 26.10.27 版：2026-10-27 打包提交 Chrome 商店，审核通过并已上线。
- 2026-10-28 商店描述改用 Gemini Notebook 名称（英文、简体中文、西班牙文），Jason 已确认发布成功。这次没有改扩展本身。
- 最近一次推送是 `38f4da9`，CI run `40661715212` 通过。之后的工具栏修复 `3a31fbc` 已推送，但还在 `CHANGELOG.md` 的 Unreleased 里，没有发版。

## 最近完成

- 2026-11-17：按「上下文落到文件」试点，新建 `docs/MAIN_THREAD.md` 和这份进度文件。
- 2026-11-16：线程从旧电脑的 Claude 桌面应用迁到 T3 Code，按交接核对过现状。
- 2026-11-10：`654e15c`、`4a1aed9`（见上）。
