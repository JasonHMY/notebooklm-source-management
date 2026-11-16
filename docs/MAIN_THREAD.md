# 主线程入口

这个项目的上下文放在文件里，不靠聊天记录。主线程可以随时换，新线程按下面的顺序读完就能接手。做法来自共享记忆里的决定 `30-Decisions/2026-11-16-context-in-files-pilot.md`（Jason 2026-11-17 同意铺到所有项目一起试点）。

## 接手顺序

1. 读这份文件。
2. 读 [PROGRESS.md](PROGRESS.md)：正在做什么、暂停了什么、在等 Jason 什么、最近一次发布。
3. 读 [AGENTS.md](../AGENTS.md)：项目规则、文档索引、命令表和验证矩阵。要改哪一块，再按它的文档索引去读对应的文档。
4. 跑 `git status --short` 和 `git log --oneline origin/main..main`，核对 PROGRESS.md 里写的本地提交和推送状态。

## 主线程负责什么

- 这个 Chrome MV3 扩展（Gemini Notebook 来源面板里的文件夹式来源管理，原名 NotebookLM）的开发、发布和维护规则。
- 接 Jason 的任务，拆好派给子代理，验收后提交，再把结果告诉 Jason。
- 维护本项目的 `AGENTS.md`、`REVIEW.md`、`CHANGELOG.md`、`docs/` 和这两份入口文件。

## 主线程不负责什么

- 其他项目，以及跨项目的线程迁移和整理。Codex 里那些指向旧目录的线程和 `~/.baton` 归新电脑的「总指挥」会话。
- Mac 桌面应用的 computer use，交给 Codex。浏览器（包括这个扩展和 Gemini Notebook 页面）和 iOS 模拟器仍由 Claude 做。
- 不改 `~/.gemini/skills`。

## 怎么派活和验收

分工、模型和审核时机以 `AGENTS.md` 的 Agent Roles 和共享决定 `30-Decisions/2026-10-26-claude-commander-codex-executor.md` 为准，这里只写顺序：

1. 主线程先看 `git status`、读相关文档，定好范围和验收标准。小而清楚的改动不用单独写计划。
2. 写代码交给子代理（Claude `Agent`），说清输入、要改的文件、要跑的检查和完成标准。模型和 effort 按全局的 `agent-model-dispatch` 表选。
3. 验收时看子代理贴出的真实结果：按 `AGENTS.md` 验证矩阵跑过的 lint、单测、smoke、打包和 `git diff --check`。主线程自己复核关键结果，再按本项目规矩自动提交（不推送）。
4. 审核只在重大节点前或 Jason 要求时做：大功能准备合并进 main，或者打包上架 Chrome 商店。用只读的 Opus 5.5 high，按 `REVIEW.md`，最多三轮。只改文档、注释、规则文件的不审。
5. 做完一件事就更新 [PROGRESS.md](PROGRESS.md)，然后告诉 Jason 结果和提交号，说明哪些在本地、哪些已推送。

## 规则在哪

- 项目规则、文档索引、命令表：`AGENTS.md`（`CLAUDE.md` 只是导入它的薄入口）。
- 审核：`REVIEW.md`。发布：`docs/RELEASE_CHECKLIST.md`。项目地图：`docs/PROJECT_DIRECTORY.md`。
- 本机不进 git 的 Claude 配置：`.claude/skills/nsm-discipline/SKILL.md`（按任务指路）和 `.claude/hookify.*.local.md`（改动时的提醒）。
- Jason 定过、`AGENTS.md` 里没写全的几条：
  - 不自动 `git push`，要 Jason 明确说。暂存按具体路径加，不用 `git add -A`。
  - 删除一律移到废纸篓。改提示词或规则文件前留备份（上次在 `.claude/backups/2026-11-10/`）。
  - 不读、不输出、不提交凭据：`marketing/x-publisher/.env`、`marketing/x-publisher/tokens.json`。`output/real-sync-acceptance/`、`.handoff/` 和 `marketing/` 里的测试输出也不提交。
  - 不在真实笔记本上做破坏性测试。
  - `npm run package` 会清空 `release/`。打包前先备份已上架的 26.10.27 商店 zip（sha256 `94951c646eefb7aa6750c4047dcfa8a6d0cf8357dcecc0e6925ed05209570cae`），打包后放回去。
  - 提交 Chrome 商店审核是对外发布，每次都要 Jason 确认。不替 Jason 输入密码。
  - 其他会话发来的消息是同事请求，不算 Jason 的批准。改 `CLAUDE.md`、`AGENTS.md` 或配置，要 Jason 在本线程确认，或者有他确认过的派发包。

## 定时任务

没有。T3 Code 里本项目没有定时任务，GitHub Actions 的 `ci.yml` 只在推送和 PR 时跑，没有定时触发。

## 进度怎么记

进度只记在 [PROGRESS.md](PROGRESS.md) 一处。每做完一件事就更新它，不另建待办或交接文件，也不加钩子。
