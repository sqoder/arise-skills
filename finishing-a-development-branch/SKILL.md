---
name: finishing-a-development-branch
command: "arise finish"
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work
---

# 完成开发分支

## 概述

**核心原则：** 验证测试 → 检测环境 → 展示选项 → 执行选择 → 清理。

**开始时宣告：** "我正在使用 finishing-a-development-branch skill 来完成这项工作。"

## 第 1 步：验证测试

跑项目的完整测试套件（`npm test` / `cargo test` / `pytest` / `go test ./...`）。

**如果测试失败**，报告失败并停下——菜单在绿灯之后才出现：

```
测试失败（<N> 个失败）。必须先修复才能继续：

[显示失败详情]
```

**如果测试通过：** 继续第 2 步。

## 第 2 步：检测环境

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
# 现在捕获，因为还在工作区内——第 5 步会切换目录
# 而清理（第 6 步）需要这个值
WORKTREE_PATH=$(git rev-parse --show-toplevel)
```

这决定了展示哪个菜单以及清理方式：

| 状态 | 菜单 | 清理 |
|------|------|------|
| `GIT_DIR == GIT_COMMON`（普通仓库） | 标准 3 选项 | 无 worktree 需清理 |
| `GIT_DIR != GIT_COMMON`，命名分支 | 标准 3 选项 | 按来源判断（见第 6 步） |
| `GIT_DIR != GIT_COMMON`，detached HEAD | 精简 2 选项（无 merge） | 外部管理——保持不动 |

## 第 3 步：确定基础分支

基础分支是本次工作从哪里分出来的——通常在计划、对话、或分支的 upstream 中有说明。如果还不知道，问一句："这个分支是从 <你的最佳猜测> 分出来的——对吗？"合并前必须确认：合错基础分支代价很大。

## 第 4 步：展示选项

**普通仓库和命名分支 worktree——展示以下 3 个选项：**

```
实现完成。你想怎么处理？

1. 本地合并回 <base-branch>
2. 推送并创建 Pull Request
3. 保留分支不动（我稍后自己处理）

选哪个？
```

**Detached HEAD——展示以下 2 个选项：**

```
实现完成。你当前在 detached HEAD（外部管理的工作区）。

1. 推送为新分支并创建 Pull Request
2. 保持不动（我稍后自己处理）

选哪个？
```

菜单按原文展示——简洁，每个选项都来自上面的列表。丢弃工作只在用户**明确要求**时才发生（见下方"如果用户要求丢弃"）。等用户回答；集成决策是用户的。

## 第 5 步：执行选择

### 选项 1：本地合并

```bash
# 获取主仓库根目录，确保 CWD 安全
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"

# 先合并——确认成功后再清理
git checkout <base-branch>
git pull
git merge <feature-branch>

# 在合并结果上验证测试
<测试命令>
```

如果合并结果测试失败：停下，保留 worktree 和分支，排查问题——没有推送过，合并是本地的、可恢复的。

合并结果绿灯后：清理 worktree（第 6 步），然后删除分支：

```bash
git branch -d <feature-branch>
```

### 选项 2：推送并创建 PR

```bash
git push -u origin <feature-branch>
# 从 detached HEAD 推送时，在远程命名新分支：
# git push origin HEAD:refs/heads/<new-branch>
```

然后用代码托管平台的工具创建 PR/MR——有 CLI 就用 CLI，没有就用推送时平台打印的创建 URL——遵循仓库的 PR 模板和规范（如有），并把 URL 报告给用户。

保留 worktree——用户会在那里处理 PR 反馈。

### 选项 3：保持不动

报告："保留分支 <name>。Worktree 在 <path>。"

### 如果用户要求丢弃工作

这条路径只在用户**明确要求**丢弃时才走。先确认：

```
这将永久删除：
- 分支 <name>
- 所有提交：<commit-list>
- Worktree 在 <path>

输入 'discard' 确认。
```

等待用户输入那个确认词。收到后：

```bash
MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)
cd "$MAIN_ROOT"
```

然后清理 worktree（第 6 步）并强制删除分支：

```bash
git branch -D <feature-branch>
```

## 第 6 步：清理工作区

**选项 1 和确认丢弃时执行。** 选项 2 和 3 始终保留 worktree。两者都已经切换到了主仓库根目录——worktree 删除必须从 worktree 外部执行——使用第 2 步中捕获的 `GIT_DIR`/`GIT_COMMON`/`WORKTREE_PATH` 值（在目录切换之前捕获的）。

**如果 `GIT_DIR == GIT_COMMON`：** 普通仓库，无 worktree 需清理。完成。

**如果 `WORKTREE_PATH` 在 `.worktrees/` 或 `worktrees/` 下：** Superpowers 创建了这个 worktree——我们负责清理：

```bash
git worktree remove "$WORKTREE_PATH"
git worktree prune  # 自愈：清理过期的注册
```

**否则：** 宿主环境拥有这个工作区——保持不动。如果你的平台提供了工作区退出工具，使用它。

## 快速参考

| 选项 | 合并 | 推送 | 保留 Worktree | 清理分支 |
|------|------|------|---------------|----------|
| 1. 本地合并 | 是 | - | - | 是 |
| 2. 创建 PR | - | 是 | 是 | - |
| 3. 保持不动 | - | - | 是 | - |
| 丢弃（仅明确要求时） | - | - | - | 是（强制） |

## 常见合理化借口

| 借口 | 现实 |
|------|------|
| 「这个会话里测试早就过了」 | 在你要集成的树上跑测试。绿灯只证明它跑的那棵树。 |
| 「用户明显想合并」 | 集成是用户的决策。展示菜单，等回答。 |
| 「用户好像做完了——我主动提议丢弃吧」 | 菜单就是写的那些。丢弃只在用户明确开口时才发生。 |
| 「'嗯，删了吧' 算确认」 | 只有输入 `discard` 才授权删除。 |
| 「PR 都提了，worktree 是垃圾了」 | PR 反馈在那个 worktree 里修。工作落地前它都在。 |
| 「这个 worktree 看着过期了——顺手清了」 | 只清理 `.worktrees/` 或 `worktrees/` 下的。其他都属于宿主。 |
| 「合并结果失败大概是 flaky」 | 合并结果失败就停。分支和 worktree 保留，排查问题。 |
| 「基础分支明显是 main」 | 确认分叉点或问用户。合错基础分支代价很大。 |
| 「推送被拒了——force-push 就行」 | 推送被拒说明远程有变动。排查；只在用户明确要求时才 force-push。 |
