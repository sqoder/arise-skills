---
name: arise-verify
command: "arise verify"
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# 完成前验证

## 概述

**核心原则：** 先有证据，再有结论。永远如此。

**违反这条规则的字面意思就是违反这条规则的精神。**

## 可作为门控组件被其他 Skill 调用

本 Skill 不仅可以独立使用（`/arise-verify`），还可以作为其他 Skill 的**门控组件**嵌入使用：

- `arise-commit` 在提交前调用本 Skill 的门控逻辑
- `arise-finish` 在集成前调用本 Skill 的门控逻辑
- `arise-router` 在任何「完成」声明前调用本 Skill 的门控逻辑

其他 Skill 调用时，只需执行下方「门控函数」的 5 个步骤，不需要复制整个文档。

## 铁律

```
没有新鲜的验证证据，不得声称完成。
```

如果你在这条消息里没有跑过验证命令，就不能声称它通过了。

## 门控函数

```
在声称任何状态或表达满意之前：

1. 识别：什么命令能证明这个声明？
   - 如果 .arise/codegraph-context.json 存在且 `taskId` 校验通过（从 `.arise/context.md` 的「当前 taskId」读取，与 codegraph-context.json 的 `taskId` 字段对比，两者匹配）：
     - 读取 affectedTests → 精准定位要跑哪些测试文件
     - 读取 riskLevel → 决定验证强度
   - 如果不存在或不匹配：用项目的全量测试命令
2. 执行：跑完整命令（新鲜的、完整的）
3. 阅读：完整输出，检查退出码，数失败数
4. 验证：输出是否确认了声明？
   - 如果否：用证据陈述实际状态
   - 如果是：带着证据陈述声明
5. 只有这时：才能做出声明

跳过任何一步 = 撒谎，不是验证
```

### CodeGraph 精准验证策略

当 `.arise/codegraph-context.json` 存在时，门控函数的「识别」阶段升级：

#### 精准测试选择

不是泛泛的「跑所有测试」，而是根据 CodeGraph 的分析精准定位：

```
如果 affectedTests 存在且有内容：
  → 跑这些具体的测试文件，而不是全量测试
  → 示例：pnpm vitest run tests/auth.test.ts tests/e2e/login.e2e.ts

如果 affectedTests 为空或不存在：
  → 回退到项目的全量测试命令
```

#### 分层验证（riskLevel >= HIGH）

当风险等级较高时，不是一次性跑完所有测试，而是分层验证：

```
1. 先跑单元测试（影响范围内的）
2. 单元测试通过 → 跑集成测试（影响范围内的）
3. 集成测试通过 → 跑 e2e 测试（如果在爆炸范围内）
4. 任何一层失败 → 停止，报告失败层级
```

#### doNotBreak 清单验证（riskLevel >= MEDIUM 时必跑）

测试通过 ≠ 行为约束未被破坏。`doNotBreak` 是 router 在预分析时生成的「绝对不能破坏的行为清单」（来自 CodeGraph suggestions、httpChain 非目标层、bug-memo 防回归项、受影响测试隐含行为）。验证时必须额外检查：

```
如果 codegraph-context.json 存在 doNotBreak 清单（非空）：
  对每条 doNotBreak 项：
    1. 检查是否有对应测试覆盖（在 affectedTests 中找断言该行为的测试）
       - 有覆盖 → 测试通过即视为该约束未被破坏
       - 无覆盖 → 进入步骤 2
    2. 无测试覆盖的约束 → 必须人工确认或临时补一个断言测试
       - 不能仅凭"测试通过"就放行
       - 向用户报告：「doNotBreak 项 <X> 无测试覆盖，请确认本次改动未破坏该行为，或补充测试」
    3. 用户确认或补测试后 → 该约束视为通过
  所有 doNotBreak 项通过 → 才能进入第 5 步（做出声明）
```

**为什么需要这步：** 测试只能证明"被测的行为"没坏，证明不了"没被测的行为"没坏。doNotBreak 里的约束往往是没有直接测试的隐式行为（如"redirect 参数透传"、"rateLimit 中间件行为"），如果跳过这步，风险约束在规格阶段被注入、在验证阶段被遗忘。

#### 验证完成后

验证全部通过后（含 doNotBreak 检查），**verify 不清除 `.arise/codegraph-context.json`**——清除责任归后续流水线末端（arise-commit 或 arise-finish）。这确保 commit 仍能读取 blast radius 信息附加到 message 中。

## 常见失败

| 声明 | 需要 | 不够的 |
|------|------|--------|
| 测试通过 | 测试命令输出：0 失败 | 之前跑过的、「应该能过」 |
| Lint 干净 | Linter 输出：0 错误 | 部分检查、推断 |
| 构建成功 | 构建命令：exit 0 | Linter 通过、日志看着没问题 |
| Bug 已修 | 测试原始症状：通过 | 代码改了、假定修好了 |
| 回归测试有效 | 红-绿循环已验证 | 测试通过一次 |
| Agent 完成了 | VCS diff 显示有改动 | Agent 报告「成功」 |
| 需求满足 | 逐行对照清单 | 测试通过 |

## 危险信号 - 停下

- 使用「应该」「大概」「看起来」
- 在验证前表达满意（「太好了！」「完美！」「搞定！」等）
- 准备 commit/push/PR 但没验证
- 信任 agent 的成功报告
- 依赖部分验证
- 想着「就这一次」
- 累了想赶紧收工
- **任何暗示成功但没跑验证的措辞**

## 防合理化

| 借口 | 现实 |
|------|------|
| 「现在应该能跑了」 | 跑验证命令 |
| 「我很有信心」 | 信心 ≠ 证据 |
| 「就这一次」 | 没有例外 |
| 「Linter 过了」 | Linter ≠ 编译器 |
| 「Agent 说成功了」 | 独立验证 |
| 「我累了」 | 疲惫 ≠ 借口 |
| 「部分检查够了」 | 部分证明不了什么 |
| 「换了个说法所以规则不适用」 | 精神大于字面 |

## 关键模式

**测试：**
```
✅ [跑测试命令] [看到: 34/34 通过] "所有测试通过"
❌ "现在应该能过了" / "看起来没问题"
```

**回归测试（TDD 红-绿）：**
```
✅ 写测试 → 跑（通过）→ 回退修复 → 跑（必须失败）→ 恢复 → 跑（通过）
❌ "我写了回归测试"（没有红-绿验证）
```

**构建：**
```
✅ [跑构建] [看到: exit 0] "构建通过"
❌ "Linter 过了"（linter 不检查编译）
```

**需求：**
```
✅ 重读计划 → 创建清单 → 逐项验证 → 报告缺口或完成
❌ "测试过了，阶段完成"
```

**Agent 委派：**
```
✅ Agent 报告成功 → 检查 VCS diff → 验证改动 → 报告实际状态
❌ 信任 agent 报告
```

## 何时应用

**以下情况之前必须验证：**
- 任何形式的成功/完成声明
- 任何满意的表达
- 任何关于工作状态的正面陈述
- 提交、创建 PR、任务完成
- 进入下一个任务
- 委派给 agent

**规则适用于：**
- 精确短语
- 改述和同义词
- 暗示成功
- 任何暗示完成/正确的沟通
