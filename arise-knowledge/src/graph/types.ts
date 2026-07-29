/**
 * Core type definitions for the code knowledge graph.
 */

/** Supported entity kinds */
export type EntityKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type'
  | 'variable'
  | 'module';

/** Supported edge (relationship) kinds */
export type EdgeKind =
  | 'calls'
  | 'imports'
  | 'extends'
  | 'implements'
  | 'uses'
  | 'exports';

/** Supported programming languages */
export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust';

/** A code entity (function, class, method, etc.) */
export interface Entity {
  id: string;
  name: string;
  kind: EntityKind;
  filePath: string;
  startLine: number;
  endLine: number;
  language: Language;
  signature?: string;
  docComment?: string;
  module?: string;
  updatedAt?: number;
}

/** A relationship between two entities */
export interface Edge {
  id?: number;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  filePath?: string;
  line?: number;
}

/** Import kind for the imports table */
export type ImportKind = 'default' | 'named' | 'namespace' | 'side_effect';

/**
 * An import binding: maps a local alias to an imported name from a module.
 * Used to resolve qualified calls like `service.foo()` where `service` is
 * a renamed import or a variable holding an imported class instance.
 */
export interface ImportRecord {
  sourceFile: string;      // file containing the import statement
  targetFile: string;      // resolved file path (filled after edge resolution; empty until then)
  targetModule: string;    // raw import path (e.g., './auth', 'fs')
  importedName: string | null;  // exported name (e.g., 'AuthService', 'default', null for namespace)
  localAlias: string;      // local binding name (e.g., 'AuthService', 'service', 'auth')
  importKind: ImportKind;
  line?: number;
}

/** File metadata for incremental indexing */
export interface FileInfo {
  path: string;
  language: Language;
  hash: string;
  entityCount: number;
  lastIndexed: number;
}

/** Result of indexing a project */
export interface IndexResult {
  indexedFiles: number;
  entities: number;
  edges: number;
  durationMs: number;
  skippedFiles: number;
}

/** A node in the call graph result */
export interface CallGraphNode {
  entity: Entity;
  callers: CallGraphEntry[];
  callees: CallGraphEntry[];
}

export interface CallGraphEntry {
  entity: Entity;
  callSite?: { filePath: string; line: number };
}

/** Dependency analysis result */
export interface DependencyResult {
  filePath: string;
  imports: DependencyEntry[];
  importedBy: DependencyEntry[];
}

export interface DependencyEntry {
  filePath: string;
  entities: string[];  // imported entity names
  line?: number;
}

/** Extension mapping for language detection */
export const LANGUAGE_EXTENSIONS: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
};

/** Generate a unique entity ID */
export function entityId(filePath: string, name: string, kind: EntityKind): string {
  return `${filePath}::${kind}::${name}`;
}
