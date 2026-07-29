/**
 * Quick smoke test — index this project's own source code and query it.
 */
import { indexProject } from '../src/graph/builder.js';
import { getCallGraph, getDependencies } from '../src/graph/query.js';
import { initParser } from '../src/indexer/parser.js';

const PROJECT_PATH = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

async function main() {
  console.log('=== arise-knowledge smoke test ===\n');
  console.log(`Project path: ${PROJECT_PATH}`);

  // 1. Initialize parser
  console.log('\n[1] Initializing tree-sitter...');
  await initParser();
  console.log('    OK');

  // 2. Index the project (only TypeScript)
  console.log('\n[2] Indexing project (TypeScript only, no embeddings)...');
  const result = await indexProject(PROJECT_PATH, {
    languages: ['typescript'],
    force: true,
  });
  console.log(`    Indexed: ${result.indexedFiles} files`);
  console.log(`    Entities: ${result.entities}`);
  console.log(`    Edges: ${result.edges}`);
  console.log(`    Duration: ${result.durationMs}ms`);
  console.log(`    Skipped: ${result.skippedFiles}`);

  if (result.entities === 0) {
    console.error('\n    ERROR: No entities found!');
    process.exit(1);
  }

  // 3. Query call graph
  console.log('\n[3] Querying call graph for "indexProject"...');
  const callGraph = await getCallGraph(PROJECT_PATH, 'indexProject');
  if (callGraph) {
    console.log(`    Found: ${callGraph.entity.name} (${callGraph.entity.kind})`);
    console.log(`    Callers: ${callGraph.callers.length}`);
    console.log(`    Callees: ${callGraph.callees.length}`);
  } else {
    console.log('    Not found (may be expected if resolution is partial)');
  }

  // 4. Query dependencies
  console.log('\n[4] Querying dependencies for "src/server.ts"...');
  const deps = await getDependencies(PROJECT_PATH, 'src/server.ts');
  console.log(`    Imports: ${deps.imports.length}`);
  console.log(`    Imported by: ${deps.importedBy.length}`);

  console.log('\n=== Smoke test passed! ===');
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
