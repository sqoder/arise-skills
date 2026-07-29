/**
 * Verification test for import-alias-aware call resolution.
 *
 * Indexes tests/fixtures/alias-test/ as a standalone "project" and checks
 * that qualified calls inside `useService()` resolve to the right entities:
 *   - service.foo()        → AuthService.foo (method)
 *   - authInit()           → authInit (function)
 *   - authNs.authInit()    → authInit (function, via namespace import)
 *   - rs.foo()             → AuthService.foo (method, via renamed import)
 *   - AuthService.create() → AuthService.create (static method)
 */
import { indexProject } from '../src/graph/builder.js';
import { getCallGraph } from '../src/graph/query.js';
import { getDatabase } from '../src/storage/db.js';
import { initParser } from '../src/indexer/parser.js';

const PROJECT_PATH = new URL('fixtures/alias-test/', import.meta.url).pathname.replace(/\/$/, '');

type Expected = {
  description: string;
  calleeName: string;     // entity name that should appear in callees
  calleeKind: string;     // entity kind
};

const EXPECTED: Expected[] = [
  { description: 'service.foo() → AuthService.foo',           calleeName: 'AuthService.foo', calleeKind: 'method' },
  { description: 'authInit() → authInit',                      calleeName: 'authInit',        calleeKind: 'function' },
  { description: 'authNs.authInit() → authInit (namespace)',   calleeName: 'authInit',        calleeKind: 'function' },
  { description: 'rs.foo() → AuthService.foo (renamed)',       calleeName: 'AuthService.foo', calleeKind: 'method' },
  { description: 'AuthService.create() → AuthService.create',  calleeName: 'AuthService.create', calleeKind: 'method' },
];

async function main() {
  console.log('=== import-alias resolution test ===\n');
  console.log(`Fixture: ${PROJECT_PATH}\n`);

  await initParser();

  console.log('[1] Indexing fixture...');
  const result = await indexProject(PROJECT_PATH, { languages: ['typescript'], force: true });
  console.log(`    Indexed: ${result.indexedFiles} files, ${result.entities} entities, ${result.edges} edges\n`);

  // Dump imports table for debugging
  const db = await getDatabase(PROJECT_PATH);
  console.log('[2] imports table:');
  const importRows = db.exec('SELECT source_file, target_file, target_module, imported_name, local_alias, import_kind FROM imports');
  if (importRows.length > 0) {
    for (const row of importRows[0].values) {
      console.log(`    ${row[0]} | target=${row[1] || '(unresolved)'} | module=${row[2]} | imported=${row[3] || '-'} | alias=${row[4]} | kind=${row[5]}`);
    }
  } else {
    console.log('    (empty)');
  }
  console.log();

  // Dump resolved call edges from useService
  console.log('[3] call edges from useService:');
  const callEdges = db.exec(
    `SELECT e.target_id, e.line FROM edges e
     WHERE e.kind = 'calls' AND e.source_id = ?`,
    ['tests/fixtures/alias-test/consumer.ts::function::useService']
  );
  const resolvedCallees: string[] = [];
  if (callEdges.length > 0) {
    for (const row of callEdges[0].values) {
      const target = String(row[0]);
      const line = row[1];
      const status = target.startsWith('__unresolved::') ? 'UNRESOLVED' : 'resolved';
      console.log(`    line ${line}: [${status}] ${target}`);
      if (!target.startsWith('__unresolved::')) resolvedCallees.push(target);
    }
  } else {
    console.log('    (no call edges found)');
  }
  console.log();

  // Query call graph and check
  console.log('[4] Querying call graph for useService...');
  const cg = await getCallGraph(PROJECT_PATH, 'useService');
  if (!cg) {
    console.error('    FAIL: useService entity not found');
    process.exit(1);
  }
  console.log(`    Found entity: ${cg.entity.name} (${cg.entity.kind})`);
  console.log(`    Callees: ${cg.callees.length}`);
  for (const c of cg.callees) {
    console.log(`      → ${c.entity.name} (${c.entity.kind}) at ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
  }
  console.log();

  // Verify each expectation
  console.log('[5] Verifying expectations:');
  const calleeNames = new Set(cg.callees.map((c) => c.entity.name));
  let pass = 0, fail = 0;
  for (const exp of EXPECTED) {
    const ok = calleeNames.has(exp.calleeName);
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`    [${mark}] ${exp.description}`);
    if (ok) pass++; else fail++;
  }
  console.log();

  console.log(`=== Result: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);

  // ---- Disambiguation test: two classes both have foo() ----
  console.log('\n=== disambiguation test (no false positives) ===\n');

  console.log('[6] imports table (after fix):');
  const importRows2 = db.exec('SELECT source_file, target_file, target_module, imported_name, local_alias, import_kind FROM imports');
  if (importRows2.length > 0) {
    for (const row of importRows2[0].values) {
      console.log(`    ${row[0]} | target=${row[1] || '(unresolved)'} | module=${row[2]} | imported=${row[3] || '-'} | alias=${row[4]} | kind=${row[5]}`);
    }
  }
  console.log();

  console.log('[7] Querying call graph for useBoth...');
  const cg2 = await getCallGraph(PROJECT_PATH, 'useBoth');
  if (!cg2) {
    console.error('    FAIL: useBoth entity not found');
    process.exit(1);
  }
  console.log(`    Found entity: ${cg2.entity.name} (${cg2.entity.kind})`);
  console.log(`    Callees: ${cg2.callees.length}`);
  for (const c of cg2.callees) {
    console.log(`      → ${c.entity.name} (${c.entity.kind}) at ${c.entity.filePath}:${c.callSite?.line ?? '?'}`);
  }
  console.log();

  type ConflictExpected = { description: string; calleeName: string; calleeFile: string };
  const conflictExpected: ConflictExpected[] = [
    { description: 'a.foo() → AuthService.foo (not OtherService.foo)', calleeName: 'AuthService.foo', calleeFile: 'auth.ts' },
    { description: 'b.foo() → OtherService.foo (not AuthService.foo)', calleeName: 'OtherService.foo', calleeFile: 'other.ts' },
    { description: 'b.bar() → OtherService.bar',                       calleeName: 'OtherService.bar', calleeFile: 'other.ts' },
  ];

  console.log('[8] Verifying disambiguation:');
  let pass2 = 0, fail2 = 0;
  for (const exp of conflictExpected) {
    const found = cg2.callees.find((c) => c.entity.name === exp.calleeName && c.entity.filePath === exp.calleeFile);
    const mark = found ? 'PASS' : 'FAIL';
    console.log(`    [${mark}] ${exp.description}`);
    if (found) pass2++; else fail2++;
  }
  console.log();

  // Also assert NO false positive: AuthService.foo should appear exactly once
  // in useBoth's callees (not twice from the global fallback picking both).
  const aFooCount = cg2.callees.filter((c) => c.entity.name === 'AuthService.foo').length;
  const oFooCount = cg2.callees.filter((c) => c.entity.name === 'OtherService.foo').length;
  console.log(`    [${aFooCount === 1 ? 'PASS' : 'FAIL'}] AuthService.foo appears exactly once (got ${aFooCount})`);
  console.log(`    [${oFooCount === 1 ? 'PASS' : 'FAIL'}] OtherService.foo appears exactly once (got ${oFooCount})`);
  if (aFooCount !== 1) fail2++;
  if (oFooCount !== 1) fail2++;
  pass2 += (aFooCount === 1 ? 1 : 0) + (oFooCount === 1 ? 1 : 0);

  console.log(`\n=== Disambiguation result: ${pass2} passed, ${fail2} failed ===`);
  if (fail2 > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
