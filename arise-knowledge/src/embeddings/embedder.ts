/**
 * Vector embedding generation using Transformers.js (local, no API key needed).
 */
import { pipeline } from '@xenova/transformers';

let embedPipeline: any = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

/** Initialize the embedding pipeline (lazy, first call downloads model) */
async function getEmbedder(): Promise<any> {
  if (!embedPipeline) {
    embedPipeline = await pipeline('feature-extraction', MODEL_NAME, {
      quantized: true,
    });
  }
  return embedPipeline;
}

/** Generate embedding vector for a text string */
export async function generateEmbedding(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const result = await embedder(text, { pooling: 'mean', normalize: true });
  // result.data is Float32Array
  return Array.from(result.data as Float32Array);
}

/** Generate embeddings for multiple texts in batch */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const results: number[][] = [];

  // Process in batches — Transformers.js supports array input for batch inference
  const batchSize = 32;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    // Pass the batch as array for parallel inference when supported
    const batchResults = await embedder(batch, { pooling: 'mean', normalize: true });
    // batchResults.data contains all embeddings concatenated
    const dim = 384;
    for (let j = 0; j < batch.length; j++) {
      const start = j * dim;
      const embedding = Array.from(
        (batchResults.data as Float32Array).slice(start, start + dim)
      );
      results.push(embedding);
    }
  }

  return results;
}

/** Get the embedding dimension for the current model */
export function getEmbeddingDimension(): number {
  return 384; // all-MiniLM-L6-v2 dimension
}
