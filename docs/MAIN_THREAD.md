# 主线程入口

这个项目的上下文放在文件里，不靠聊天记录。主线程可以随时换，新线程按下面的顺序读完就能接手。做法来自共享记忆里的决定 `30-Decisions/2026-11-16-context-in-files-pilot.md`（Jason 2026-11-17 同意铺到所有项目一起试点，经新电脑「总指挥」会话转达；决定文件本身还写着只试点「Lark 库存」）。

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

## 一步卡住时

按 Jason 2026-11-19 定的做法（全局规则线程会写正式条文，以那边为准）：某一步卡住时，先判断它是不是非解决不可、后面都靠它。

- 是的话，就停下来，用 `status-note` 记一条 `you`，请 Jason 出面处理。
- 不是的话，跳过这一步，同样记一条 `you`，写清问题和建议，其余工作照常做完。Jason 回复后再回来跟进。
- 跳过的只是出问题的那一步，它本身的门槛不绕过：推送、提交商店审核、凭据登录和永久删除照旧要 Jason 同意。
- 检查也按这个做法：CI 和 `npm run verify:full` 里一项检查失败，后面的检查照样跑完，最后一起看结果。

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

## 给今日看板记工作状态

Jason 不再收通知，只看「今日看板」。主线程在开始一件事、做完、卡住、需要 Jason 出面这四个时刻，各记一行（Jason 直接在本线程说的事也记）：

```sh
~/.agents/bin/status-note NotebookLM <doing|follow|you|hold|done> "<做什么>" --note "<一句话>" --thread "notebooklm-source-management-main" --id <固定的键>
```

- 需要 Jason 出面的 `you` 必须带 `--ask`（没看过前文也能懂的问题）和 `--suggest`（他点一下就能采用的具体答案）。几个独立决定拆成几条。
- 同一件事沿用同一个 `--id`，以最后一次记录为准；搁置只记一次 `hold`，写清原因和在等什么。子代理不记，由主线程记。
- 不写凭据。`--list NotebookLM` 可以看当前记录。
- 完整规则在共享记忆 `10-Profile/Preferences/work-status-notes.md`。这一行只给全局视图用，PROGRESS.md 照旧维护。
