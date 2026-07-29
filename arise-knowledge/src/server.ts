/**
 * MCP Server setup — registers tools and handles requests.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import { indexProject } from './graph/builder.js';
import { getCallGraph, getDependencies } from './graph/query.js';
import { initParser } from './indexer/parser.js';
import { searchSimilar } from './embeddings/search.js';
import type { Language } from './graph/types.js';

/** Validate that a path exists and is a directory */
function validateProjectPath(p: string): string | null {
  if (!p || typeof p !== 'string') return 'path is required and must be a string';
  if (!fs.existsSync(p)) return `path does not exist: ${p}`;
  if (!fs.statSync(p).isDirectory()) return `path is not a directory: ${p}`;
  return null;
}

/** Create and configure the MCP server */
export function createServer(): Server {
  const server = new Server(
    { name: 'arise-knowledge', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // ─── List Tools ─────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'index_project',
        description:
          'Scan and index a codebase. Parses AST for TS/JS/Python/Go/Rust, ' +
          'extracts functions/classes/imports/calls, builds a knowledge graph. ' +
          'Supports incremental updates (only re-indexes changed files).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Absolute path to the project root' },
            languages: {
              type: 'array',
              items: { type: 'string', enum: ['typescript', 'javascript', 'python', 'go', 'rust'] },
              description: 'Languages to index (default: all supported)',
            },
            force: { type: 'boolean', description: 'Force re-index all files (ignore cache)' },
            embeddings: { type: 'boolean', description: 'Generate vector embeddings for semantic search (default: false, requires ~80MB model download)' },
          },
          required: ['path'],
        },
      },
      {
        name: 'get_call_graph',
        description:
          'Get the call graph for a function or method. ' +
          'Returns who calls it (callers) and what it calls (callees).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Project root path' },
            name: { type: 'string', description: 'Function/method name to query' },
            file_path: { type: 'string', description: 'File path to disambiguate (optional)' },
            depth: { type: 'number', description: 'Traversal depth (default: 1)' },
            direction: {
              type: 'string',
              enum: ['callers', 'callees', 'both'],
              description: 'Direction to traverse (default: both)',
            },
          },
          required: ['path', 'name'],
        },
      },
      {
        name: 'get_dependencies',
        description:
          'Analyze import/dependency relationships for a file. ' +
          'Returns what it imports and what imports it.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Project root path' },
            file_path: { type: 'string', description: 'Relative file path to analyze' },
            direction: {
              type: 'string',
              enum: ['imports', 'imported_by', 'both'],
              description: 'Direction (default: both)',
            },
          },
          required: ['path', 'file_path'],
        },
      },
      {
        name: 'search_code',
        description:
          'Semantic code search — find code entities using natural language. ' +
          'Requires index_project to have been run first with embeddings.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Project root path' },
            query: { type: 'string', description: 'Natural language search query' },
            kind: {
              type: 'string',
              enum: ['function', 'class', 'method', 'interface', 'type'],
              description: 'Filter by entity kind',
            },
            language: {
              type: 'string',
              enum: ['typescript', 'javascript', 'python', 'go', 'rust'],
              description: 'Filter by language',
            },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['path', 'query'],
        },
      },
      {
        name: 'search_entities',
        description:
          'Search for code entities by name pattern. ' +
          'Useful for finding functions, classes, interfaces by name.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Project root path' },
            query: { type: 'string', description: 'Name pattern to search (supports % wildcard)' },
            kind: {
              type: 'string',
              enum: ['function', 'class', 'method', 'interface', 'type', 'module'],
              description: 'Filter by entity kind',
            },
            language: {
              type: 'string',
              enum: ['typescript', 'javascript', 'python', 'go', 'rust'],
              description: 'Filter by language',
            },
            limit: { type: 'number', description: 'Max results (default: 20)' },
          },
          required: ['path', 'query'],
        },
      },
      {
        name: 'get_module_summary',
        description:
          'Get a summary of a directory/module: file count, entities, public API.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Project root path' },
            module_path: { type: 'string', description: 'Relative path to the module/directory' },
          },
          required: ['path', 'module_path'],
        },
      },
    ],
  }));

  // ─── Call Tool ──────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'index_project': {
          const { path: projectPath, languages, force, embeddings } = args as {
            path: string;
            languages?: Language[];
            force?: boolean;
            embeddings?: boolean;
          };
          const pathErr = validateProjectPath(projectPath);
          if (pathErr) {
            return { content: [{ type: 'text', text: `Validation error: ${pathErr}` }], isError: true };
          }
          await initParser();
          const result = await indexProject(projectPath, { languages, force, embeddings: embeddings ?? false });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'get_call_graph': {
          const { path: projectPath, name: funcName, file_path, depth, direction } = args as {
            path: string;
            name: string;
            file_path?: string;
            depth?: number;
            direction?: 'callers' | 'callees' | 'both';
          };
          const pathErr2 = validateProjectPath(projectPath);
          if (pathErr2) {
            return { content: [{ type: 'text', text: `Validation error: ${pathErr2}` }], isError: true };
          }
          const result = await getCallGraph(projectPath, funcName, {
            filePath: file_path,
            depth,
            direction,
          });
          if (!result) {
            // Business-level "no result" — return success with empty structure,
            // not isError. Clients should check `entity` field for null.
            return {
              content: [{ type: 'text', text: JSON.stringify({ entity: null, callers: [], callees: [], message: `Entity "${funcName}" not found. Run index_project first.` }, null, 2) }],
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'get_dependencies': {
          const { path: projectPath, file_path, direction } = args as {
            path: string;
            file_path: string;
            direction?: 'imports' | 'imported_by' | 'both';
          };
          const pathErr3 = validateProjectPath(projectPath);
          if (pathErr3) {
            return { content: [{ type: 'text', text: `Validation error: ${pathErr3}` }], isError: true };
          }
          const result = await getDependencies(projectPath, file_path, { direction });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'search_code': {
          const { path: projectPath, query, kind, language, limit } = args as {
            path: string;
            query: string;
            kind?: string;
            language?: string;
            limit?: number;
          };
          const pathErr4 = validateProjectPath(projectPath);
          if (pathErr4) {
            return { content: [{ type: 'text', text: `Validation error: ${pathErr4}` }], isError: true };
          }
          const results = await searchSimilar(projectPath, query, { limit, kind, language });
          if (results.length === 0) {
            // Business-level "no result" — return success with empty array,
            // not isError. Clients should check array length.
            return {
              content: [{ type: 'text', text: JSON.stringify({ results: [], message: 'No results found. Make sure index_project has been run with embeddings enabled.' }, null, 2) }],
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
          };
        }

        case 'search_entities': {
          const { path: projectPath, query, kind, language, limit = 20 } = args as {
            path: string;
            query: string;
            kind?: string;
            language?: string;
            limit?: number;
          };
          const pathErr5 = validateProjectPath(projectPath);
          if (pathErr5) {
            return { content: [{ type: 'text', text: `Validation error: ${pathErr5}` }], isError: true };
          }
          const { getDatabase } = await import('./storage/db.js');
          const db = await getDatabase(projectPath);

          // Use prefix match (query%) by default to leverage idx_entities_name index.
          // If user passes a wildcard explicitly (contains % or _), respect it as-is.
          const hasWildcard = /[%_]/.test(query);
          const pattern = hasWildcard ? query : `${query}%`;

          let sql = 'SELECT * FROM entities WHERE name LIKE ?';
          const params: any[] = [pattern];

          if (kind) {
            sql += ' AND kind = ?';
            params.push(kind);
          }
          if (language) {
            sql += ' AND language = ?';
            params.push(language);
          }
          sql += ' LIMIT ?';
          params.push(limit);

          const results = db.exec(sql, params);
          const entities = results.length > 0
            ? results[0].values.map((row: any[]) => {
                const cols = results[0].columns;
                const obj: Record<string, any> = {};
                cols.forEach((c: string, i: number) => { obj[c] = row[i]; });
                return obj;
              })
            : [];
          return {
            content: [{ type: 'text', text: JSON.stringify(entities, null, 2) }],
          };
        }

        case 'get_module_summary': {
          const { path: projectPath, module_path } = args as {
            path: string;
            module_path: string;
          };
          const pathErr6 = validateProjectPath(projectPath);
          if (pathErr6) {
            return { content: [{ type: 'text', text: `Validation error: ${pathErr6}` }], isError: true };
          }
          const { getDatabase: getDb } = await import('./storage/db.js');
          const db = await getDb(projectPath);

          const fileResults = db.exec("SELECT * FROM files WHERE path LIKE ?", [`${module_path}%`]);
          const entityResults = db.exec("SELECT * FROM entities WHERE file_path LIKE ?", [`${module_path}%`]);

          const files = fileResults.length > 0 ? fileResults[0].values : [];
          const entities = entityResults.length > 0 ? entityResults[0].values : [];
          const entityCols = entityResults.length > 0 ? entityResults[0].columns : [];
          const fileCols = fileResults.length > 0 ? fileResults[0].columns : [];

          const kindIdx = entityCols.indexOf('kind');
          const nameIdx = entityCols.indexOf('name');
          const fileIdx = entityCols.indexOf('file_path');
          const sigIdx = entityCols.indexOf('signature');
          const langIdx = fileCols.indexOf('language');

          const publicApi = entities
            .filter((e: any[]) => e[kindIdx] === 'function' || e[kindIdx] === 'class' || e[kindIdx] === 'interface')
            .map((e: any[]) => ({
              name: e[nameIdx],
              kind: e[kindIdx],
              file: e[fileIdx],
              signature: e[sigIdx],
            }));

          const languages = [...new Set(files.map((f: any[]) => f[langIdx]))];

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                modulePath: module_path,
                fileCount: files.length,
                entityCount: entities.length,
                publicApi,
                languages,
              }, null, 2),
            }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}

/** Start the MCP server with stdio transport */
export async function startServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('arise-knowledge MCP server started');
}
