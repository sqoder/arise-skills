/**
 * Supplementary queries to clarify ambiguous findings from project-analysis.ts.
 */
import { getCallGraph, getDependencies } from '../src/graph/query.js';
import { getDatabase } from '../src/storage/db.js';
import { initParser } from '../src/indexer/parser.js';

const PROJECT_PATH = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

async function main() {
  await initParser();
  const db = await getDatabase(PROJECT_PATH);

  // ─── A. Relative vs bare imports ───────────────────────────────
  console.log('=== A. import resolution breakdown ===');
  const relTotal = db.exec(
    "SELECT COUNT(*) FROM imports WHERE target_module LIKE './%' OR target_module LIKE '../%'"
  );
  const relResolved = db.exec(
    "SELECT COUNT(*) FROM imports WHERE (target_module LIKE './%' OR target_module LIKE '../%') AND target_file != ''"
  );
  const bareTotal = db.exec(
    "SELECT COUNT(*) FROM imports WHERE target_module NOT LIKE './%' AND target_module NOT LIKE '../%' AND target_module != ''"
  );
  const varAliasTotal = db.exec("SELECT COUNT(*) FROM imports WHERE target_module = ''");
  const varAliasResolved = db.exec(
    "SELECT COUNT(*) FROM imports WHERE target_module = '' AND target_file != ''"
  );
  const rt = Number(relTotal[0]?.values[0][0] ?? 0);
  const rr = Number(relResolved[0]?.values[0][0] ?? 0);
  const bt = Number(bareTotal[0]?.values[0][0] ?? 0);
  const vat = Number(varAliasTotal[0]?.values[0][0] ?? 0);
  const varR = Number(varAliasResolved[0]?.values[0][0] ?? 0);
  console.log(`relative imports:  ${rt} total, ${rr} resolved (${rt > 0 ? ((rr/rt)*100).toFixed(1) : '0'}%)`);
  console.log(`bare specifiers:   ${bt} total, 0 resolved (external — correct behavior)`);
  console.log(`variable aliases:  ${vat} total, ${varR} resolved (${vat > 0 ? ((varR/vat)*100).toFixed(1) : '0'}%)`);

  // ─── B. Sample unresolved relative imports ─────────────────────
  console.log('\n=== B. unresolved relative imports (sample) ===');
  const unresolvedRel = db.exec(
    "SELECT source_file, target_module, imported_name, local_alias FROM imports WHERE (target_module LIKE './%' OR target_module LIKE '../%') AND target_file = '' LIMIT 10"
  );
  if (unresolvedRel.length > 0) {
    for (const row of unresolvedRel[0].values) {
      console.log(`  ${row[0]} | ${row[1]} | imported=${row[2] ?? '-'} | alias=${row[3]}`);
    }
  } else {
    console.log('  (none — all relative imports resolved)');
  }

  // ─── C. resolveCall callees — inspect raw edges ────────────────
  console.log('\n=== C. raw call edges from resolveCall ===');
  const resolveCallEdges = db.exec(
    `SELECT target_id, line FROM edges
     WHERE kind = 'calls'
       AND source_id = 'src/graph/builder.ts::function::resolveCall'
     ORDER BY line`
  );
  if (resolveCallEdges.length > 0) {
    for (const row of resolveCallEdges[0].values) {
      const target = String(row[0]);
      const status = target.startsWith('__unresolved::') ? 'UNRESOLVED' : 'resolved';
      console.log(`  line ${row[1]}: [${status}] ${target}`);
    }
  }

  // ─── D. Dependency queries with correct relative paths ─────────
  console.log('\n=== D. dependencies: src/graph/builder.ts (correct path) ===');
  const depsBuilder = await getDependencies(PROJECT_PATH, 'src/graph/builder.ts');
  console.log(`  imports (${depsBuilder.imports.length}):`);
  for (const d of depsBuilder.imports) {
    console.log(`    → ${d.filePath} (line ${d.line ?? '?'})`);
  }
  console.log(`  imported by (${depsBuilder.importedBy.length}):`);
  for (const d of depsBuilder.importedBy) {
    console.log(`    ← ${d.filePath}`);
  }

  console.log('\n=== E. dependencies: src/storage/db.ts (correct path) ===');
  const depsDb = await getDependencies(PROJECT_PATH, 'src/storage/db.ts');
  console.log(`  imports (${depsDb.imports.length}):`);
  for (const d of depsDb.imports) {
    console.log(`    → ${d.filePath} (line ${d.line ?? '?'})`);
  }
  console.log(`  imported by (${depsDb.importedBy.length}):`);
  for (const d of depsDb.importedBy) {
    console.log(`    ← ${d.filePath}`);
  }

  console.log('\n=== F. dependencies: src/server.ts (entry point) ===');
  const depsServer = await getDependencies(PROJECT_PATH, 'src/server.ts');
  console.log(`  imports (${depsServer.imports.length}):`);
  for (const d of depsServer.imports) {
    console.log(`    → ${d.filePath} (line ${d.line ?? '?'})`);
  }
  console.log(`  imported by (${depsServer.importedBy.length}):`);
  for (const d of depsServer.importedBy) {
    console.log(`    ← ${d.filePath}`);
  }

  console.log('\n=== supplementary queries complete ===');
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
