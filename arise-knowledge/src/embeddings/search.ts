/**
 * Vector similarity search using vectra (local file-based vector index).
 */
import { LocalIndex } from 'vectra';
import path from 'path';
import fs from 'fs';
import { generateEmbedding } from './embedder.js';
import type { Entity } from '../graph/types.js';

let index: LocalIndex | null = null;
let currentIndexPath: string | null = null;

/** Get or create the vector index for a project */
export async function getVectorIndex(projectPath: string): Promise<LocalIndex> {
  const indexDir = path.join(projectPath, '.arise', 'knowledge', 'vectors');

  if (index && currentIndexPath === indexDir) {
    return index;
  }

  if (!fs.existsSync(indexDir)) {
    fs.mkdirSync(indexDir, { recursive: true });
  }

  index = new LocalIndex(indexDir);

  if (!await index.isIndexCreated()) {
    await index.createIndex();
  }

  currentIndexPath = indexDir;
  return index;
}

/** Add or update an entity in the vector index */
export async function upsertEntityVector(
  projectPath: string,
  entity: Entity,
  codeSnippet: string
): Promise<void> {
  const idx = await getVectorIndex(projectPath);

  // Build the text to embed: signature + doc + snippet
  const textParts = [
    entity.signature ?? '',
    entity.docComment ?? '',
    codeSnippet.slice(0, 500),
  ].filter(Boolean);

  const text = textParts.join('\n');
  if (!text.trim()) return;

  const vector = await generateEmbedding(text);

  // Check if item exists and update, or insert
  try {
    await idx.deleteItem(entity.id);
  } catch {
    // Item doesn't exist, that's fine
  }

  await idx.insertItem({
    id: entity.id,
    vector,
    metadata: {
      name: entity.name,
      kind: entity.kind,
      filePath: entity.filePath,
      language: entity.language,
      module: entity.module ?? '',
      signature: entity.signature ?? '',
      text: text.slice(0, 200), // Store truncated text for display
    },
  });
}

/** Search for similar code entities by natural language query */
export async function searchSimilar(
  projectPath: string,
  query: string,
  options: { limit?: number; kind?: string; language?: string } = {}
): Promise<SearchResult[]> {
  const { limit = 10, kind, language } = options;
  const idx = await getVectorIndex(projectPath);

  if (!await idx.isIndexCreated()) {
    return [];
  }

  const queryVector = await generateEmbedding(query);

  const results = await idx.queryItems(queryVector, '', limit * 2); // over-fetch for filtering

  let filtered = results;

  // Apply filters
  if (kind) {
    filtered = filtered.filter((r) => r.item.metadata.kind === kind);
  }
  if (language) {
    filtered = filtered.filter((r) => r.item.metadata.language === language);
  }

  return filtered.slice(0, limit).map((r) => ({
    id: r.item.id,
    score: r.score,
    name: r.item.metadata.name as string,
    kind: r.item.metadata.kind as string,
    filePath: r.item.metadata.filePath as string,
    language: r.item.metadata.language as string,
    signature: r.item.metadata.signature as string,
    snippet: r.item.metadata.text as string,
  }));
}

export interface SearchResult {
  id: string;
  score: number;
  name: string;
  kind: string;
  filePath: string;
  language: string;
  signature: string;
  snippet: string;
}
