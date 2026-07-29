---
name: "arise-router"
command: "arise"
description: "The orchestration entry point for all arise-skills. Loads project context, routes user intent to the appropriate Skill(s), and ensures cross-Skill collaboration. Invoke at session start or when unsure which Skill to use."
---

# 编排入口

所有 arise-skills 的调度中心。负责加载项目上下文、识别用户意图、决定调用哪些 Skill 以及调用顺序。

## 何时触发

- 会话启动时自动加载（读取上下文，安静遵守）
- 用户输入 `/arise` 时显式调用
- 用户给出一个任务但不确定该用哪个 Skill 时
- 任何 Skill 需要协作时，通过此处定义的协议进行

## 启动流程

```
会话开始
  ↓
读取 .arise/context.md（存在则加载，不存在则引导创建）
  ↓
读取 .arise/habits/index.md（存在则加载相关习惯约束）
  ↓
安静就绪，等待用户指令
  ↓
用户输入任务描述
  ↓
路由决策 → 调用对应 Skill（或 Skill 组合）
```

## 路由决策表

根据用户意图，决定调用路径：

| 意图信号 | 路由路径 | 说明 |
|----------|----------|------|
| 模糊描述 / 「帮我写个提示词」 | → arise-prompt | 需要先细化再执行 |
| 报错 / bug / 「不工作了」 | → arise-bug-memo(检索) → 执行修复 | 先查历史，再动手 |
| 「帮我记住」/ 重复纠正 | → arise-habits(记录) | 沉淀习惯 |
| 代码改完 / 「好了」/ 任务收尾 | → arise-verify → arise-commit | 先验证，再提交 |
| 「合并」/「PR」/「分支完了」 | → arise-verify → arise-finish | 先验证，再集成 |
| 明确的编码指令 | → 直接执行（遵守 habits 约束） | 无需路由 |

**铁律：**
- 任何涉及修 bug 的任务，执行前必须先检索 arise-bug-memo
- 任何涉及「完成」声明的任务，必须先过 arise-verify
- 任何执行过程中，都遵守已加载的 habits 约束
- 任何涉及代码理解的任务，优先调用代码分析引擎（CodeGraph → arise-knowledge → 文件搜索）
- 拒绝孤立文档润色：遇到用户提供的图片/截图/文档/需求，必须深度结合项目已有代码库、类型定义与记忆库生成工程规格，严禁仅针对文档做文字润色

## 代码分析引擎集成（双后端）

arise-skills 支持两个代码分析后端，按优先级自动选择：

```
检测逻辑：
1. 检查 code-graph / code-graph-mcp MCP server 是否可用
   → 有：使用 CodeGraph（完整能力：19语言/爆炸半径/HTTP追踪/死代码/混合搜索）
2. 没有 CodeGraph，检查 arise-knowledge MCP server 是否可用
   → 有：使用 arise-knowledge（基础能力：5语言/调用图/依赖图/向量搜索）
3. 都没有
   → 回退到文件搜索（grep/glob/read）
```

### 能力映射表

根据当前可用的后端，选择对应的 tool：

| 场景 | CodeGraph tool | arise-knowledge fallback | 无后端回退 |
|------|----------------|--------------------------|------------|
| 理解改动影响范围 | `impact_analysis` | `get_call_graph(depth=2)` | 手动追踪 |
| 追踪 HTTP 请求流 | `trace_http_chain` | 无 | 搜索路由文件 |
| 语义搜索代码 | `semantic_code_search` | `search_code` | grep 关键词 |
| 项目全局概览 | `project_map` | `get_module_summary` | 读目录结构 |
| 调用图查询 | `get_call_graph` | `get_call_graph` | 手动搜索 |
| 依赖关系 | `dependency_graph` | `get_dependencies` | 搜索 import |
| 找死代码 | `find_dead_code` | 无 | 无 |
| 找相似代码 | `find_similar_code` | `search_code` | 无 |
| 符号名查找 | `get_ast_node` | `search_entities` | grep 函数名 |
| 找引用/调用者 | `find_references` | `get_call_graph(direction=callers)` | grep 符号名 |

### 使用场景

| 任务类型 | 应调用什么 | 说明 |
|----------|--------------|------|
| 开始新任务，需要理解代码 | `project_map` / `get_module_summary` | 快速了解全貌 |
| 修改函数前 | `impact_analysis` / `get_call_graph` | 知道改了会炸多大 |
| 理解文件间依赖 | `dependency_graph` / `get_dependencies` | 看导入关系 |
| 用户描述模糊 | `semantic_code_search` / `search_code` | 用自然语言找代码 |
| 涉及 REST API | `trace_http_chain` | 追踪完整请求流 |
| 清理/重构 | `find_dead_code` | 找未使用的代码 |
| 首次对新项目工作 | `index_project`（arise-knowledge） | CodeGraph 自动索引，无需手动 |

### 注意事项

- **CodeGraph 是首选引擎**：工作流设计围绕 CodeGraph 的完整能力展开，arise-knowledge 仅为降级保底。
- **自动降级**：如果 CodeGraph 某个 tool 调用失败，自动回退到 arise-knowledge 的对应 tool。
- **不重复调用**：同一个信息不要同时调用两个后端，只用优先级最高的那个。
- **CodeGraph 自动索引**：CodeGraph 安装后会自动监听文件变更并增量更新，不需要手动触发。
- **arise-knowledge 首次索引**：如果检测到 arise-knowledge 可用但调用返回「not found / run index_project」类提示，说明尚未建立索引。此时应：
  1. 告知用户：「arise-knowledge 需要先索引项目才能提供代码分析，是否现在索引？」
  2. 用户同意后调用 `index_project(path=项目根目录)`
  3. 索引完成后继续原任务

## CodeGraph 预分析（风险驱动编排）

当路由决策确定任务涉及代码改动时，在动手之前先做 CodeGraph 预分析：

```
路由决策完成（确定要动代码）
  ↓
检测 CodeGraph 是否可用
  ↓ 可用
调用 impact_analysis(涉及的符号/文件)
  ↓
如果任务涉及 REST API → 追加调用 trace_http_chain(路由路径)
  ↓
根据 riskLevel 选择编排策略
  ↓
将结果写入 .arise/codegraph-context.json（会话级缓存）
  ↓
按策略执行任务
```

如果 CodeGraph 不可用：跳过预分析，按默认策略（normal）执行。

### 风险驱动编排策略表

根据 CodeGraph 返回的 `riskLevel` 调整编排策略：

| riskLevel | 策略（strategy） | 编排行为 |
|-----------|------------------|----------|
| LOW | `normal` | 正常执行，完成后 verify + commit |
| MEDIUM | `normal` | 执行前告知受影响范围，完成后必跑受影响测试 |
| HIGH | `stepped` | 分步执行（每步有验证点），明确列出「不可破坏清单」 |
| CRITICAL | `confirm-first` | 先暂停，向用户展示完整爆炸半径，用户确认后才继续 |

### 任务拆分判断

```
如果 blastRadius.totalAffected > 20 且任务涉及多个不相关模块：
  → 建议用户拆分为多个子任务，每个子任务限定在一个模块内
  → 展示哪些模块受影响、建议拆分方式

如果 trace_http_chain 覆盖 3+ 层且任务涉及 API 变更：
  → 强制要求分层验证：先改最底层，验证通过后再改上层
```

### CodeGraph Context 缓存协议

路由完成后将预分析结果写入 `.arise/codegraph-context.json`（会话级缓存，不提交到 git）：

```json
{
  "taskId": "20260725-login-captcha",
  "timestamp": "2026-07-25T12:00:00Z",
  "task": "加登录验证码",
  "symbols": ["login", "loginHandler"],
  "impact": {
    "target": "login",
    "riskLevel": "HIGH",
    "blastRadius": {
      "directCallers": 5,
      "totalAffected": 33,
      "affectedFiles": ["src/api/auth.ts", "src/middleware/session.ts"],
      "affectedTests": ["tests/auth.test.ts", "tests/e2e/login.e2e.ts"],
      "affectedTestCount": 47
    },
    "suggestions": ["确保向后兼容", "增加中间件行为不变的断言"]
  },
  "httpChain": {
    "route": "POST /api/login",
    "chain": [
      {"layer": "middleware", "name": "rateLimit", "file": "src/middleware/rate.ts"},
      {"layer": "handler", "name": "loginHandler", "file": "src/api/auth.ts"},
      {"layer": "service", "name": "UserService.verify", "file": "src/services/user.ts"}
    ]
  },
  "riskLevel": "HIGH",
  "strategy": "stepped",
  "doNotBreak": ["redirect 参数传递", "rateLimit 中间件行为"]
}
```

**生命周期**：
- **写入**：arise-router 在预分析完成后写入（生成 `taskId` = 日期 + 任务 slug，如 `20260725-login-captcha`）
- **taskId 同步**：router 写入 codegraph-context.json 后，同步更新 `.arise/context.md` 的「活跃状态」区域中的「当前 taskId」字段。这是各 Skill 获取「当前 taskId」的唯一来源
- **读取**：arise-prompt / arise-bug-memo / arise-verify / arise-commit 各自读取所需字段
- **读取前校验**：各 Skill 读取时：
  1. 从 `.arise/context.md` 的「当前 taskId」字段获取当前任务 ID
  2. 与 codegraph-context.json 的 `taskId` 字段对比
  3. 不匹配（或 context.md 无 taskId / codegraph-context.json 不存在）→ 视为「不存在」，按降级逻辑运行
  4. 匹配 → 正常读取业务字段
- **清除**：流水线末端执行者负责清除（arise-commit 提交完成后 或 arise-finish 集成完成后），同时清空 context.md 中的「当前 taskId」字段
- **不存在时**：所有 Skill 按原有逻辑降级运行，不报错

### doNotBreak 清单生成规则

`doNotBreak` 是风险约束的核心——列出本次改动中绝对不能破坏的行为。来源：

1. CodeGraph `impact.suggestions` 中的关键约束
2. `httpChain` 中非本次修改目标的层（链路中其他层的接口不能变）
3. arise-bug-memo 命中的历史条目的「防回归检查项」
4. 受影响测试隐含的行为（有测试 = 有预期行为）

## 共享上下文协议（Context Protocol）

> 协议版本：v1。如未来修改文件结构，在 context.md 头部更新版本标记（如 `<!-- arise-protocol-v2 -->`），并同步更新所有 Skill 的读取逻辑。

### .arise/context.md 标准结构

```markdown
<!-- arise-protocol-v1 -->
# 项目上下文

## 基本信息
- **语言**: <主语言>
- **框架**: <框架名称和版本>
- **包管理器**: <npm/pnpm/yarn/其他>
- **测试框架**: <vitest/jest/pytest/其他>
- **构建工具**: <vite/webpack/turbopack/其他>

## 约定
- **commit 语言**: <中文/英文/跟随仓库>
- **分支策略**: <feature/* → main / trunk-based / 其他>
- **代码风格**: <有 eslint 配置 / 无>
- **类型检查**: <TypeScript strict / 宽松 / 无>

## 目录结构概要
- `src/` — 源码
- `tests/` — 测试
- <其他关键目录>

## 活跃状态（AI 自动维护，无需手动编辑）
- **当前分支**: <branch name>
- **当前 taskId**: <router 写入，格式 YYYYMMDD-task-slug，与 codegraph-context.json 的 taskId 字段一致；不存在 codegraph-context.json 时为空>
- **最近任务**: <简述>
- **上次更新**: <日期>
```

### 首次引导

当 `.arise/context.md` 不存在时，问以下问题自动生成：

1. 「这个项目用什么语言和框架？」（或尝试从 package.json / pyproject.toml / go.mod 等自动检测）
2. 「用什么包管理器？」（或从 lock 文件自动检测）
3. 「commit message 习惯用中文还是英文？」（或从 git log 自动检测）

能自动检测的就自动检测，检测不到的才问。生成后告知用户：「已创建 .arise/context.md，后续所有 Skill 会读取这个文件。你可以随时手动修改。」

### 活跃状态更新

每次 arise-commit 或 arise-finish 执行后，自动更新 context.md 中的「活跃状态」区域（当前分支、最近任务、上次更新日期）。

### 文件不存在的统一降级协议

各 Skill 对 `.arise/context.md` 不存在时的处理必须遵循以下三段式降级（其他文件如 habits/bug-memo 仍按各自的「文件不存在则跳过」原则）：

1. **自动推断**：尝试从项目文件（package.json / pyproject.toml / go.mod / Cargo.toml / 目录结构 / 最近 git log）推断出能推断的字段
2. **引导创建**：推断失败的字段，问用户 1-3 个问题（不要逐字段问），生成 context.md
3. **降级运行**：用户拒绝创建 → 按默认逻辑（如 commit 语言从 git log 检测、包管理器从 lock 文件检测）独立工作，不阻塞、不报错、不重复引导

**禁止行为**：
- 各 Skill 各自引导用户创建 context.md（会重复打扰）——引导责任归 router，其他 Skill 走步骤 3
- 用户拒绝后仍然每次都问——一旦用户拒绝，本次会话内不再引导

## Skill 间数据流协议

### habits 被消费协议

其他 Skill 读取 habits 的标准方式：

1. 读取 `.arise/habits/index.md`
2. 按当前任务的标签（commit / code-style / workflow / tools）过滤
3. 只读匹配的类别文件获取详情
4. 将习惯作为「约束条件」注入当前 Skill 的执行逻辑

### bug-memo 检索协议

其他 Skill 检索 bug-memo 的标准方式：

1. 读取 `.arise/bug-fix-memory/log.md`
2. 按以下维度匹配：
   - 关键词匹配（用户描述中的关键词 vs 条目关键词）
   - 文件路径匹配（当前涉及的文件 vs 条目涉及文件）
   - 模块匹配（按模块索引区定位）
3. 命中时：读取对应 entry 详情，提取「根因」和「防回归检查项」
4. 将结果作为「历史经验」注入当前任务的上下文

### verify 门控协议

其他 Skill 调用 verify 的标准方式：

在声称「完成」之前，执行 arise-verify 的核心逻辑：
1. 识别：什么命令能证明这个声明？
2. 执行：跑完整命令
3. 阅读：完整输出，检查退出码
4. 验证：输出是否确认了声明？
5. 只有通过后才能继续后续步骤

## 注意事项

- **不要复述上下文**：加载 context.md 和 habits 后安静执行，不要跟用户背诵一遍。
- **路由要快**：不要过度分析，大多数情况下路由是显而易见的。只在真正不确定时才问用户。
- **不要强制用户走 /arise**：各 Skill 仍然可以直接调用（如 `/arise-commit`），router 只是提供更智能的自动调度。
- **context.md 是建议，不是强制**：如果用户不想创建，所有 Skill 仍然可以独立工作，只是少了共享上下文的好处。
- **活跃状态是 AI 维护的**：用户不需要手动更新「活跃状态」区域，AI 在执行 commit/finish 后自动更新。

## 能力边界检测

arise-skills 是轻量工具，不是万能系统。当任务超出能力边界时，应主动告知用户而不是硬做。

### 超出边界的信号

| 信号 | 说明 | 应对 |
|------|------|------|
| 任务涉及 5+ 个服务/模块的联动 | 超出单次对话的上下文容量 | 建议拆解为多个子任务 |
| 需要理解 3+ 种语言的交互 | 跨语言调用链复杂度高 | 建议按语言边界拆分 |
| bug-memo 超过 100 条且检索命中多条但不确定哪个相关 | 关键词匹配已退化 | 建议用户手动切入相关 entry，或考虑引入更强的检索工具 |
| 任务需要理解完整的调用图/依赖图 | 超出 markdown 索引的能力 | 建议用 AI 工具的内置能力（LSP、代码搜索）而不是依赖 .arise/ |
| context.md 无法描述项目复杂度 | monorepo + 多语言 + 多团队 | 建议按子项目各建独立的 context，或引入更专业的工具（如 MCP server） |

### 建议话术

当检测到边界时，说：

> 这个任务涉及 <N> 个模块的联动，超出了我在单次对话中能可靠处理的范围。建议：
> 1. 拆解为 <子任务 A> + <子任务 B>
> 2. 或者用 AI 工具的内置代码搜索能力先建立全局调用图

**原则：诚实比硬做重要。** 硬做超过能力边界的任务 = 产出不可靠的结果。主动告知限制，帮用户找到正确的工具或拆解方式，比假装能搞定更有价值。
