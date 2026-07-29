---
name: "arise-knowledge"
command: "arise knowledge"
description: "Built-in code analysis engine (TypeScript, 5 languages). Serves as fallback when CodeGraph is unavailable. Provides call graph, dependency graph, and optional vector search. Routing logic lives in arise-router."
---

# 内置代码分析引擎

CodeGraph 不可用时的 fallback 引擎。基于 tree-sitter AST 解析 + SQLite 图存储，提供基础代码理解能力。

- **定位**：独立 MCP Server，不是路由层。后端选择/降级逻辑在 arise-router 中
- **能力**：5 语言（TS/JS/Python/Go/Rust）、调用图、依赖图、可选向量搜索
- **限制**：无爆炸半径分析、无 HTTP 链路追踪、无死代码检测（这些是 CodeGraph 独有能力）

## 后端检测优先级

```
1. 检测 code-graph / code-graph-mcp MCP server 是否可用
   → 有：使用 CodeGraph（完整能力）
2. 检测 arise-knowledge MCP server 是否可用
   → 有：使用 arise-knowledge（基础能力）
3. 都没有
   → 回退到文件搜索（grep/glob/read）
```

检测方式：尝试调用对应 MCP server 的 tool，能响应就是可用。

## 统一能力映射

不管底层用哪个后端，对外暴露统一的语义。其他 Skill（arise-router、arise-prompt）按这个表调用：

| 需求 | CodeGraph tool | arise-knowledge fallback | 无后端回退 |
|------|----------------|--------------------------|------------|
| **理解改动影响范围** | `impact_analysis` → 返回爆炸半径、风险等级、受影响测试 | `get_call_graph(depth=2)` → 只有调用者列表 | 手动追踪 |
| **追踪 HTTP 请求流** | `trace_http_chain` → 路由→handler→service→DB 完整链路 | 无 | 手动搜索路由文件 |
| **语义搜索代码** | `semantic_code_search` → BM25+向量混合 | `search_code` → 向量 only | grep 关键词 |
| **项目全局概览** | `project_map` → 模块划分、入口点、热点函数 | `get_module_summary` → 基础文件/实体列表 | 读目录结构 |
| **调用图查询** | `get_call_graph` → 递归 CTE，环检测 | `get_call_graph` → 基础递归 | 手动搜索 |
| **依赖关系** | `dependency_graph` → 带依赖强度 | `get_dependencies` → 基础 imports 列表 | 手动搜索 import |
| **找死代码** | `find_dead_code` → 孤立符号 + 导出未用 | 无 | 无 |
| **找相似代码** | `find_similar_code` → embedding 相似度 | `search_code` → 近似 | 无 |
| **符号详情** | `get_ast_node` → 签名+代码+关系 | `search_entities` → 基础信息 | 读文件 |
| **找引用** | `find_references` → 调用者+导入者+继承者 | `get_call_graph(direction=callers)` → 只有调用者 | grep |

## 何时触发

本 Skill 不直接被用户调用。它是 arise-router 和 arise-prompt 的底层能力（通过 MCP tool 调用）：

- arise-router 在路由决策时调用（判断任务涉及代码改动 → 先获取结构信息）
- arise-prompt 在 Layer 1 上下文收集时调用（获取代码上下文注入规格）
- 后端选择逻辑在 arise-router 中，本 Server 只负责响应 tool 调用

## 首次使用

### 安装 CodeGraph（推荐）

```bash
# 方式 1: 全局安装
npm install -g @sdsrs/code-graph

# 方式 2: 注册为 MCP server（Claude Code）
claude mcp add code-graph-mcp -- npx -y @sdsrs/code-graph

# 方式 3: 其他 AI 工具的 MCP 配置
# 在 mcp.json 中添加：
{
  "mcpServers": {
    "code-graph": {
      "command": "npx",
      "args": ["-y", "@sdsrs/code-graph"]
    }
  }
}
```

安装后，CodeGraph 会自动索引当前项目。后续文件变更时增量更新。

### 只用内置 arise-knowledge（轻量替代）

```json
{
  "mcpServers": {
    "arise-knowledge": {
      "command": "node",
      "args": ["--import", "tsx/esm", "/path/to/arise-knowledge/src/index.ts"]
    }
  }
}
```

需要手动调用 `index_project` 建立初始索引。

## CodeGraph 独有能力说明

以下能力只在 CodeGraph 可用时生效：

### 爆炸半径分析（impact_analysis）

输入一个符号名，返回：
- 所有直接/间接调用者
- 涉及的文件列表
- 受影响的测试数量和名称
- 风险等级（LOW / MEDIUM / HIGH / CRITICAL）
- 建议的验证步骤

这是改代码前最有价值的信息——知道「改了会炸多大」。

### HTTP 请求流追踪（trace_http_chain）

输入一个路由路径（如 `POST /api/login`），返回：
- 路由定义 → 中间件链 → handler 函数 → service 层 → DB/外部调用

支持 Express、Flask/FastAPI、Go net/http 框架。

### 死代码检测（find_dead_code）

找出项目中未被引用的符号，分类为：
- **Orphan**：完全没有引用者
- **Exported-Unused**：导出了但项目内没人用

### 上下文压缩

CodeGraph 的输出是 token-aware 的——根据 LLM 上下文窗口大小自动压缩：
- L0：完整代码
- L1：签名+摘要
- L2：文件组概要
- L3：目录级概览

## 注意事项

- **CodeGraph 是首选引擎**：工作流设计围绕 CodeGraph 的完整能力展开，arise-knowledge 仅为降级保底。
- **arise-knowledge 始终可用**：作为零配置的轻量方案，适合小项目或快速开始。
- **两者可以同时安装**：router 会自动选择 CodeGraph（更强），不会冲突。
- **数据隔离**：CodeGraph 的图存在项目根目录下的隐藏文件中，arise-knowledge 存在 `.arise/knowledge/` 中，互不干扰。

## CodeGraph 数据接口契约

arise-skills 编排层期望从 CodeGraph 获取的标准化数据结构，设计用于写入 `.arise/codegraph-context.json`：

### impact_analysis 输出契约

```json
{
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
}
```

字段说明：
- `target`：分析的目标符号名
- `riskLevel`：LOW / MEDIUM / HIGH / CRITICAL，基于影响范围和改动类型综合判断
- `blastRadius.directCallers`：直接调用者数量
- `blastRadius.totalAffected`：直接 + 间接受影响的符号总数
- `blastRadius.affectedFiles`：受影响的源码文件路径列表（完整列表，不是采样）
- `blastRadius.affectedTests`：受影响的**测试文件路径完整列表**（verify 据此精准跑测试，必须包含所有受影响的测试文件，不能只采样）
- `blastRadius.affectedTestCount`：上述 `affectedTests` 文件中的**测试用例总数**（不是文件数；用于在 commit message 中量化影响范围）
- `suggestions`：CodeGraph 生成的改动建议

**语义约束**：`affectedTests.length`（文件数）≤ `affectedTestCount`（用例数）。verify 协议规定「如果 affectedTests 存在且有内容 → 跑这些具体的测试文件」——因此 `affectedTests` 必须是完整列表，遗漏一个文件就可能导致该文件的测试不被运行。

### trace_http_chain 输出契约

```json
{
  "route": "POST /api/login",
  "chain": [
    {"layer": "middleware", "name": "rateLimit", "file": "src/middleware/rate.ts"},
    {"layer": "middleware", "name": "validateLogin", "file": "src/middleware/validate.ts"},
    {"layer": "handler", "name": "loginHandler", "file": "src/api/auth.ts"},
    {"layer": "service", "name": "UserService.verify", "file": "src/services/user.ts"},
    {"layer": "db", "name": "users.findOne", "file": "src/models/user.ts"}
  ]
}
```

字段说明：
- `route`：HTTP 方法 + 路径
- `chain`：按执行顺序排列的请求链路
- `chain[].layer`：层级类型（middleware / handler / service / db / external）
- `chain[].name`：函数/中间件名称
- `chain[].file`：所在文件的相对路径

### 其他 tools 输出

`semantic_code_search`、`get_call_graph`、`dependency_graph` 等沿用 CodeGraph 现有格式，不额外封装。
