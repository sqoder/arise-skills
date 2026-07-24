# arise-skills

一组用于 AI 编码助手（Claude Code / TRAE / Codex / Cursor 等）的 Skills，解决 vibecoding 中的常见痛点。

## 包含的 Skills

| Skill | 命令 | 作用 |
|---|---|---|
| [bug-fix-memory](bug-fix-memory) | `/arise bug-memo` | 记录踩过的坑（难修 bug、配置陷阱、文档 gotcha、工具怪癖），下次遇到类似问题前自动检索历史 |
| [auto-commit-on-completion](auto-commit-on-completion) | `/arise commit` | 写完代码自动提交（跑 lint/typecheck 通过才提交），不用每次都说「我要提交」 |
| [workflow-habits](workflow-habits) | `/arise habits` | 记录你的工作习惯（如「写完就提交」「改动最小化」），AI 后续自动遵守 |
| [finishing-a-development-branch](finishing-a-development-branch) | `/arise finish` | 开发分支完成时的处理（merge / PR / cleanup），克隆自 [superpowers](https://github.com/obra/superpowers) |
| [verification-before-completion](verification-before-completion) | `/arise verify` | 声称「完成」前强制验证，避免假完成，克隆自 [superpowers](https://github.com/obra/superpowers) |

## 安装

### 1. 克隆仓库

```bash
git clone https://github.com/sqoder/arise-skills.git
```

### 2. 复制到你用的工具

**Claude Code：**

```bash
# 用户级（所有项目共享）
cp -r arise-skills/*/ ~/.claude/skills/

# 或项目级（仅当前项目）
cp -r arise-skills/*/ .claude/skills/
```

**TRAE：**

```bash
# 项目级
cp -r arise-skills/*/ .trae/skills/
```

**其他（Codex / Cursor / Windsurf 等）：**

Skills 是 [Anthropic 开放标准](https://github.com/anthropics/skills)，兼容上述工具。具体路径查各工具文档。

### 3. 开始使用

安装后，在 AI 编码助手中直接输入：

```
/arise bug-memo    → 查历史 / 记录踩坑
/arise commit      → 检查 + 提交
/arise habits      → 加载 / 记录习惯
/arise finish      → 分支收尾
/arise verify      → 完成前验证
```

大部分 Skill 也会自动触发（如 `commit` 在任务完成后自动执行，`bug-memo` 在修 bug 前自动检索）。

### 运行时数据

Skill 工作时会在你的**项目根目录**自动生成 `.arise/` 文件夹：

```
your-project/
├── src/
├── package.json
└── .arise/                  ← 自动生成
    ├── bug-fix-memory/      ← 踩坑记录
    │   ├── log.md
    │   └── entries/
    └── workflow-habits.md   ← 你的工作习惯
```

> 提示：个人使用建议将 `.arise/` 加入 `.gitignore`；团队共享则保留在版本控制中。

## Skill 协作关系

```
bug-fix-memory ←→ workflow-habits
│  习惯可引用 bug 检索流程（如「修 bug 前先查历史」）
│
auto-commit-on-completion ←→ verification-before-completion
│  提交前先验证，验证通过才提交
│
finishing-a-development-branch ←→ verification-before-completion
   分支集成前必须测试全绿
```

- `workflow-habits` 可以定义「修 bug 前先查 bug-fix-memory」这样的习惯，串联两个 Skill。
- `auto-commit-on-completion` 的合规检查与 `verification-before-completion` 理念一致：先验证，再行动。
- `finishing-a-development-branch` 的第 1 步强制跑测试，与 `verification-before-completion` 的铁律呼应。

## 为什么有这些

vibecoding 时反复出现的痛点：

1. **同一个坑踩了又踩** —— 上次花很久解决的问题（bug、配置陷阱、文档 gotcha），改别的地方时又冒出来。`bug-fix-memory` 让 AI 解决新问题前先查历史。
2. **每次都要说「提交代码」** —— 太啰嗦。`auto-commit-on-completion` 在任务完成后自动检查 + 合规验证 + 提交。
3. **习惯要每次重复说** —— 「用 pnpm 别用 npm」「改动最小化」… `workflow-habits` 记一次，以后自动遵守。

## 致谢

`finishing-a-development-branch` 和 `verification-before-completion` 来自 [obra/superpowers](https://github.com/obra/superpowers)（MIT License）。

## License

MIT
