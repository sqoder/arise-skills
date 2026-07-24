# arise-skills

一组用于 AI 编码助手（Claude Code / TRAE / Codex / Cursor 等）的 Skills，解决 vibecoding 中的常见痛点。

## 包含的 Skills

| Skill | 命令 | 作用 |
|---|---|---|
| [arise-bug-memo](arise-bug-memo) | `/arise-bug-memo` | 记录踩过的坑（难修 bug、配置陷阱、文档 gotcha、工具怪癖），下次遇到类似问题前自动检索历史 |
| [arise-commit](arise-commit) | `/arise-commit` | 写完代码自动提交（跑 lint/typecheck 通过才提交），不用每次都说「我要提交」 |
| [arise-habits](arise-habits) | `/arise-habits` | 记录你的工作习惯，基于 [agentmemory](https://github.com/jayzeng/agentmemory) 语义搜索 + 自动注入，习惯再多也不会乱 |
| [arise-finish](arise-finish) | `/arise-finish` | 开发分支完成时的处理（merge / PR / cleanup），克隆自 [superpowers](https://github.com/obra/superpowers) |
| [arise-verify](arise-verify) | `/arise-verify` | 声称「完成」前强制验证，避免假完成，克隆自 [superpowers](https://github.com/obra/superpowers) |
| [arise-prompt](arise-prompt) | `/arise-prompt` | 输入简短描述，生成结构化优化提示词，确认后执行 |

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

### 3. 开始使用

安装后，在 AI 编码助手中直接输入：

```
/arise-bug-memo    → 查历史 / 记录踩坑
/arise-commit      → 检查 + 提交
/arise-habits      → 加载 / 记录习惯
/arise-finish      → 分支收尾
/arise-verify      → 完成前验证
/arise-prompt      → 优化提示词
```

大部分 Skill 也会自动触发（如 `arise-commit` 在任务完成后自动执行，`arise-bug-memo` 在修 bug 前自动检索）。

> 提示：个人使用建议将 `.arise/` 加入 `.gitignore`；团队共享则保留在版本控制中。

## Skill 协作关系

```
arise-bug-memo ←→ arise-habits
│  习惯可引用 bug 检索流程（如「修 bug 前先查历史」）
│
arise-commit ←→ arise-verify
│  提交前先验证，验证通过才提交
│
arise-finish ←→ arise-verify
   分支集成前必须测试全绿
```

- `arise-habits` 可以定义「修 bug 前先查 arise-bug-memo」这样的习惯，串联两个 Skill。
- `arise-commit` 的合规检查与 `arise-verify` 理念一致：先验证，再行动。
- `arise-finish` 的第 1 步强制跑测试，与 `arise-verify` 的铁律呼应。

## 为什么有这些

vibecoding 时反复出现的痛点：

1. **同一个坑踩了又踩** —— 上次花很久解决的问题（bug、配置陷阱、文档 gotcha），改别的地方时又冒出来。`arise-bug-memo` 让 AI 解决新问题前先查历史。
2. **每次都要说「提交代码」** —— 太啰嗦。`arise-commit` 在任务完成后自动检查 + 合规验证 + 提交。
3. **习惯要每次重复说** —— 「用 pnpm 别用 npm」「改动最小化」… `arise-habits` 记一次，以后自动遵守。

## 致谢

`arise-finish` 和 `arise-verify` 来自 [obra/superpowers](https://github.com/obra/superpowers)（MIT License）。

## License

MIT
