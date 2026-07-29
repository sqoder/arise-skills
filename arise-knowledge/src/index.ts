/**
 * Entry point — starts the arise-knowledge MCP server.
 */
import { startServer } from './server.js';
import { closeDatabase } from './storage/db.js';

// Graceful shutdown: save database before exit
function shutdown() {
  console.error('arise-knowledge: shutting down, saving database...');
  try {
    closeDatabase();
  } catch (err) {
    console.error('arise-knowledge: error during shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('beforeExit', () => {
  closeDatabase();
});

startServer().catch((error) => {
  console.error('Failed to start arise-knowledge server:', error);
  process.exit(1);
});
