---
name: "auto-commit-on-completion"
command: "arise commit"
description: "Auto-commits code after a coding task finishes, but only if it passes compliance checks (lint/type-check). Invoke when a coding task (bugfix, feature, refactor) is completed and there are uncommitted changes."
---

# 完成时自动提交

写完代码不用每次都说「我要提交」。这个 skill 在每个编码任务（修 bug、加功能、重构）完成后，自动检查未提交的改动，跑合规检查，通过就提交。

## 何时触发

当一个**明确的编码任务完成**时触发。判断「完成」的信号：

- 用户说「好了」「这样就行」「可以了」「下一个问题」等收尾语
- AI 刚做完一轮代码修改并验证通过
- 一个 bug 修复完毕、一个功能实现完毕、一次重构完成

**不要在这些情况触发：**
- 任务还没做完、还在调试中
- 只是读代码、解释代码，没有产生改动
- 用户明确说「先别提交」「不要提交」

## 工作流程

完成任务后，按顺序执行：

### 1. 检查是否有改动

```
git status --porcelain
```

- 无输出（没有改动）→ 什么都不做，安静结束。
- 有改动 → 进入第 2 步。

### 2. 合规检查

从 `package.json`（或同等配置文件）检测可用的检查命令，**只跑存在的**：

| 检测到 | 执行 |
|---|---|
| `scripts.lint` | `npm run lint`（或 pnpm/yarn 对应） |
| `scripts.typecheck` 或 `scripts.tsc` | 跑它 |
| `scripts.build` 且项目是 TS/需编译 | 可选，默认不跑（太慢） |

**Monorepo 支持：**

如果检测到 `pnpm-workspace.yaml`、`package.json` 中的 `workspaces` 字段、或 `turbo.json`，说明是 monorepo：

1. 根据本次改动文件定位其所在的子包（workspace package）。
2. 优先跑子包级的 lint/typecheck（如 `pnpm --filter <pkg> lint`）。
3. 如果子包没有独立的 lint 命令，回退到根目录的全局检查。

- 没有检测到任何 lint/typecheck 命令 → 跳过合规检查，直接进入第 3 步。
- 有 `.husky/pre-commit` 或 lint-staged 配置 → 让 git commit 自己触发，不手动跑。

### 3. 处理合规结果

- **全部通过** → 进入第 4 步提交。
- **有失败** → **不提交**，把失败的输出摘要告诉用户：「lint 挂了，X 文件 Y 行有问题，要不要我先修了再提交？」不要自动修，等用户决定。

### 4. 提交

1. `git add` —— 只 add 本次任务相关的文件，不要 `git add -A` 或 `git add .`。根据本次改动的文件列表精确添加。
2. 生成 commit message，用 Conventional Commits 格式：

   ```
   <type>(<scope>): <subject>

   <body 可选，说明 why>
   ```

   - `type`：feat / fix / refactor / docs / test / chore / style / perf
   - `scope`：影响的模块（可省略）
   - `subject`：祈使句，小写开头，不超过 50 字符，说「做了什么」
   - body：说「为什么」这样做，特别是根因类修复必写

3. 用 HEREDOC 提交（保证格式）：
   ```
   git commit -m "$(cat <<'EOF'
   fix(auth): handle expired token redirect

   token 过期后跳登录页丢失了原 URL，登录后无法回到目标页。
   把 redirect 参数带上。
   EOF
   )"
   ```
4. **不要 push**。除非用户明确说「push」「推上去」「发布」。

### 5. 反馈

提交后一句话告诉用户：「已提交: `<commit message 第一行>` (hash)」。不要长篇大论。

## 注意事项

- **精确 add**：根据 `git status` 和本次任务涉及的文件来 add，绝不 `git add -A`，避免误提交 `.env`、临时文件、其他无关改动。
- **一个任务一个 commit**：如果一次对话做了多个独立任务，应该拆成多个 commit，而不是一个大 commit。
- **不 push**：push 是有副作用的远程操作，必须用户明确要求。
- **合规失败不硬提交**：lint/typecheck 挂了就停下问用户，不要 `--no-verify` 绕过。
- **跳过文档-only 改动的 lint**：如果只改了 `.md` 文件，不需要跑 lint。
- **尊重用户中断**：如果用户在流程中说「等一下」「先别」，立即停止。
- **分支提醒**：如果当前在 main/master 上，且项目有分支规范（如存在 `.github/PULL_REQUEST_TEMPLATE`、CONTRIBUTING.md 中提到分支策略、或历史提交都在 feature 分支上），提交前提醒用户：「当前在 main 上，要不要先开个分支再提交？」用户说不用就直接提交。
- **commit message 语言**：跟随仓库现有 commit 的语言习惯（先看 `git log --oneline -5`）。仓库用中文就用中文，用英文就用英文。
