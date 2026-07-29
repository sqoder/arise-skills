# arise-skills

一组用于 AI 编码助手（Claude Code / TRAE / Codex / Cursor 等）的 Skills，解决 vibecoding 中的常见痛点。

## 包含的 Skills

| Skill | 命令 | 作用 |
|---|---|---|
| [arise-router](arise-router) | `/arise` | 编排入口：加载项目上下文，路由用户意图到对应 Skill，管理跨 Skill 协作 |
| [arise-prompt](arise-prompt) | `/arise-prompt` | 上下文感知提示词工程器：收集上下文、分析意图、动态组装结构化提示词 |
| [arise-knowledge](arise-knowledge) | MCP Server | 代码分析引擎接入层：优先用 CodeGraph，回退到内置引擎。AST + 调用图 + 向量搜索 |
| [arise-bug-memo](arise-bug-memo) | `/arise-bug-memo` | 记录踩过的坑（难修 bug、配置陷阱、文档 gotcha、工具怪癖），下次遇到类似问题前自动检索历史 |
| [arise-commit](arise-commit) | `/arise-commit` | 写完代码自动提交（跑 lint/typecheck 通过才提交），不用每次都说「我要提交」 |
| [arise-habits](arise-habits) | `/arise-habits` | 记录你的工作习惯，自动检测重复模式并记录，供其他 Skill 作为约束条件消费 |
| [arise-finish](arise-finish) | `/arise-finish` | 开发分支完成时的处理（merge / PR / cleanup），克隆自 [superpowers](https://github.com/obra/superpowers) |
| [arise-verify](arise-verify) | `/arise-verify` | 声称「完成」前强制验证，可作为门控组件被其他 Skill 调用 |

## 安装

### 1. 克隆仓库

```bash
git clone https://github.com/sqoder/arise-skills.git
```

### 2. 一键安装

进入你的项目目录，运行安装脚本：

```bash
cd your-project
/path/to/arise-skills/install.sh
```

脚本会**自动检测**你项目里用的 AI 工具，把 skills 复制到对应路径：

| 检测到 | 安装到 |
|--------|--------|
| `.trae/` 存在 | `.trae/skills/` |
| `.claude/` 存在 | `.claude/skills/` |
| 都没有 | `.arise/skills/`（通用） |

如果同时存在多个工具目录，会**同时复制到所有位置**。

## 开始使用

安装后，在 AI 编码助手中直接输入：

```
/arise             → 智能路由（推荐入口）
/arise-prompt      → 上下文感知提示词工程
/arise-bug-memo    → 查历史 / 记录踩坑
/arise-commit      → 检查 + 提交
/arise-habits      → 加载 / 记录习惯
/arise-finish      → 分支收尾
/arise-verify      → 完成前验证
```

**推荐用法**：直接用 `/arise`，让路由器自动决定调用哪个 Skill。各 Skill 也可以单独调用。

大部分 Skill 也会自动触发（如 `arise-commit` 在任务完成后自动执行，`arise-bug-memo` 在修 bug 前自动检索）。

> 提示：个人使用建议将 `.arise/` 加入 `.gitignore`；团队共享则保留在版本控制中。

## 架构

```
┌─────────────────────────────────────────────┐
│          arise-router（编排入口）            │
│  加载上下文 → 识别意图 → 路由到对应 Skill  │
└───────────┬───────────┬──────────┬─────────┘
            │           │          │
   ┌───────┴───┐ ┌───┴─────┐ ┌──┴───────┐
   │ arise-prompt │ │ arise-    │ │ arise-     │
   │ (提示词工程) │ │ commit   │ │ finish     │
   └────────────┘ └────┬────┘ └────┬─────┘
                        │           │
                   ┌────┴───────┴────┐
                   │  arise-verify      │
                   │  （门控组件）       │
                   └───────────────────┘
            │
┌───────────┴─────────────────────────────────┐
│       共享上下文层  .arise/                    │
├─────────────┬──────────────┬──────────────┤
│ context.md  │ habits/        │ bug-fix-       │
│ (项目元信息) │ (行为约束)    │ memory/        │
│             │                │ (历史经验)     │
└─────────────┴──────────────┴──────────────┘
```

**数据流向：**
- `arise-router` 启动时读取 context.md + habits，然后路由到具体 Skill
- `arise-prompt` 生成提示词时读取 context.md + habits + bug-memo，调用代码分析引擎（CodeGraph 或 arise-knowledge）
- `arise-knowledge` 提供统一代码分析接口，优先路由到 CodeGraph（爆炸半径/HTTP追踪/死代码），内置引擎作为 fallback
- `arise-commit` 提交前读取 habits(commit)，提交后更新 context.md 活跃状态
- `arise-bug-memo` 记录时读取 context.md 填充模块信息
- `arise-verify` 作为门控组件被 commit / finish 调用

## 共享上下文协议

所有 Skill 通过 `.arise/` 目录共享上下文：

| 文件 | 作用 | 谁写 | 谁读 |
|------|------|------|------|
| `.arise/context.md` | 项目元信息（语言/框架/约定） | router 引导创建，commit 更新活跃状态 | 所有 Skill |
| `.arise/habits/` | 用户工作习惯 | arise-habits | prompt、commit、router |
| `.arise/bug-fix-memory/` | 历史踩坑记录 | arise-bug-memo | prompt、router |

每个 Skill 都定义了「被消费协议」，说明其他 Skill 如何查询和使用它的数据。详见各 Skill 的 SKILL.md。

## 为什么有这些

vibecoding 时反复出现的痛点：

1. **同一个坑踩了又踩** —— 上次花很久解决的问题，改别的地方时又冒出来。`arise-bug-memo` 让 AI 解决新问题前先查历史。
2. **每次都要说「提交代码」** —— 太罗嗰。`arise-commit` 在任务完成后自动检查 + 合规验证 + 提交。
3. **习惯要每次重复说** —— 「用 pnpm 别用 npm」「改动最小化」… `arise-habits` 记一次，以后自动遵守。
4. **描述模糊时 AI 乱猜** —— `arise-prompt` 收集项目上下文后生成精准提示词，确认后再执行。
5. **Skills 之间不配合** —— `arise-router` 统一编排，确保正确的 Skill 在正确的时机被调用。

## 致谢

`arise-finish` 和 `arise-verify` 来自 [obra/superpowers](https://github.com/obra/superpowers)（MIT License）。

## License

MIT
