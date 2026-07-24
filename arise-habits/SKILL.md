---
name: "arise-habits"
command: "arise habits"
description: "Records and enforces the user's personal coding workflow habits using agentmemory for persistent storage and semantic search. Invoke at session start to load habits, or when user says 'remember my habit'."
---

# 工作习惯记录

记录你的工作习惯，让 AI 在后续每次工作中自动遵守，不用每次重复说。

比如「写完代码就提交」「改动要最小化」「修 bug 前先写测试」——这些习惯记一次，以后 AI 自动按这个来。

## 依赖

本技能使用 [agentmemory](https://github.com/jayzeng/agentmemory) 作为底层存储和搜索引擎。

**首次使用前需安装：**

```bash
# 安装 CLI
npm install -g myagentmemory

# 初始化记忆目录
agent-memory init

# （可选）安装 qmd 获得语义搜索能力
# 没有 qmd 也能正常工作，只是搜索退化为关键词匹配
```

## 存储

习惯存储在 `~/.agent-memory/MEMORY.md` 中（agentmemory 的长期记忆文件），与其他记忆共享存储。

习惯条目使用 `#habit` 标签标记，便于搜索和区分：

```markdown
#habit [[commit]] 完成编码任务后自动检查改动、跑合规检查、通过就 git commit。不要 push，除非用户说。
#habit [[minimal-edit]] 修改现有代码时优先最小改动，不做额外重构、不加多余注释。
#habit [[package-manager]] 使用 pnpm，不要用 npm 或 yarn。
#habit [[bug-workflow]] 开始排查新问题时，先读 .arise/bug-fix-memory/log.md 查历史。
```

## 何时触发

### 1. 会话开始时 → 加载习惯

新对话开始时，执行：

```bash
agent-memory search --query "habit" --mode keyword --limit 20
```

将搜索到的习惯作为本次工作的默认行为。**不要每次都跟用户复述习惯内容**，安静遵守即可。

如果 agentmemory 未安装或搜索失败，回退到读取 `.arise/workflow-habits.md`（兼容旧版）。

### 2. 用户说「记住我的习惯」→ 记录

当用户说以下任何一种时，记录新习惯：

- 「记住我的习惯：……」
- 「以后都这样：……」
- 「我的习惯是……」
- 「记住，下次……」
- 「记得我总是……」

把习惯解析成「触发条件 + 执行动作」的结构，写入 agentmemory：

```bash
agent-memory write --target long_term --content "#habit [[<关键词>]] <触发条件>时，<执行动作>。"
```

并简短确认：「记下了：以后 <触发> 时会 <动作>。」

### 3. AI 观察到稳定模式 → 提示记录

当 AI 注意到用户**连续 3 次以上**用相同的方式纠正 AI 的行为（比如连续 3 次说「先提交再说」「别动那个文件」「用 pnpm 不要用 npm」），主动问一句：

> 我注意到你每次都要求 <X>，要不要记到习惯里，以后我自动这么做？

用户同意就记，拒绝就不记。

## 习惯格式

每条习惯遵循固定格式：

```
#habit [[<短标签>]] <触发条件>时，<执行动作>。<备注（可选）>
```

示例：

```
#habit [[commit]] 完成编码任务后，自动检查改动、跑合规检查、通过就 git commit。不要 push，除非用户说。
#habit [[minimal-edit]] 修改现有代码时，优先最小改动，不做额外重构、不加多余注释。
#habit [[pnpm]] 安装依赖或跑脚本时，使用 pnpm，不要用 npm 或 yarn。
#habit [[bug-check]] 开始排查新问题时，先读 .arise/bug-fix-memory/log.md 查历史。
#habit [[lang]] commit message 和代码注释使用中文。
```

## 搜索与匹配

当执行某个任务时，用当前任务关键词搜索相关习惯：

```bash
agent-memory search --query "<当前任务关键词>" --mode keyword --limit 5
```

只加载与当前任务相关的习惯，不全量读取。这样习惯再多也不会互相干扰。

## 习惯更新与删除

- **更新**：用户改变主意时，写入新版本（agentmemory 是追加式的），并标注 `#habit-override [[<原标签>]]`
- **删除**：用户说「不要这个习惯了」时，写入 `#habit-revoke [[<标签>]] 已撤销`
- 搜索时如果遇到 override 或 revoke，以最新状态为准

## 注意事项

- **安静遵守，不要复述**：加载习惯后，按习惯做就行，不要每次说「根据你的习惯 X，我现在……」。只有习惯被触发且影响决策时才提一句。
- **习惯之间冲突时**：问用户哪个优先，不要自己猜。
- **不要记废话习惯**：比如「写好代码」「认真工作」这种无法执行的不要记。必须是「触发 X 时做 Y」这种可执行的形式。
- **项目级 vs 全局**：agentmemory 存储在 `~/.agent-memory/`（全局），所有项目共享。如果用户想要项目级习惯，同时写一份到 `.arise/workflow-habits.md`。
- **兼容旧版**：如果 agentmemory 未安装，回退到读写 `.arise/workflow-habits.md`，功能不受影响（只是没有语义搜索）。
- **版本控制建议**：`~/.agent-memory/` 是全局目录，不在项目 git 里。项目级的 `.arise/workflow-habits.md` 按需决定是否加入 `.gitignore`。
---
name: "arise-habits"
command: "arise habits"
description: "Records and enforces the user's personal coding workflow habits (e.g. always commit after coding, prefer minimal edits). Invoke at session start to load habits, or when user says 'remember my habit'."
---

# 工作习惯记录

记录你的工作习惯，让 AI 在后续每次工作中自动遵守，不用每次重复说。

比如「写完代码就提交」「改动要最小化」「修 bug 前先写测试」——这些习惯记一次，以后 AI 自动按这个来。

## 存储

项目级存储，统一放在当前项目根目录的 **`.arise/workflow-habits.md`**。

文件不存在则视为还没有习惯记录。

格式：每条习惯一个条目，包含「触发条件」和「执行动作」。

## 何时触发

### 1. 会话开始时 → 加载习惯

新对话开始、或用户开始一个编码任务时，读取 `.arise/workflow-habits.md`（存在的话），把里面的习惯作为本次工作的默认行为。**不要每次都跟用户复述习惯内容**，安静遵守即可。

### 2. 用户说「记住我的习惯」→ 记录

当用户说以下任何一种时，记录新习惯：

- 「记住我的习惯：……」
- 「以后都这样：……」
- 「我的习惯是……」
- 「记住，下次……」
- 「记得我总是……」

把习惯解析成「触发条件 + 执行动作」的结构，写入 `.arise/workflow-habits.md`，并简短确认：「记下了：以后 <触发> 时会 <动作>。」

### 3. AI 观察到稳定模式 → 提示记录

当 AI 注意到用户**连续 3 次以上**用相同的方式纠正 AI 的行为（比如连续 3 次说「先提交再说」「别动那个文件」「用 pnpm 不要用 npm」），主动问一句：

> 我注意到你每次都要求 <X>，要不要记到 workflow-habits 里，以后我自动这么做？

用户同意就记，拒绝就不记。

## 习惯文件格式

`.arise/workflow-habits.md`：

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

## 修 bug 前先查踩坑记录
- **触发**: 开始排查新问题时
- **动作**: 先读 .arise/bug-fix-memory/log.md 查历史
- **来源**: AI 建议，用户同意
```

## 注意事项

- **安静遵守，不要复述**：加载习惯后，按习惯做就行，不要每次说「根据你的习惯 X，我现在……」。只有习惯被触发且影响决策时才提一句。
- **习惯之间冲突时**：问用户哪个优先，不要自己猜。
- **不要记废话习惯**：比如「写好代码」「认真工作」这种无法执行的不要记。必须是「触发 X 时做 Y」这种可执行的形式。
- **习惯可更新**：用户改变主意时，更新原条目而不是追加新条目，并在「来源」加一行「更新于 YYYY-MM-DD」。
- **和 bug-fix-memory 配合**：如果用户习惯里涉及 bug 修复流程，可以在 habit 里引用 bug-fix-memory skill。
- **项目级而非全局**：不同项目可能有不同习惯（比如开源项目要英文 commit，个人项目用中文），所以存在项目里。
- **版本控制建议**：如果是个人习惯，建议将 `.arise/` 加入 `.gitignore`；如果是团队共享的工作规范，则保留在版本控制中。
