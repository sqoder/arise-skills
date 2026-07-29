/**
 * Graph query — find callers, callees, dependencies.
 */
import type { Database } from 'sql.js';
import { type Entity, type CallGraphNode, type CallGraphEntry, type DependencyResult, type DependencyEntry } from './types.js';
import { getDatabase } from '../storage/db.js';

/** Get the call graph for a function/method */
export async function getCallGraph(
  projectPath: string,
  name: string,
  options: { filePath?: string; depth?: number; direction?: 'callers' | 'callees' | 'both' } = {}
): Promise<CallGraphNode | null> {
  const db = await getDatabase(projectPath);
  const { depth = 1, direction = 'both' } = options;

  // Find the entity
  let entity: Entity | undefined;
  if (options.filePath) {
    const r = db.exec('SELECT * FROM entities WHERE name = ? AND file_path = ? LIMIT 1', [name, options.filePath]);
    entity = r.length > 0 && r[0].values.length > 0 ? rowToEntity(r[0].columns, r[0].values[0]) : undefined;
  } else {
    const r = db.exec('SELECT * FROM entities WHERE name = ? LIMIT 1', [name]);
    entity = r.length > 0 && r[0].values.length > 0 ? rowToEntity(r[0].columns, r[0].values[0]) : undefined;
  }

  if (!entity) {
    const r = db.exec("SELECT * FROM entities WHERE name LIKE ? LIMIT 1", [`%${name}%`]);
    entity = r.length > 0 && r[0].values.length > 0 ? rowToEntity(r[0].columns, r[0].values[0]) : undefined;
  }

  if (!entity) return null;

  const callers: CallGraphEntry[] = [];
  const callees: CallGraphEntry[] = [];

  if (direction === 'callers' || direction === 'both') {
    collectCallers(db, entity.id, depth, callers, new Set());
  }

  if (direction === 'callees' || direction === 'both') {
    collectCallees(db, entity.id, depth, callees, new Set());
  }

  return { entity, callers, callees };
}

/** Get dependencies for a file */
export async function getDependencies(
  projectPath: string,
  filePath: string,
  options: { depth?: number; direction?: 'imports' | 'imported_by' | 'both' } = {}
): Promise<DependencyResult> {
  const db = await getDatabase(projectPath);
  const { direction = 'both' } = options;

  const imports: DependencyEntry[] = [];
  const importedBy: DependencyEntry[] = [];

  const fileModuleId = `${filePath}::module::__file__`;

  if (direction === 'imports' || direction === 'both') {
    const results = db.exec(
      `SELECT target_id, file_path, line FROM edges WHERE source_id = ? AND kind = 'imports'`,
      [fileModuleId]
    );

    if (results.length > 0) {
      for (const row of results[0].values) {
        const [targetId, , line] = row as [string, string, number];
        const targetFile = targetId.includes('::module::')
          ? targetId.split('::module::')[0] ?? targetId
          : targetId;
        imports.push({ filePath: targetFile, entities: [], line });
      }
    }
  }

  if (direction === 'imported_by' || direction === 'both') {
    const results = db.exec(
      `SELECT source_id, file_path, line FROM edges WHERE target_id = ? AND kind = 'imports'`,
      [fileModuleId]
    );

    if (results.length > 0) {
      for (const row of results[0].values) {
        const [sourceId, edgeFile, line] = row as [string, string, number];
        const sourceFile = sourceId.includes('::module::')
          ? sourceId.split('::module::')[0] ?? sourceId
          : edgeFile;
        importedBy.push({ filePath: sourceFile, entities: [], line });
      }
    }
  }

  return { filePath, imports, importedBy };
}

// ─── Helpers ───────────────────────────────────────────────────────

function collectCallers(
  db: Database,
  entityId: string,
  depth: number,
  result: CallGraphEntry[],
  visited: Set<string>
): void {
  if (depth <= 0 || visited.has(entityId)) return;
  visited.add(entityId);

  const results = db.exec(
    `SELECT e.*, ed.file_path as call_file, ed.line as call_line
     FROM edges ed JOIN entities e ON e.id = ed.source_id
     WHERE ed.target_id = ? AND ed.kind = 'calls'`,
    [entityId]
  );

  if (results.length > 0) {
    for (const row of results[0].values) {
      const cols = results[0].columns;
      const entity = rowToEntity(cols, row);
      const callFileIdx = cols.indexOf('call_file');
      const callLineIdx = cols.indexOf('call_line');
      result.push({
        entity,
        callSite: { filePath: String(row[callFileIdx] ?? ''), line: Number(row[callLineIdx] ?? 0) },
      });
      if (depth > 1) collectCallers(db, entity.id, depth - 1, result, visited);
    }
  }
}

function collectCallees(
  db: Database,
  entityId: string,
  depth: number,
  result: CallGraphEntry[],
  visited: Set<string>
): void {
  if (depth <= 0 || visited.has(entityId)) return;
  visited.add(entityId);

  const results = db.exec(
    `SELECT e.*, ed.file_path as call_file, ed.line as call_line
     FROM edges ed JOIN entities e ON e.id = ed.target_id
     WHERE ed.source_id = ? AND ed.kind = 'calls'`,
    [entityId]
  );

  if (results.length > 0) {
    for (const row of results[0].values) {
      const cols = results[0].columns;
      const entity = rowToEntity(cols, row);
      if (entity.id.startsWith('__unresolved::')) continue;
      const callFileIdx = cols.indexOf('call_file');
      const callLineIdx = cols.indexOf('call_line');
      result.push({
        entity,
        callSite: { filePath: String(row[callFileIdx] ?? ''), line: Number(row[callLineIdx] ?? 0) },
      });
      if (depth > 1) collectCallees(db, entity.id, depth - 1, result, visited);
    }
  }
}

function rowToEntity(columns: string[], values: any[]): Entity {
  const get = (col: string) => values[columns.indexOf(col)];
  return {
    id: String(get('id') ?? ''),
    name: String(get('name') ?? ''),
    kind: get('kind') as Entity['kind'],
    filePath: String(get('file_path') ?? ''),
    startLine: Number(get('start_line') ?? 0),
    endLine: Number(get('end_line') ?? 0),
    language: get('language') as Entity['language'],
    signature: get('signature') ? String(get('signature')) : undefined,
    docComment: get('doc_comment') ? String(get('doc_comment')) : undefined,
    module: get('module') ? String(get('module')) : undefined,
  };
}
