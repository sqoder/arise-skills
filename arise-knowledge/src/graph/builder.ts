/**
 * Graph builder — persists entities and edges to SQLite.
 */
import type { Database } from 'sql.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { type Entity, type Edge, type FileInfo, type IndexResult, type Language } from './types.js';
import { getDatabase, saveDatabase, withTransaction, acquireLock } from '../storage/db.js';
import { scanProject, type ScannedFile } from '../indexer/scanner.js';
import { parseFile } from '../indexer/parser.js';
import { extractFromTree } from '../indexer/extractor.js';
import { upsertEntityVector } from '../embeddings/search.js';

/** Pre-compute line start offsets for efficient substring extraction */
function computeLineOffsets(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/** Get substring for a line range using pre-computed offsets */
function getSnippetByLines(content: string, lineOffsets: number[], startLine: number, endLine: number, maxLen = 500): string {
  const startIdx = lineOffsets[startLine - 1] ?? 0;
  const endIdx = lineOffsets[endLine] ?? content.length;
  return content.slice(startIdx, Math.min(endIdx, startIdx + maxLen));
}

/** Index a project: scan, parse, extract, and persist */
export async function indexProject(
  projectPath: string,
  options: { languages?: Language[]; force?: boolean; embeddings?: boolean } = {}
): Promise<IndexResult> {
  const release = await acquireLock();
  try {
    return await doIndexProject(projectPath, options);
  } finally {
    release();
  }
}

async function doIndexProject(
  projectPath: string,
  options: { languages?: Language[]; force?: boolean; embeddings?: boolean }
): Promise<IndexResult> {
  const startTime = Date.now();
  const db = await getDatabase(projectPath);
  const withEmbeddings = options.embeddings ?? false;

  const files = await scanProject(projectPath, options.languages);
  let indexedFiles = 0;
  let totalEntities = 0;
  let totalEdges = 0;
  let skippedFiles = 0;

  for (const file of files) {
    const content = fs.readFileSync(file.path, 'utf-8');
    const hash = crypto.createHash('md5').update(content).digest('hex');

    // Check if file needs re-indexing
    if (!options.force) {
      const result = db.exec('SELECT hash FROM files WHERE path = ?', [file.relativePath]);
      if (result.length > 0 && result[0].values.length > 0) {
        const existingHash = String(result[0].values[0][0]);
        if (existingHash === hash) {
          skippedFiles++;
          continue;
        }
      }
    }

    try {
      const tree = await parseFile(file.path, file.language);
      const { entities, edges, imports } = extractFromTree(tree, file.relativePath, file.language, content);

      // Wrap all DB writes for this file in a transaction
      withTransaction(db, () => {
        // Clear old data for this file
        clearFileData(db, file.relativePath);

        // Create the file-level module entity (needed for edges)
        db.run(
          `INSERT OR REPLACE INTO entities (id, name, kind, file_path, start_line, end_line, language, updated_at)
           VALUES (?, ?, 'module', ?, 0, 0, ?, ?)`,
          [`${file.relativePath}::module::__file__`, file.relativePath, file.relativePath, file.language, Date.now()]
        );

        // Insert entities
        for (const entity of entities) {
          db.run(
            `INSERT OR REPLACE INTO entities (id, name, kind, file_path, start_line, end_line, language, signature, doc_comment, module, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [entity.id, entity.name, entity.kind, entity.filePath,
             entity.startLine, entity.endLine, entity.language,
             entity.signature ?? null, entity.docComment ?? null,
             entity.module ?? null, Date.now()]
          );
        }

        // Insert edges (unresolved references will be linked later)
        for (const edge of edges) {
          db.run(
            `INSERT INTO edges (source_id, target_id, kind, file_path, line)
             VALUES (?, ?, ?, ?, ?)`,
            [edge.sourceId, edge.targetId, edge.kind, edge.filePath ?? null, edge.line ?? null]
          );
        }

        // Insert import records (aliases) for qualified call resolution
        for (const imp of imports) {
          db.run(
            `INSERT INTO imports (source_file, target_file, target_module, imported_name, local_alias, import_kind, line)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [imp.sourceFile, imp.targetFile, imp.targetModule,
             imp.importedName ?? null, imp.localAlias, imp.importKind,
             imp.line ?? null]
          );
        }

        // Update file metadata
        db.run(
          `INSERT OR REPLACE INTO files (path, language, hash, entity_count, last_indexed)
           VALUES (?, ?, ?, ?, ?)`,
          [file.relativePath, file.language, hash, entities.length, Date.now()]
        );
      });

      indexedFiles++;
      totalEntities += entities.length;
      totalEdges += edges.length;

      // Generate vector embeddings for searchable entities
      if (withEmbeddings) {
        const lineOffsets = computeLineOffsets(content);
        for (const entity of entities) {
          if (entity.kind === 'function' || entity.kind === 'class' ||
              entity.kind === 'method' || entity.kind === 'interface') {
            try {
              const snippet = getSnippetByLines(content, lineOffsets, entity.startLine, entity.endLine);
              await upsertEntityVector(projectPath, entity, snippet);
            } catch {
              // Non-critical: vector indexing failure doesn't block graph indexing
            }
          }
        }
      }
    } catch (err) {
      // Skip files that fail to parse
      console.error(`Failed to parse ${file.relativePath}: ${err}`);
    }
  }

  // Resolve edges (link unresolved references to actual entities)
  withTransaction(db, () => resolveEdges(db));

  // Clean up orphan data for deleted/renamed files
  // (incremental index only processes files returned by scanProject;
  //  files that were deleted or moved leave orphan entities/edges behind)
  withTransaction(db, () => cleanupDeletedFiles(db, files));

  // Save to disk
  saveDatabase();

  return {
    indexedFiles,
    entities: totalEntities,
    edges: totalEdges,
    durationMs: Date.now() - startTime,
    skippedFiles,
  };
}

/** Remove all entities, edges, and import records for a file */
function clearFileData(db: Database, filePath: string): void {
  db.run('DELETE FROM edges WHERE file_path = ?', [filePath]);
  db.run('DELETE FROM entities WHERE file_path = ?', [filePath]);
  db.run('DELETE FROM imports WHERE source_file = ?', [filePath]);
}

/**
 * Resolve __unresolved:: references in edges by matching to actual entities.
 * This links cross-file calls and imports to their definitions.
 *
 * Resolution strategy (in priority order, to avoid false positives from
 * same-name functions in unrelated modules):
 *   1. Same-file exact match (function called in F → look in F first)
 *   2. this./self./super. → resolve to method in enclosing class in same file
 *   3. Qualified call (obj.method) → resolve via imports: find which module
 *      `obj` was imported from, then look for `method` in that module
 *   4. Global fallback: exact name match across all files (lowest confidence,
 *      only used when above strategies fail)
 */
function resolveEdges(db: Database): void {
  // IMPORTANT: Resolve imports FIRST, then function calls.
  // buildImportMap() reads already-resolved import edges (target_id ends with
  // '::module::__file__'). If we resolve calls before imports, importMap will
  // be empty and Strategy 3 (qualified call via imports) will never match.
  resolveImportEdges(db);

  // Now resolve function calls with a fully-built import map
  const callResults = db.exec(
    "SELECT id, target_id, file_path FROM edges WHERE target_id LIKE '__unresolved::function::%'"
  );

  if (callResults.length > 0) {
    const importMap = buildImportMap(db);

    for (const row of callResults[0].values) {
      const [edgeId, targetId, edgeFilePath] = row as [number, string, string | null];
      const funcName = targetId.replace('__unresolved::function::', '');
      const resolved = resolveCall(db, funcName, edgeFilePath, importMap);

      if (resolved) {
        db.run('UPDATE edges SET target_id = ? WHERE id = ?', [resolved, edgeId]);
      }
      // If not resolved, leave as __unresolved:: — get_call_graph will skip it
    }
  }
}

/** Resolve __unresolved::module:: references to actual file paths.
 *  Also updates the imports table's target_file column so that buildImportMap
 *  can use the resolved paths.
 *
 *  Resolution strategy for relative imports (./ or ../):
 *    1. Resolve the module path relative to the importing file's directory.
 *    2. Try with each supported extension (.ts, .tsx, .js, .jsx, .mjs, .cjs).
 *    3. Try as a directory with /index.{ext}.
 *  Bare specifiers (fs, react, lodash) are external and left unresolved. */
function resolveImportEdges(db: Database): void {
  const importResults = db.exec(
    "SELECT id, target_id, file_path FROM edges WHERE target_id LIKE '__unresolved::module::%'"
  );

  // Extensions tried when resolving a relative module path to a file.
  // Order matters: TS-first since this is primarily a TS codebase tool.
  const EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

  if (importResults.length > 0) {
    for (const row of importResults[0].values) {
      const [edgeId, targetId, edgeFilePath] = row as [number, string, string | null];
      const modulePath = targetId.replace('__unresolved::module::', '');

      // Only resolve relative imports. Bare specifiers (fs, react) and
      // absolute paths are external — leave them unresolved.
      if (!modulePath.startsWith('./') && !modulePath.startsWith('../')) {
        continue;
      }

      // Resolve module path relative to the importing file's directory.
      // Both paths are project-relative with '/' separators (posix).
      const sourceDir = edgeFilePath ? path.posix.dirname(edgeFilePath) : '';
      const resolvedBase = path.posix.normalize(path.posix.join(sourceDir, modulePath));

      // TS ESM convention: imports often use .js extension (e.g., './foo.js')
      // even though the source file is foo.ts. Strip known JS extensions
      // before trying TS extensions, otherwise './foo.js' would only match
      // './foo.js.ts' (which never exists).
      const STRIP_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];
      let baseForCandidates = resolvedBase;
      for (const stripExt of STRIP_EXTENSIONS) {
        if (resolvedBase.endsWith(stripExt)) {
          baseForCandidates = resolvedBase.slice(0, -stripExt.length);
          break;
        }
      }

      // Build candidate file paths to try.
      const candidates: string[] = [];
      for (const ext of EXTENSIONS) {
        candidates.push(`${baseForCandidates}.${ext}`);
        candidates.push(`${baseForCandidates}/index.${ext}`);
      }

      let resolvedFile: string | null = null;
      for (const candidate of candidates) {
        const match = db.exec(
          "SELECT path FROM files WHERE path = ? LIMIT 1",
          [candidate]
        );
        if (match.length > 0 && match[0].values.length > 0) {
          resolvedFile = String(match[0].values[0][0]);
          break;
        }
      }

      if (resolvedFile) {
        db.run('UPDATE edges SET target_id = ? WHERE id = ?',
          [`${resolvedFile}::module::__file__`, edgeId]);

        // Update the imports table: fill target_file for all imports of this
        // module from any source file (matches by target_module = modulePath).
        db.run(
          "UPDATE imports SET target_file = ? WHERE target_module = ? AND target_file = ''",
          [resolvedFile, modulePath]
        );
      }
    }
  }

  // Also resolve variable-alias imports (target_module = '' but imported_name
  // is a class/function defined in some file). Look up entities by name.
  // This handles `const x = new ClassName()` where ClassName was imported.
  //
  // Indirect chain: `const rs = new RenamedService()` where
  // `RenamedService` is itself a renamed import (local_alias='RenamedService',
  // imported_name='AuthService'). We resolve the chain by first checking if
  // imported_name matches a local_alias in the same source file's imports.
  const varAliases = db.exec(
    "SELECT id, source_file, imported_name FROM imports WHERE target_module = '' AND target_file = '' AND imported_name IS NOT NULL"
  );
  if (varAliases.length > 0) {
    for (const row of varAliases[0].values) {
      const [importId, sourceFile, importedName] = row as [number, string, string];

      // Step 1: Is `importedName` itself a renamed import in this file?
      // If so, follow the chain to the real imported name + target file.
      let realName = importedName;
      let realTargetFile: string | null = null;
      const chainMatch = db.exec(
        "SELECT imported_name, target_file FROM imports WHERE source_file = ? AND local_alias = ? AND target_module != '' LIMIT 1",
        [sourceFile, importedName]
      );
      if (chainMatch.length > 0 && chainMatch[0].values.length > 0) {
        realName = String(chainMatch[0].values[0][0]) || importedName;
        realTargetFile = String(chainMatch[0].values[0][1]) || null;
      }

      // Step 2: Try to find the class/function by realName.
      // (a) Local class in the same file
      const localMatch = db.exec(
        "SELECT file_path FROM entities WHERE name = ? AND file_path = ? AND (kind = 'class' OR kind = 'function') LIMIT 1",
        [realName, sourceFile]
      );
      if (localMatch.length > 0 && localMatch[0].values.length > 0) {
        db.run("UPDATE imports SET target_file = ? WHERE id = ?",
          [String(localMatch[0].values[0][0]), importId]);
        continue;
      }
      // (b) If we have a realTargetFile from the chain, look there directly
      if (realTargetFile) {
        const directMatch = db.exec(
          "SELECT file_path FROM entities WHERE name = ? AND file_path = ? AND (kind = 'class' OR kind = 'function') LIMIT 1",
          [realName, realTargetFile]
        );
        if (directMatch.length > 0 && directMatch[0].values.length > 0) {
          db.run("UPDATE imports SET target_file = ? WHERE id = ?",
            [realTargetFile, importId]);
          continue;
        }
      }
      // (c) Otherwise scan all files this source imports for the class
      const importedFiles = db.exec(
        "SELECT target_file FROM imports WHERE source_file = ? AND target_file != '' AND target_module != ''",
        [sourceFile]
      );
      if (importedFiles.length > 0) {
        for (const f of importedFiles[0].values) {
          const targetFile = String(f[0]);
          const match = db.exec(
            "SELECT file_path FROM entities WHERE name = ? AND file_path = ? AND (kind = 'class' OR kind = 'function') LIMIT 1",
            [realName, targetFile]
          );
          if (match.length > 0 && match[0].values.length > 0) {
            db.run("UPDATE imports SET target_file = ? WHERE id = ?",
              [targetFile, importId]);
            break;
          }
        }
      }
    }
  }
}

/**
 * Build an alias map from the imports table.
 * Returns: Map<sourceFile, Map<localAlias, { targetFile, importedName, importKind }>>
 *
 * This uses the REAL alias names extracted from import statements (not the
 * target file's basename), so it correctly handles:
 *   - import { AuthService } from './auth'           → alias 'AuthService'
 *   - import { AuthService as Service } from './auth' → alias 'Service'
 *   - import * as auth from './auth'                  → alias 'auth'
 *   - import AuthService from './auth'                → alias 'AuthService'
 *   - const service = new AuthService()               → alias 'service' (instance)
 */
interface AliasInfo {
  targetFile: string;
  importedName: string | null;
  importKind: string;
}

function buildImportMap(db: Database): Map<string, Map<string, AliasInfo>> {
  const importMap = new Map<string, Map<string, AliasInfo>>();

  const results = db.exec(
    "SELECT source_file, target_file, imported_name, local_alias, import_kind FROM imports WHERE target_file != '' AND local_alias != ''"
  );

  if (results.length === 0) return importMap;

  for (const row of results[0].values) {
    const [sourceFile, targetFile, importedName, localAlias, importKind] =
      row as [string, string, string | null, string, string];

    if (!importMap.has(sourceFile)) {
      importMap.set(sourceFile, new Map());
    }
    importMap.get(sourceFile)!.set(localAlias, {
      targetFile,
      importedName: importedName ?? null,
      importKind,
    });
  }

  return importMap;
}

/**
 * Resolve a function call to an entity ID, using scope-aware strategies.
 */
function resolveCall(
  db: Database,
  funcName: string,
  edgeFilePath: string | null,
  importMap: Map<string, Map<string, AliasInfo>>
): string | null {
  // Parse the call expression: could be "foo", "obj.method", "a.b.c", "this.foo", etc.
  const parts = funcName.split('.');
  const simpleName = parts[parts.length - 1];
  const qualifier = parts.length > 1 ? parts[0] : null;

  // Strategy 2: this./self./super. → method in same file
  if (qualifier === 'this' || qualifier === 'self' || qualifier === 'super') {
    if (edgeFilePath) {
      const match = db.exec(
        "SELECT id FROM entities WHERE file_path = ? AND name = ? AND kind = 'method' LIMIT 1",
        [edgeFilePath, simpleName]
      );
      if (match.length > 0 && match[0].values.length > 0) {
        return String(match[0].values[0][0]);
      }
      // Also try as function (in case of misclassification)
      const fnMatch = db.exec(
        "SELECT id FROM entities WHERE file_path = ? AND name = ? AND kind = 'function' LIMIT 1",
        [edgeFilePath, simpleName]
      );
      if (fnMatch.length > 0 && fnMatch[0].values.length > 0) {
        return String(fnMatch[0].values[0][0]);
      }
    }
    // this.method not found in same file — don't fall through to global,
    // because it's definitely a method on the current class hierarchy
    return null;
  }

  // Strategy 3: qualified call (obj.method) → resolve via imports.
  // `qualifier` is the local name (e.g., "service", "auth", "Service").
  // Look it up in the importMap to find which file the class/instance came from.
  if (qualifier && edgeFilePath) {
    const fileImports = importMap.get(edgeFilePath);
    if (fileImports) {
      const aliasInfo = fileImports.get(qualifier);
      if (aliasInfo) {
        const targetFile = aliasInfo.targetFile;

        // Case A: namespace import (import * as auth from './auth')
        // → look for simpleName as a top-level function/class in targetFile
        if (aliasInfo.importKind === 'namespace') {
          const match = db.exec(
            "SELECT id FROM entities WHERE file_path = ? AND name = ? AND (kind = 'function' OR kind = 'class' OR kind = 'variable') LIMIT 1",
            [targetFile, simpleName]
          );
          if (match.length > 0 && match[0].values.length > 0) {
            return String(match[0].values[0][0]);
          }
        }

        // Case B: instance variable (const service = new AuthService())
        // → look for simpleName as a method on the class defined in targetFile.
        // Stored entities have name "ClassName.methodName", so match by suffix.
        const methodMatch = db.exec(
          "SELECT id FROM entities WHERE file_path = ? AND name LIKE ? AND kind = 'method' LIMIT 1",
          [targetFile, `%.${simpleName}`]
        );
        if (methodMatch.length > 0 && methodMatch[0].values.length > 0) {
          return String(methodMatch[0].values[0][0]);
        }

        // Case C: default/named import of a class, called as Class.staticMethod()
        // → look for simpleName as a method (static) on the class
        const staticMatch = db.exec(
          "SELECT id FROM entities WHERE file_path = ? AND name LIKE ? AND (kind = 'method' OR kind = 'function') LIMIT 1",
          [targetFile, `%.${simpleName}`]
        );
        if (staticMatch.length > 0 && staticMatch[0].values.length > 0) {
          return String(staticMatch[0].values[0][0]);
        }

        // Case D: namespace property access (auth.login where login is a function)
        const fnMatch = db.exec(
          "SELECT id FROM entities WHERE file_path = ? AND name = ? AND kind = 'function' LIMIT 1",
          [targetFile, simpleName]
        );
        if (fnMatch.length > 0 && fnMatch[0].values.length > 0) {
          return String(fnMatch[0].values[0][0]);
        }
      }
    }
  }

  // Strategy 1: same-file exact match (highest priority for unqualified calls)
  if (edgeFilePath) {
    const match = db.exec(
      "SELECT id FROM entities WHERE file_path = ? AND name = ? AND (kind = 'function' OR kind = 'method') LIMIT 1",
      [edgeFilePath, simpleName]
    );
    if (match.length > 0 && match[0].values.length > 0) {
      return String(match[0].values[0][0]);
    }
  }

  // Strategy 4: global fallback — exact name match across all files
  // (lowest confidence; only used when scope-aware strategies fail)
  const globalMatch = db.exec(
    "SELECT id FROM entities WHERE name = ? AND (kind = 'function' OR kind = 'method') LIMIT 1",
    [simpleName]
  );
  if (globalMatch.length > 0 && globalMatch[0].values.length > 0) {
    return String(globalMatch[0].values[0][0]);
  }

  // Last resort: qualified name suffix match (e.g., Class.method stored as "Class.method")
  const qualifiedMatch = db.exec(
    "SELECT id FROM entities WHERE name LIKE ? AND (kind = 'function' OR kind = 'method') LIMIT 1",
    [`%.${simpleName}`]
  );
  if (qualifiedMatch.length > 0 && qualifiedMatch[0].values.length > 0) {
    return String(qualifiedMatch[0].values[0][0]);
  }

  return null;
}

/**
 * Remove entities/edges/files for paths no longer present on disk.
 * Incremental indexing skips unchanged files, so deleted/renamed files
 * would otherwise leave orphan rows that pollute call graph queries.
 */
function cleanupDeletedFiles(db: Database, currentFiles: ScannedFile[]): void {
  const currentPaths = new Set(currentFiles.map((f) => f.relativePath));

  // Fetch all indexed file paths from DB
  const result = db.exec('SELECT path FROM files');
  if (result.length === 0) return;

  const orphanPaths: string[] = [];
  for (const row of result[0].values) {
    const path = String(row[0]);
    if (!currentPaths.has(path)) {
      orphanPaths.push(path);
    }
  }

  if (orphanPaths.length === 0) return;

  for (const orphanPath of orphanPaths) {
    clearFileData(db, orphanPath);
    db.run('DELETE FROM files WHERE path = ?', [orphanPath]);
  }
}
