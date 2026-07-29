/**
 * Project analysis script — uses arise-knowledge to index the skills repo
 * and collect data for a reviewable analysis document.
 *
 * Outputs structured JSON to stdout so the orchestrator can assemble a
 * confidence-graded document per arise-prompt protocol.
 */
import { indexProject } from '../src/graph/builder.js';
import { getCallGraph, getDependencies } from '../src/graph/query.js';
import { getDatabase } from '../src/storage/db.js';
import { initParser } from '../src/indexer/parser.js';

const PROJECT_PATH = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  console.log(`Project: ${PROJECT_PATH}`);

  await initParser();

  // ─── 1. Index ──────────────────────────────────────────────────
  section('1. index_project');
  const indexResult = await indexProject(PROJECT_PATH, {
    languages: ['typescript'],
    force: true,
  });
  console.log(JSON.stringify(indexResult, null, 2));

  const db = await getDatabase(PROJECT_PATH);

  // ─── 2. File inventory ─────────────────────────────────────────
  section('2. indexed files');
  const files = db.exec('SELECT path, language, entity_count FROM files ORDER BY path');
  if (files.length > 0) {
    for (const row of files[0].values) {
      console.log(`  ${row[0]}  [${row[1]}]  entities=${row[2]}`);
    }
  }
  const fileCount = files.length > 0 ? files[0].values.length : 0;
  console.log(`Total indexed files: ${fileCount}`);

  // ─── 3. Entity breakdown by kind ───────────────────────────────
  section('3. entities by kind');
  const kindBreakdown = db.exec(
    "SELECT kind, COUNT(*) as cnt FROM entities GROUP BY kind ORDER BY cnt DESC"
  );
  if (kindBreakdown.length > 0) {
    for (const row of kindBreakdown[0].values) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
  }

  // ─── 4. Edge breakdown + resolution quality ────────────────────
  section('4. edges by kind + resolution quality');
  const edgeKinds = db.exec("SELECT kind, COUNT(*) FROM edges GROUP BY kind ORDER BY 2 DESC");
  if (edgeKinds.length > 0) {
    for (const row of edgeKinds[0].values) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
  }
  const unresolved = db.exec(
    "SELECT COUNT(*) FROM edges WHERE target_id LIKE '__unresolved::%'"
  );
  const total = db.exec("SELECT COUNT(*) FROM edges");
  const unresolvedCount = unresolved.length > 0 ? Number(unresolved[0].values[0][0]) : 0;
  const totalCount = total.length > 0 ? Number(total[0].values[0][0]) : 0;
  const resolvedCount = totalCount - unresolvedCount;
  const resolutionRate = totalCount > 0 ? ((resolvedCount / totalCount) * 100).toFixed(1) : '0.0';
  console.log(`  --- resolution ---`);
  console.log(`  total edges:     ${totalCount}`);
  console.log(`  resolved:        ${resolvedCount} (${resolutionRate}%)`);
  console.log(`  unresolved:      ${unresolvedCount}`);

  // Break down unresolved by subtype
  const unresolvedByType = db.exec(
    `SELECT
       CASE
         WHEN target_id LIKE '__unresolved::function::%' THEN 'function'
         WHEN target_id LIKE '__unresolved::module::%' THEN 'module'
         WHEN target_id LIKE '__unresolved::class::%' THEN 'class'
         ELSE 'other'
       END as kind,
       COUNT(*) as cnt
     FROM edges
     WHERE target_id LIKE '__unresolved::%'
     GROUP BY kind
     ORDER BY cnt DESC`
  );
  console.log(`  --- unresolved breakdown ---`);
  if (unresolvedByType.length > 0) {
    for (const row of unresolvedByType[0].values) {
      console.log(`  ${row[0]}: ${row[1]}`);
    }
  }

  // ─── 5. Module summary for arise-knowledge/src ─────────────────
  section('5. module summary: arise-knowledge/src');
  const srcEntities = db.exec(
    `SELECT name, kind, file_path FROM entities
     WHERE file_path LIKE 'arise-knowledge/src/%'
       AND kind IN ('function', 'class', 'interface')
     ORDER BY file_path, kind, name`
  );
  if (srcEntities.length > 0) {
    let lastFile = '';
    for (const row of srcEntities[0].values) {
      const [name, kind, filePath] = row as [string, string, string];
      if (filePath !== lastFile) {
        console.log(`  ${filePath}`);
        lastFile = filePath;
      }
      console.log(`    ${kind}: ${name}`);
    }
  }

  // ─── 6. Call graph for indexProject (entry point) ──────────────
  section('6. call graph: indexProject');
  const cgIndex = await getCallGraph(PROJECT_PATH, 'indexProject', { depth: 1, direction: 'both' });
  if (cgIndex) {
    console.log(`  entity: ${cgIndex.entity.name} (${cgIndex.entity.kind}) @ ${cgIndex.entity.filePath}`);
    console.log(`  callers (${cgIndex.callers.length}):`);
    for (const c of cgIndex.callers) {
      console.log(`    ← ${c.entity.name} @ ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
    }
    console.log(`  callees (${cgIndex.callees.length}):`);
    for (const c of cgIndex.callees) {
      console.log(`    → ${c.entity.name} @ ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
    }
  } else {
    console.log('  NOT FOUND');
  }

  // ─── 7. Call graph for resolveCall (the function we just fixed) ─
  section('7. call graph: resolveCall');
  const cgResolveCall = await getCallGraph(PROJECT_PATH, 'resolveCall', { depth: 1, direction: 'both' });
  if (cgResolveCall) {
    console.log(`  entity: ${cgResolveCall.entity.name} (${cgResolveCall.entity.kind}) @ ${cgResolveCall.entity.filePath}`);
    console.log(`  callers (${cgResolveCall.callers.length}):`);
    for (const c of cgResolveCall.callers) {
      console.log(`    ← ${c.entity.name} @ ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
    }
    console.log(`  callees (${cgResolveCall.callees.length}):`);
    for (const c of cgResolveCall.callees) {
      console.log(`    → ${c.entity.name} @ ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
    }
  } else {
    console.log('  NOT FOUND');
  }

  // ─── 8. Call graph for resolveEdges ────────────────────────────
  section('8. call graph: resolveEdges');
  const cgResolveEdges = await getCallGraph(PROJECT_PATH, 'resolveEdges', { depth: 1, direction: 'both' });
  if (cgResolveEdges) {
    console.log(`  entity: ${cgResolveEdges.entity.name} (${cgResolveEdges.entity.kind}) @ ${cgResolveEdges.entity.filePath}`);
    console.log(`  callers (${cgResolveEdges.callers.length}):`);
    for (const c of cgResolveEdges.callers) {
      console.log(`    ← ${c.entity.name} @ ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
    }
    console.log(`  callees (${cgResolveEdges.callees.length}):`);
    for (const c of cgResolveEdges.callees) {
      console.log(`    → ${c.entity.name} @ ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
    }
  } else {
    console.log('  NOT FOUND');
  }

  // ─── 9. Dependencies for core files ────────────────────────────
  section('9. dependencies: arise-knowledge/src/graph/builder.ts');
  const depsBuilder = await getDependencies(PROJECT_PATH, 'arise-knowledge/src/graph/builder.ts');
  console.log(`  imports (${depsBuilder.imports.length}):`);
  for (const d of depsBuilder.imports) {
    console.log(`    → ${d.filePath} (line ${d.line ?? '?'})`);
  }
  console.log(`  imported by (${depsBuilder.importedBy.length}):`);
  for (const d of depsBuilder.importedBy) {
    console.log(`    ← ${d.filePath}`);
  }

  section('10. dependencies: arise-knowledge/src/storage/db.ts');
  const depsDb = await getDependencies(PROJECT_PATH, 'arise-knowledge/src/storage/db.ts');
  console.log(`  imports (${depsDb.imports.length}):`);
  for (const d of depsDb.imports) {
    console.log(`    → ${d.filePath} (line ${d.line ?? '?'})`);
  }
  console.log(`  imported by (${depsDb.importedBy.length}):`);
  for (const d of depsDb.importedBy) {
    console.log(`    ← ${d.filePath}`);
  }

  // ─── 11. Top entities by inbound call edges (hotspots) ─────────
  section('11. hotspot entities (most callers)');
  const hotspots = db.exec(
    `SELECT e.name, e.kind, e.file_path, COUNT(*) as caller_count
     FROM edges ed
     JOIN entities e ON ed.target_id = e.id
     WHERE ed.kind = 'calls'
     GROUP BY e.id
     ORDER BY caller_count DESC
     LIMIT 10`
  );
  if (hotspots.length > 0) {
    for (const row of hotspots[0].values) {
      console.log(`  ${row[3]} callers → ${row[0]} (${row[1]}) @ ${row[2]}`);
    }
  } else {
    console.log('  (no resolved call edges found)');
  }

  // ─── 12. Imports table stats (alias resolution quality) ────────
  section('12. imports table (alias resolution)');
  const importTotal = db.exec("SELECT COUNT(*) FROM imports");
  const importResolved = db.exec("SELECT COUNT(*) FROM imports WHERE target_file != ''");
  const importUnresolved = db.exec("SELECT COUNT(*) FROM imports WHERE target_file = ''");
  const it = importTotal.length > 0 ? Number(importTotal[0].values[0][0]) : 0;
  const ir = importResolved.length > 0 ? Number(importResolved[0].values[0][0]) : 0;
  const iu = importUnresolved.length > 0 ? Number(importUnresolved[0].values[0][0]) : 0;
  const importRate = it > 0 ? ((ir / it) * 100).toFixed(1) : '0.0';
  console.log(`  total:     ${it}`);
  console.log(`  resolved:  ${ir} (${importRate}%)`);
  console.log(`  unresolved:${iu}`);

  console.log('\n=== analysis complete ===');
}

main().catch((err) => {
  console.error('Analysis failed:', err);
  process.exit(1);
});
