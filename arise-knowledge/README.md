# arise-knowledge

代码知识图谱 MCP Server。解析代码 AST，构建调用图和依赖图，支持向量语义搜索。让 AI 编码助手真正理解大型代码库的结构。

## 能力

| 能力 | 说明 |
|------|------|
| 多语言 AST 解析 | TypeScript / JavaScript / Python / Go / Rust（tree-sitter） |
| 调用图 | 查询任意函数/方法的调用者和被调用者，支持深度遍历 |
| 依赖图 | 查询文件级 imports / imported_by 关系 |
| 增量索引 | 基于文件 hash，只重新索引变更文件 |
| 向量语义搜索 | 本地 embedding（Transformers.js）+ 向量索引（vectra） |
| 实体搜索 | 按名称模式查找函数、类、接口 |
| 模块概要 | 获取目录/模块的结构概要和公共 API |

## 快速开始

```bash
cd arise-knowledge
npm install
```

### 作为 MCP Server 使用

在你的 AI 工具（Claude Code / Cursor / TRAE 等）的 MCP 配置中添加：

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

然后在对话中调用：

```
index_project({ path: "/path/to/your/project" })
get_call_graph({ path: "/path/to/project", name: "functionName" })
get_dependencies({ path: "/path/to/project", file_path: "src/main.ts" })
search_code({ path: "/path/to/project", query: "用户认证逻辑" })
```

## MCP Tools

| Tool | 说明 |
|------|------|
| `index_project` | 扫描并索引代码库（AST + 向量），支持增量更新 |
| `get_call_graph` | 查询函数的调用者/被调用者 |
| `get_dependencies` | 查询文件的导入/被导入关系 |
| `search_code` | 用自然语言语义搜索代码 |
| `search_entities` | 按名称模式搜索代码实体 |
| `get_module_summary` | 获取模块/目录的结构概要 |

## 数据存储

索引数据存储在目标项目的 `.arise/knowledge/` 目录下：

```
.arise/knowledge/
├── graph.db        # SQLite 知识图谱（实体 + 关系边）
└── vectors/        # 向量索引（语义搜索用）
```

建议将 `.arise/` 加入项目的 `.gitignore`。

## 技术架构

```
┌─────────────────────────────────────┐
│         MCP Server (stdio)          │
│  index_project / get_call_graph /   │
│  get_dependencies / search_code     │
└──────────────┬──────────────────────┘
               │
┌──────────────┴──────────────────────┐
│           Core Engine               │
├─────────────┬───────────────────────┤
│  Indexer    │  Graph     │  Vector  │
│  scanner    │  builder   │  embedder│
│  parser     │  query     │  search  │
│  extractor  │            │          │
├─────────────┼────────────┼──────────┤
│  tree-sitter│  SQLite    │  vectra  │
│  (WASM)     │  (sql.js)  │  (local) │
└─────────────┴────────────┴──────────┘
```

**AST 解析**：tree-sitter WASM grammars，支持 5 种语言。从 AST 中提取函数、类、方法、接口、导入、调用关系。

**知识图谱**：SQLite 存储实体节点和关系边。支持调用关系（calls）、导入关系（imports）、继承（extends）、实现（implements）。

**向量搜索**：Transformers.js 生成本地 embedding（all-MiniLM-L6-v2），vectra 做向量近邻搜索。无需 API key。

## 性能

在自身项目（15 个 TypeScript 文件）上的基准：

- 索引时间：191ms
- 提取实体：63 个
- 建立关系：448 条边
- 调用图查询：< 1ms

## 与 arise-skills 集成

本项目是 arise-skills 生态的知识后端。通过 MCP 协议，让 `arise-router`、`arise-prompt` 等 Skill 能够：

- 理解代码结构，而不是靠关键词猜测
- 精确定位相关代码，而不是全文搜索
- 理解跨文件依赖关系
- 语义搜索代码（用自然语言描述找代码）

## License

MIT
