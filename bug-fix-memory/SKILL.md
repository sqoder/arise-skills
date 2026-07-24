---
name: "bug-fix-memory"
description: "Records hard-to-fix bug resolutions in the project to prevent regressions. Invoke when starting to debug a new issue (to check history first) or after fixing a tricky bug (to log it)."
---

# Bug Fix Memory

Vibecoding 时难修的 bug 修完后，经常在后续改动中又冒出来。这个 skill 在**当前项目**内维护一份「难修 bug 修复档案」，让 AI 在动手修新问题前先查历史避免重蹈覆辙，修完难 bug 后沉淀经验。

## Storage Layout

项目级存储，放在当前项目的 `.trae/bug-fix-memory/`：

- `log.md` — 索引文件，所有记录按时间倒序，每条一行摘要 + 链接到详情。**AI 检索时先读这个**。
- `entries/YYYYMMDD-short-slug.md` — 每个 bug 的详细档案。

目录不存在时，首次记录自动创建。

## When to Invoke

### 1. 开始排查新 bug 时 → 先检索历史（防回归）

当用户描述一个新问题、报错、或开始排查 bug 时，**在动手修复前**必须做：

1. 读取 `.trae/bug-fix-memory/log.md`（文件不存在则跳过，说明还没有历史记录）。
2. 按关键词 / 症状 / 涉及文件匹配是否有相似历史记录。
3. 若有命中，读取对应 `entries/` 详情，在动手修当前问题**之前**告诉用户：
   - "这类问题之前踩过坑，根因是 X，注意 Y"
   - 列出原 entry 里的「防回归检查项」，避免本次修复又把上次的坑踩回来。

### 2. 修完难 bug 后 → 记录（手动 + 自动提示）

- **手动**：用户说「记一下这个 bug」「记录到 bug-fix-memory」时，立即记录。
- **自动提示**：当 AI 判断本次 bug 属于「难修」（满足任一即可：排查 ≥ 3 轮、反复试错、根因非显而易见、涉及多个文件联动、用户明确表达过困惑/耗时），在修复完成后主动问一句：

  > 这个 bug 排查挺久的，要不要记到 bug-fix-memory，避免以后回归？

  用户同意后再写。用户拒绝就不要写。

**不要记录简单 bug**（一行 typo、明显配置缺失、文档说明缺失等），避免噪音。

## How to Record

1. 确认 `.trae/bug-fix-memory/` 与 `entries/` 子目录存在，不存在则创建。
2. 用下方模板生成 entry 文件：`entries/YYYYMMDD-short-slug.md`
   - `YYYYMMDD` 用当天日期
   - `short-slug` 用 bug 核心关键词，kebab-case，≤ 5 个词
3. 在 `log.md` **顶部**插入一行索引（最新在上）：
   ```
   - YYYY-MM-DD | [标题](entries/YYYYMMDD-short-slug.md) | 涉及文件 | 关键词1, 关键词2
   ```
4. 简短告知用户已记录，并附 entry 文件路径。

## Entry Template

```markdown
# <bug 标题>

- **日期**: YYYY-MM-DD
- **状态**: 已修复
- **关键词**: ...
- **涉及文件**: path/to/file.ts, path/to/other.ts
- **commit**: <hash>（如有）

## 症状
<用户看到的现象、报错信息、触发条件>

## 根因
<真正的根因，不是表象。为什么会发生。>

## 修复方案
<做了什么改动，为什么这样改。贴关键文件位置即可，不要贴整段 diff。>

## 防回归检查项
- [ ] <检查点1：以后改 X 时要确认 Y 没被破坏>
- [ ] <检查点2：...>

## 回归记录
<!-- 如果这个 bug 后来又出现了，在这里追加，不要新开 entry -->
```

## When a Logged Bug Reappears（回归处理）

如果检索发现某个已记录的 bug 又出现了：

1. **不要新开 entry**，打开原 entry，在「回归记录」下追加一行：
   `- YYYY-MM-DD: 又出现，原因是 <...>`
2. 在 `log.md` 把该条状态从「已修复」改为「已回归过」。
3. 重新审视「防回归检查项」是否需要补充——既然又犯了，说明检查项不够。

## Guidelines

- 记录写**根因**而不是现象，写**为什么**而不是改了哪一行。
- 「防回归检查项」必须是**可执行的检查动作**，不是泛泛的「小心一点」。
- `log.md` 保持精简，每条一行；详情放 entry 里。
- 只记录「难修」的 bug，判断标准见上文。
- 不要把整段 diff 贴进 entry，只贴关键文件路径，diff 在 git 里有。
- 检索历史时优先按「涉及文件」和「关键词」匹配，这两者比症状描述更稳定。
