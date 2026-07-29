# arise-skills 项目分析报告

> 本文档由 `arise-knowledge` 代码图谱引擎 + `arise-prompt` 置信度协议生成，供他人审查。
> 每条数据按以下分级标注：
> - **【确实】**：直接从工具输出或文件内容读取
> - **【待确认】**：工具产出但可能存在误差，需人工复核
> - **【推测】**：禁止写入本文档

---

## 1. 分析方法与范围

### 工具链

- 索引引擎：`arise-knowledge`（本仓库自带，TypeScript + sql.js + tree-sitter）
- 查询能力：`index_project` / `get_call_graph` / `get_dependencies` / `search_entities` / `get_module_summary`
- 协议分析：人工阅读 8 个 `SKILL.md` + `README.md`

### 索引范围 **【确实】**

- 索引目标：`/Users/wangxinglin/Desktop/skills`（仓库根目录）
- 实际命中：21 个 TypeScript 文件，全部位于 `arise-knowledge/` 子目录
- **未被索引**：其余 7 个 skill（`arise-router` / `arise-prompt` / `arise-bug-memo` / `arise-commit` / `arise-habits` / `arise-finish` / `arise-verify`）仅含 `SKILL.md`，无源码，**arise-knowledge 不分析 Markdown 协议层**——这是已知能力边界，协议层依赖关系见第 2 节人工分析

### 索引耗时 **【确实】**

- 21 文件 / 95 实体 / 826 边：149ms

---

## 2. 项目架构（协议层，人工阅读 SKILL.md） **【确实】**

### Skill 清单与角色

| Skill | 命令 | 角色 | 源码 |
|---|---|---|---|
| arise-router | `/arise` | 编排入口，路由用户意图 | 无（纯协议） |
| arise-prompt | `/arise-prompt` | 上下文感知提示词工程 | 无（纯协议） |
| arise-knowledge | MCP Server | 代码分析引擎（CodeGraph fallback） | 有（TS） |
| arise-bug-memo | `/arise-bug-memo` | 历史踩坑记录与检索 | 无（纯协议） |
| arise-commit | `/arise-commit` | 提交前检查 + 合规提交 | 无（纯协议） |
| arise-habits | `/arise-habits` | 工作习惯记录与约束注入 | 无（纯协议） |
| arise-finish | `/arise-finish` | 分支收尾（merge/PR/cleanup） | 无（纯协议） |
| arise-verify | `/arise-verify` | 完成前强制验证（门控组件） | 无（纯协议） |

### 协议依赖网络 **【确实】**

```
arise-router ──路由──→ arise-prompt
            ──路由──→ arise-bug-memo（修 bug 前必检索）
            ──路由──→ arise-verify → arise-commit（收尾链）
            ──路由──→ arise-verify → arise-finish（集成链）
            ──调用──→ arise-knowledge（代码理解任务）

arise-prompt ──读取──→ .arise/context.md / habits / bug-memo
             ──调用──→ arise-knowledge（Layer 1 上下文收集）

arise-commit / arise-finish ──调用──→ arise-verify（门控）
arise-commit ──更新──→ .arise/context.md 活跃状态
```

### 共享上下文层 **【确实】**

- `.arise/context.md` —— 项目元信息（router 引导创建，commit 更新活跃状态，所有 Skill 读取）
- `.arise/habits/` —— 用户习惯（habits 写，prompt/commit/router 读）
- `.arise/bug-fix-memory/` —— 历史踩坑（bug-memo 写，prompt/router 读）
- `.arise/codegraph-context.json` —— CodeGraph 预分析缓存（router 写，prompt/verify/commit 读，taskId 校验）

### 当前仓库状态 **【确实】**

- `.arise/` 目录**不存在** —— 共享上下文层未初始化，所有 Skill 走降级路径
- 仓库仅含 skill 定义本身，未在实际项目中运行

---

## 3. 代码图谱统计（arise-knowledge 产出） **【确实】**

### 实体分布

| 类型 | 数量 |
|---|---|
| function | 73 |
| module | 21（每文件 1 个文件级模块实体） |
| interface | 16 |
| method | 4 |
| class | 2 |

### 边分布与解析质量

| 边类型 | 总数 | 已解析 | 未解析 |
|---|---|---|---|
| calls | 760 | 162 | 598 |
| imports | 66 | 66 | 0 |
| **合计** | **826** | **228 (27.6%)** | **598** |

### 解析率分项 **【确实】**

| 导入类型 | 总数 | 已解析 | 解析率 | 说明 |
|---|---|---|---|---|
| 相对导入（`./` / `../`） | 62 | 62 | **100%** | 含 TS ESM `.js` 扩展名导入 |
| bare specifier（`fs` / `react` 等） | 29 | 0 | 0% | 外部包，**正确行为不解析** |
| 变量别名（`const x = new Y()`） | 36 | 4 | 11.1% | → 待确认项 7.2 |

### 未解析 call 边构成 **【待确认】**

598 条未解析 `calls` 边中，绝大多数为外部库调用（`db.exec` / `String(...)` / `console.log` / `fs.readFileSync` 等），这些**本就不应解析**。当前无法区分"应解析但失败"与"不应解析"——这是 `arise-knowledge` 的已知能力缺口（无外部依赖标记）。

---

## 4. 核心调用链分析 **【确实】**

### 入口：`indexProject`（src/graph/builder.ts）

```
callers (4):
  ← createServer         @ src/server.ts         （MCP tool 入口）
  ← main                 @ tests/alias-resolution.ts
  ← main                 @ tests/project-analysis.ts
  ← main                 @ tests/smoke.ts

callees (2):
  → acquireLock          @ src/storage/db.ts     （文件锁，防多进程并发写）
  → doIndexProject       @ src/graph/builder.ts  （实际索引逻辑）
```

### 索引核心：`resolveEdges`（src/graph/builder.ts）

```
callers (1):
  ← doIndexProject       @ src/graph/builder.ts

callees (3):
  → resolveImportEdges   @ src/graph/builder.ts  （先解析 imports，填充 imports 表）
  → buildImportMap       @ src/graph/builder.ts  （构建 alias → targetFile 映射）
  → resolveCall          @ src/graph/builder.ts  （作用域感知调用解析）
```

**执行顺序约束**：`resolveImportEdges` 必须先于 `resolveCall` 执行，否则 `buildImportMap` 返回空映射，Strategy 3（qualified call via imports）失效。

### 调用解析：`resolveCall`（src/graph/builder.ts）

```
callers (1):
  ← resolveEdges         @ src/graph/builder.ts

callees (2):
  → get                  @ src/graph/query.ts    ← 【待确认】疑似假阳性，见第 7 节
```

**解析策略优先级**：
1. `this./self./super.` → 同文件 method
2. qualified call（`obj.method`）→ 通过 importMap 查 `obj` 的来源文件，在目标文件找 `method`
3. 同文件 exact match
4. 全局 exact match（最低置信度，兜底）

---

## 5. 依赖关系分析 **【确实】**

### `src/graph/builder.ts`（图构建核心）

```
imports (10):
  → src/graph/types.ts
  → src/storage/db.ts
  → src/indexer/scanner.ts
  → src/indexer/parser.ts
  → src/indexer/extractor.ts
  → src/embeddings/search.ts
  （+ 4 个 bare specifier：sql.js / crypto / fs / path）

imported by (4):
  ← src/server.ts              （MCP tool 调用入口）
  ← tests/alias-resolution.ts
  ← tests/project-analysis.ts
  ← tests/smoke.ts
```

### `src/server.ts`（MCP 入口）

```
imports (9):
  → src/graph/builder.ts       （indexProject）
  → src/graph/query.ts         （getCallGraph / getDependencies）
  → src/indexer/parser.ts      （initParser）
  → src/embeddings/search.ts   （searchSimilar）
  → src/graph/types.ts         （Language 类型）
  （+ 4 个 bare specifier）

imported by (1):
  ← src/index.ts               （startServer 启动入口）
```

### `src/storage/db.ts`（数据库 + 文件锁）

```
imports (4):
  → src/storage/schema.ts      （initSchema / SCHEMA_VERSION）
  （+ 3 个 bare specifier：sql.js / path / fs）

imported by (4):
  ← src/graph/builder.ts
  ← src/graph/query.ts
  ← src/embeddings/search.ts
  ← src/server.ts
```

---

## 6. 热点函数分析（按入度排序） **【待确认】**

> 以下为 `calls` 边入度 Top 10。`calls` 边的解析率为 27.6%，未解析边不参与统计，因此实际入度可能更高。

| 入度 | 函数 | 文件 | 判定 |
|---|---|---|---|
| 18 | `entityId` | src/graph/types.ts | **【确实】** 实体 ID 生成工具，被全项目调用 |
| 17 | `get` | src/graph/query.ts | **【待确认】** 疑似 `Map.get()` / `db.exec` 误解析的累积，非真实热点 |
| 12 | `section` | tests/project-analysis.ts | **【确实】** 测试脚本辅助函数，**分析噪声**，非项目代码 |
| 12 | `findParentOfType` | src/indexer/extractor.ts | **【确实】** AST 遍历工具，被 extractor 各语言分支调用 |
| 8 | `getFirstLine` | src/indexer/extractor.ts | **【确实】** 签名提取工具 |
| 7 | `getDatabase` | src/storage/db.ts | **【确实】** DB 单例获取 |
| 7 | `getDependencies` | src/graph/query.ts | **【确实】** MCP tool 实现 |
| 7 | `getCallGraph` | src/graph/query.ts | **【确实】** MCP tool 实现 |
| 6 | `validateProjectPath` | src/server.ts | **【确实】** MCP tool 入口校验 |
| 6 | `initParser` | src/indexer/parser.ts | **【确实】** tree-sitter 初始化 |

### 噪声剔除建议

- `section`（12 入度）：测试脚本辅助函数，应从热点统计中排除（或索引时排除 `tests/` 目录）
- `get`（17 入度）：若确认是误解析，实际热点应剔除此项

---

## 7. 已知问题与待确认项

### 7.1 【待确认·假阳性】`Map.get()` 误解析为 `query.ts::get`

**现象**：`resolveCall` 函数内部调用 `fileImports.get(qualifier)`（Map 方法），被解析到 `src/graph/query.ts::function::get`。

**根因推测**（需人工确认）：
- `fileImports.get(...)` 的 `funcNode.text = "fileImports.get"`
- `resolveCall` split 后 qualifier=`fileImports`，simpleName=`get`
- `fileImports` 是局部变量，不在 importMap 中
- Strategy 4 全局兜底：`SELECT id FROM entities WHERE name = 'get'` 命中 `query.ts` 中名为 `get` 的函数

**影响**：`get` 以 17 入度位列热点第 2，污染热点分析。

**建议修复方向**：
- Strategy 4 全局兜底应对常见方法名（`get`/`set`/`has`/`delete`/`length` 等）加白名单，不参与全局匹配
- 或：Strategy 4 仅当 simpleName 在项目中有唯一定义时才匹配，多候选时不解析

### 7.2 【待确认】变量别名解析率 11.1%

**现象**：36 个变量别名（`const x = new Y()` / `const x = importedY`）中仅 4 个解析成功。

**可能原因**（需人工确认）：
- 大部分变量赋值的右侧 `Y` 可能是 bare specifier 导入的类（如 `new Database()`），bare specifier 不解析导致变量别名也无法解析
- 部分可能是局部类（同文件定义），应能解析但未命中

**建议复核**：抽样检查 32 个未解析项，区分"不应解析"与"应解析但失败"。

### 7.3 【确实·已修复】TS ESM `.js` 扩展名导入

**原问题**：TypeScript ESM 项目普遍使用 `import { foo } from './bar.js'`（编译后扩展名），原 `resolveImportEdges` 把 `.js` 当路径一部分，生成 `bar.js.ts` 等不存在的候选路径，导致相对导入解析率仅 8.6%。

**修复**：解析前先剥离 `.js` / `.jsx` / `.mjs` / `.cjs` / `.ts` / `.tsx` 扩展名，再尝试 TS 扩展名候选。

**修复效果**：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 相对导入解析率 | 8.6% (5/58) | **100% (62/62)** |
| imports 表总解析率 | 7.4% (9/122) | **52.0% (66/127)** |
| `builder.ts` imported by | 0 | **4** |

### 7.4 【确实·能力边界】Markdown 协议层不可分析

`arise-knowledge` 仅支持 TS/JS/Python/Go/Rust 源码，无法分析 8 个 SKILL.md 之间的协议依赖。第 2 节的协议网络为人工阅读产出。

**影响**：无法用工具验证"协议自洽性"（如 A 调用 B 的 X，B 是否定义了 X）。本次审查中协议层问题（如 `taskId` 传递机制、状态字段一致性）需人工复核。

### 7.5 【确实·能力边界】无外部依赖标记

598 条未解析 `calls` 边中，无法区分"外部库调用（不应解析）"与"项目内调用但解析失败（应解析）"。

**影响**：`calls` 边解析率 27.6% 的数字不能直接用于评估解析质量——真实质量取决于"应解析而未解析"的比例，当前无数据。

---

## 8. 审查要点清单

供审查者快速定位需要复核的声明：

| # | 声明 | 置信度 | 复核方式 |
|---|---|---|---|
| 1 | 8 个 skill 的协议依赖网络 | 确实 | 对照各 SKILL.md 的「何时触发」「被消费协议」章节 |
| 2 | `.arise/` 目录不存在 | 确实 | `ls /Users/wangxinglin/Desktop/skills/.arise` |
| 3 | 相对导入解析率 100% | 确实 | 重跑 `tests/supplementary-queries.ts` |
| 4 | `resolveCall` 的 callees 含假阳性 | 待确认 | 查 `src/graph/builder.ts` 中 `resolveCall` 函数体内 `fileImports.get(...)` 调用 |
| 5 | `get` @ query.ts 17 入度是噪声 | 待确认 | 查 `src/graph/query.ts` 是否存在名为 `get` 的函数定义 |
| 6 | 变量别名 11.1% 解析率合理与否 | 待确认 | 抽样 32 个未解析项，区分外部类 vs 局部类 |
| 7 | `indexProject` 调用链正确 | 确实 | 对照 `src/graph/builder.ts` 与 `src/server.ts` 源码 |
| 8 | `.js` 扩展名 bug 修复有效 | 确实 | alias-resolution + smoke 测试 10/10 + 11/11 通过 |

---

## 9. 工具能力评估（供审查者判断数据可信度）

### `arise-knowledge` 能提供的 **【确实】**

- 文件级实体清单（函数/类/方法/接口，含签名）
- 相对导入的依赖图（imports + imported_by，100% 解析）
- 项目内调用图（作用域感知，含 import alias / 变量别名 / 重命名导入）
- 热点函数排序（按已解析 calls 边入度）

### `arise-knowledge` 不能提供的 **【确实】**

- 爆炸半径分析（impact_analysis）—— CodeGraph 独有
- HTTP 请求流追踪（trace_http_chain）—— CodeGraph 独有
- 死代码检测（find_dead_code）—— CodeGraph 独有
- 外部库调用解析（bare specifier 不解析）
- Markdown 协议层分析（仅支持 5 种源码语言）
- "应解析而未解析"的比例（无外部依赖标记）

### 本次修复的 import alias 解析能力 **【确实】**

通过 `tests/alias-resolution.ts` 验证（10/10 通过）：

- `service.foo()` → `AuthService.foo`（实例变量方法调用）
- `authInit()` → `authInit`（命名导入直接调用）
- `authNs.authInit()` → `authInit`（namespace 导入属性访问）
- `rs.foo()` → `AuthService.foo`（重命名导入 `as RenamedService`）
- `AuthService.create()` → `AuthService.create`（静态方法调用）
- 冲突消歧：两个类各有 `foo()` 方法，`a.foo()` / `b.foo()` 各自解析到正确目标，零假阳性

---

## 附录：复现命令

```bash
cd /Users/wangxinglin/Desktop/skills/arise-knowledge

# 完整分析
npx tsx tests/project-analysis.ts

# 补充查询（解析率分项、依赖图、原始边）
npx tsx tests/supplementary-queries.ts

# import alias 解析能力验证（10/10）
npx tsx tests/alias-resolution.ts

# 基础冒烟
npx tsx tests/smoke.ts
```

---

**文档生成时间**：2026-07-25
**工具版本**：arise-knowledge 0.1.0（schema v2，含 imports 表）
**索引统计**：21 文件 / 95 实体 / 826 边 / 149ms
