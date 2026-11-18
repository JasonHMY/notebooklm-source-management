# 进度

本项目唯一的进度记录。每做完一件事就更新这里，并改最上面的日期。怎么接手见 [MAIN_THREAD.md](MAIN_THREAD.md)。

最后更新：2026-11-19

## 正在做

- 没有进行中的开发工作。

## 暂停的事和原因

- 同步功能保持暂停，不在真实笔记本上做破坏性测试。迁移交接里没写暂停的具体原因；现在 `package.json` 里已经没有 `sync:local` 脚本。要恢复先问 Jason。

## 等 Jason 的事

- 要不要推送 2026-11-19 起的本地提交（CI 和 `verify:full` 一项失败不再挡住其余检查，以及进度更新），推完看 CI。
- `nsm-discipline` skill 和 `AGENTS.md` 的文档索引要不要合并成一处（2026-11-10 优化审查报告建议二选一保留，库外 `分项报告/06-其余个人项目.md` 第 8 到 10 条）。建议不合并：`AGENTS.md` 是唯一文档索引，skill 只按任务指路。2026-11-19 按「一步卡住不挡后面」的做法，从暂停改成等 Jason 决定，不挡别的工作。

## 最近一次发布

- 26.10.27 版：2026-10-27 打包提交 Chrome 商店（提交 `e3fcdbe`），审核通过并已上线。
- 2026-10-28 商店描述改用 Gemini Notebook 名称（英文、简体中文、西班牙文），审核通过，Jason 已确认发布成功。这次没有改扩展本身。
- `3a31fbc`（隐藏原生的自动分类、排序和全选那一行，代码修复）已推送，记在 `CHANGELOG.md` 的 Unreleased 里，还没发版。
- 最近一次推送：2026-11-18 推到 `b2e8598`，CI run `44282847787` 通过。

## 最近完成

- 2026-11-19：按总指挥转来的会话地图做法，在 `MAIN_THREAD.md` 加了「会话登记」，登记主线程一个会话（本项目没有常驻分线和定时线程）；用 `codex archive` 归档了旧电脑 Codex 里用完的审核线程 `01a17ce4-d3bf-7c10-b322-e56d2d5585cf`（可恢复）。刷新后地图里本项目没有 [找不到]，待清理里也没有本项目的会话。
- 2026-11-19：按 Jason 定的「一步卡住不要让后面全停」，过了一遍流程、CI 和脚本。CI 里 lint、单测、装浏览器只依赖 `npm ci`，smoke 只依赖浏览器装好，单测挪到装浏览器之前；`npm run verify:full` 三项都跑完再报失败；`MAIN_THREAD.md` 加了「一步卡住时」，发布清单写明检查失败也要把其余检查跑完。`package.js` 打包前的内容检查失败就不出 zip，这是该挡的，没改；`.claude/hookify.*` 规则都只提醒不拦截。新电脑第一次跑 smoke 时缺 Playwright 的 Chromium：用默认的 Node 26 跑 `npm run playwright:install` 两次都卡住（第二次下载到 100% 后七分钟没动静），改用 `PATH=/opt/homebrew/opt/node@24/bin:$PATH npx playwright install chromium` 一次装好，原因没再深查。
- 2026-11-18：Jason 在今日看板同意后推送 CI 修复（`ci.yml` 运行环境固定为 `ubuntu-24.04`）和进度更新，CI run `44282847787` 恢复通过。之前推到 `d935552` 时 run `44271750042` 失败，原因是 `ubuntu-latest` 升到 26.04 后 Playwright 装不了 Chromium。
- 2026-11-18：核对旧开发版扩展 `ioigjphnbifadmailejddedbnpkhajae`：新旧两台电脑的 Ego Lite 和旧电脑的 Codex 浏览器分区里都已经没有注册，不用移除。旧电脑上只剩两个本地存储数据目录（Ego Lite `Profile 1/Local Extension Settings/` 和 Codex `Partitions/codex-browser-app/Local Extension Settings/` 下同名目录），是死数据，没动。

- 2026-11-18：Jason 在今日看板同意后，把本地 6 个提交推到 `origin/main`；删除旧分支 `claude/trusting-antonelli-2056bb`，删前核对过它唯一的提交 `5cbdca7` 和 main 上的 `3a31fbc` 改动逐行相同。
- 2026-11-18：`MAIN_THREAD.md` 加了给今日看板记工作状态的做法，并把开着的事各记了一行 `status-note`。
- 2026-11-17：Jason 经总指挥转达同意（“都可以”），在 `AGENTS.md` 文档索引加了一行指向 `docs/MAIN_THREAD.md`，改前备份在 `.claude/backups/2026-11-17/AGENTS.md`。
- 2026-11-17：按「上下文落到文件」试点，新建 `docs/MAIN_THREAD.md` 和这份进度文件；总指挥的接手测试通过，按它指出的问题修正了这份文件和 `CHANGELOG.md` 里商店描述的状态。
- 2026-11-16：线程从旧电脑的 Claude 桌面应用迁到 T3 Code。迁移交接在库外 `~/.local/share/agent-sync/handoff/t3-migration-20261116/claude-notebooklm.md`，只作历史参考，现状以这份文件为准。
- 2026-11-10：`654e15c`（`CLAUDE.md` 改成薄入口、新建 `docs/ARCHITECTURE.md`、清掉遗留配置）、`4a1aed9`（删除 `copySkills.js` 和已合并的旧 worktree）。
