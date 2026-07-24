---
name: "workflow-habits"
description: "Records and enforces the user's personal coding workflow habits (e.g. always commit after coding, prefer minimal edits). Invoke at session start to load habits, or when user says 'remember my habit'."
---

# Workflow Habits

记录你的工作习惯，让 AI 在后续每次工作中自动遵守，不用每次重复说。

比如「写完代码就提交」「改动要最小化」「修 bug 前先写测试」——这些习惯记一次，以后 AI 自动按这个来。

## Storage

项目级存储，放在当前项目的 `.trae/workflow-habits.md`。文件不存在则视为还没有习惯记录。

格式：每条习惯一个条目，包含「触发条件」和「执行动作」。

## When to Invoke

### 1. 会话开始时 → 加载习惯

新对话开始、或用户开始一个编码任务时，读取 `.trae/workflow-habits.md`（存在的话），把里面的习惯作为本次工作的默认行为。**不要每次都跟用户复述习惯内容**，安静遵守即可。

### 2. 用户说「记住我的习惯」→ 记录

当用户说以下任何一种时，记录新习惯：

- 「记住我的习惯：……」
- 「以后都这样：……」
- 「我的习惯是……」
- 「记住，下次……」
- 「记得我总是……」

把习惯解析成「触发条件 + 执行动作」的结构，写入 `.trae/workflow-habits.md`，并简短确认：「记下了：以后 <触发> 时会 <动作>。」

### 3. AI 观察到稳定模式 → 提示记录

当 AI 注意到用户**连续 3 次以上**用相同的方式纠正 AI 的行为（比如连续 3 次说「先提交再说」「别动那个文件」「用 pnpm 不要用 npm」），主动问一句：

> 我注意到你每次都要求 <X>，要不要记到 workflow-habits 里，以后我自动这么做？

用户同意就记，拒绝就不记。

## Habit File Format

`.trae/workflow-habits.md`：

```markdown
# Workflow Habits

## 写完代码就提交
- **触发**: 完成一个编码任务后
- **动作**: 自动检查改动、跑合规检查、通过就 git commit
- **来源**: 用户 2024-01-15 明确要求
- **备注**: 不要 push，除非我说

## 改动最小化
- **触发**: 修改现有代码时
- **动作**: 优先最小改动，不做额外重构、不加多余注释
- **来源**: 用户多次强调

## 修 bug 前先查 bug-fix-memory
- **触发**: 开始排查新 bug 时
- **动作**: 先读 .trae/bug-fix-memory/log.md 查历史
- **来源**: AI 建议，用户同意
```

## Guidelines

- **安静遵守，不要复述**：加载习惯后，按习惯做就行，不要每次说「根据你的习惯 X，我现在……」。只有习惯被触发且影响决策时才提一句。
- **习惯之间冲突时**：问用户哪个优先，不要自己猜。
- **不要记废话习惯**：比如「写好代码」「认真工作」这种无法执行的不要记。必须是「触发 X 时做 Y」这种可执行的形式。
- **习惯可更新**：用户改变主意时，更新原条目而不是追加新条目，并在「来源」加一行「更新于 YYYY-MM-DD」。
- **和 bug-fix-memory 配合**：如果用户习惯里涉及 bug 修复流程，可以在 habit 里引用 bug-fix-memory skill。
- **项目级而非全局**：不同项目可能有不同习惯（比如开源项目要英文 commit，个人项目用中文），所以存在项目里。
