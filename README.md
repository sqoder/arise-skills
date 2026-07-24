# Skills

一组用于 AI 编码助手（Claude Code / TRAE / Codex / Cursor 等）的 Skills，解决 vibecoding 中的常见痛点。

## 包含的 Skills

| Skill | 作用 |
|---|---|
| [bug-fix-memory](bug-fix-memory) | 记录难修 bug 的修复方案，下次修新 bug 前自动检索历史，防止同一个坑踩两次 |
| [auto-commit-on-completion](auto-commit-on-completion) | 写完代码自动提交（跑 lint/typecheck 通过才提交），不用每次都说「我要提交」 |
| [workflow-habits](workflow-habits) | 记录你的工作习惯（如「写完就提交」「改动最小化」），AI 后续自动遵守 |
| [finishing-a-development-branch](finishing-a-development-branch) | 开发分支完成时的处理（merge / PR / cleanup），克隆自 [superpowers](https://github.com/obra/superpowers) |
| [verification-before-completion](verification-before-completion) | 声称「完成」前强制验证，避免假完成，克隆自 [superpowers](https://github.com/obra/superpowers) |

## 安装

每个 skill 都是自包含的文件夹，核心是 `SKILL.md`。选你想要的，复制到对应位置即可：

### Claude Code

```bash
# 单个用户级（所有项目共享）
cp -r bug-fix-memory ~/.claude/skills/

# 或项目级（仅当前项目）
cp -r bug-fix-memory .claude/skills/
```

### TRAE

```bash
# 项目级
cp -r bug-fix-memory .trae/skills/
```

### 其他（Codex / Cursor / Windsurf 等）

Skills 是 [Anthropic 开放标准](https://github.com/anthropics/skills)，兼容上述工具。具体路径查各工具文档。

## 为什么有这些

vibecoding 时反复出现的痛点：

1. **同一个 bug 修了又修** —— 上次花很久修好的问题，改别的地方时又冒出来。`bug-fix-memory` 让 AI 修新问题前先查历史。
2. **每次都要说「提交代码」** —— 太啰嗦。`auto-commit-on-completion` 在任务完成后自动检查 + 合规验证 + 提交。
3. **习惯要每次重复说** —— 「用 pnpm 别用 npm」「改动最小化」… `workflow-habits` 记一次，以后自动遵守。

## 致谢

`finishing-a-development-branch` 和 `verification-before-completion` 来自 [obra/superpowers](https://github.com/obra/superpowers)（MIT License）。

## License

MIT
