# 进度

本项目唯一的进度记录。每做完一件事就更新这里，并改最上面的日期。怎么接手见 [MAIN_THREAD.md](MAIN_THREAD.md)。

最后更新：2026-11-18

## 正在做

- 没有进行中的开发工作。
- CI 修复只在本地：2026-11-18 推送后 CI 失败，原因是 `ubuntu-latest` 已升到 26.04，Playwright 不支持在上面装 Chromium，和推送的文档改动无关。已把 `.github/workflows/ci.yml` 的运行环境固定为 `ubuntu-24.04`，等 Jason 同意再推送验证。

## 暂停的事和原因

- 同步功能保持暂停，不在真实笔记本上做破坏性测试。迁移交接里没写暂停的具体原因；现在 `package.json` 里已经没有 `sync:local` 脚本。要恢复先问 Jason。
- 2026-11-10 优化审查报告（库外，`分项报告/06-其余个人项目.md` 第 8 到 10 条）里有一条：`nsm-discipline` skill 和 `AGENTS.md` 的文档索引二选一保留。没做，因为不确定 Jason 还要不要合并成一处。现在的分工是 `AGENTS.md` 管文档索引，skill 只按任务指路。

## 等 Jason 的事

- 要不要推送 CI 修复（固定 `ubuntu-24.04`），推完看 CI 是否恢复通过。

## 最近一次发布

- 26.10.27 版：2026-10-27 打包提交 Chrome 商店（提交 `e3fcdbe`），审核通过并已上线。
- 2026-10-28 商店描述改用 Gemini Notebook 名称（英文、简体中文、西班牙文），审核通过，Jason 已确认发布成功。这次没有改扩展本身。
- `3a31fbc`（隐藏原生的自动分类、排序和全选那一行，代码修复）已推送，记在 `CHANGELOG.md` 的 Unreleased 里，还没发版。
- 最近一次推送：2026-11-18 推到 `d935552`，CI run `44271750042` 因运行环境失败（见上）。上一次通过的 CI 是 `38f4da9` 的 run `40661715212`。

## 最近完成

- 2026-11-18：核对旧开发版扩展 `ioigjphnbifadmailejddedbnpkhajae`：新旧两台电脑的 Ego Lite 和旧电脑的 Codex 浏览器分区里都已经没有注册，不用移除。旧电脑上只剩两个本地存储数据目录（Ego Lite `Profile 1/Local Extension Settings/` 和 Codex `Partitions/codex-browser-app/Local Extension Settings/` 下同名目录），是死数据，没动。

- 2026-11-18：Jason 在今日看板同意后，把本地 6 个提交推到 `origin/main`；删除旧分支 `claude/trusting-antonelli-2056bb`，删前核对过它唯一的提交 `5cbdca7` 和 main 上的 `3a31fbc` 改动逐行相同。
- 2026-11-18：`MAIN_THREAD.md` 加了给今日看板记工作状态的做法，并把开着的事各记了一行 `status-note`。
- 2026-11-17：Jason 经总指挥转达同意（“都可以”），在 `AGENTS.md` 文档索引加了一行指向 `docs/MAIN_THREAD.md`，改前备份在 `.claude/backups/2026-11-17/AGENTS.md`。
- 2026-11-17：按「上下文落到文件」试点，新建 `docs/MAIN_THREAD.md` 和这份进度文件；总指挥的接手测试通过，按它指出的问题修正了这份文件和 `CHANGELOG.md` 里商店描述的状态。
- 2026-11-16：线程从旧电脑的 Claude 桌面应用迁到 T3 Code。迁移交接在库外 `~/.local/share/agent-sync/handoff/t3-migration-20261116/claude-notebooklm.md`，只作历史参考，现状以这份文件为准。
- 2026-11-10：`654e15c`（`CLAUDE.md` 改成薄入口、新建 `docs/ARCHITECTURE.md`、清掉遗留配置）、`4a1aed9`（删除 `copySkills.js` 和已合并的旧 worktree）。
