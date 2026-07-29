/**
 * tree-sitter based multi-language AST parser.
 */
import Parser from 'web-tree-sitter';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { Language } from '../graph/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let parserInitialized = false;
const parsers = new Map<Language, Parser>();

/** Grammar WASM file mapping */
const GRAMMAR_FILES: Record<Language, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
};

/** Initialize tree-sitter and load grammars */
export async function initParser(): Promise<void> {
  if (parserInitialized) return;

  await Parser.init();
  parserInitialized = true;
}

/** Get or create a parser for a specific language */
export async function getParser(language: Language): Promise<Parser> {
  if (!parserInitialized) {
    await initParser();
  }

  const existing = parsers.get(language);
  if (existing) return existing;

  const parser = new Parser();
  const grammarFile = GRAMMAR_FILES[language];

  // Look for grammar files in multiple locations
  const searchPaths = [
    path.join(__dirname, '../../node_modules/tree-sitter-wasms/out', grammarFile),
    path.join(__dirname, '../../grammars', grammarFile),
    path.join(process.cwd(), 'node_modules/tree-sitter-wasms/out', grammarFile),
    path.join(process.cwd(), 'grammars', grammarFile),
  ];

  let grammarPath: string | null = null;
  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      grammarPath = p;
      break;
    }
  }

  if (!grammarPath) {
    throw new Error(
      `Grammar file not found for ${language}: ${grammarFile}. ` +
      `Searched: ${searchPaths.join(', ')}`
    );
  }

  const lang = await Parser.Language.load(grammarPath);
  parser.setLanguage(lang);
  parsers.set(language, parser);

  return parser;
}

/** Parse source code and return the tree */
export async function parseSource(
  source: string,
  language: Language
): Promise<Parser.Tree> {
  const parser = await getParser(language);
  return parser.parse(source);
}

/** Parse a file from disk */
export async function parseFile(
  filePath: string,
  language: Language
): Promise<Parser.Tree> {
  const source = fs.readFileSync(filePath, 'utf-8');
  return parseSource(source, language);
}
