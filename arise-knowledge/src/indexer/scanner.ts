/**
 * File system scanner — finds code files respecting .gitignore.
 */
import fg from 'fast-glob';
import ignore, { type Ignore } from 'ignore';
import fs from 'fs';
import path from 'path';
import { LANGUAGE_EXTENSIONS, type Language } from '../graph/types.js';

export interface ScannedFile {
  path: string;          // absolute path
  relativePath: string;  // relative to project root
  language: Language;
}

/** Scan a project directory for supported code files */
export async function scanProject(
  projectPath: string,
  languages?: Language[]
): Promise<ScannedFile[]> {
  const ig = loadGitignore(projectPath);

  // Build glob patterns from supported extensions
  const extensions = Object.entries(LANGUAGE_EXTENSIONS)
    .filter(([, lang]) => !languages || languages.includes(lang))
    .map(([ext]) => ext.slice(1)); // remove leading dot

  const pattern = `**/*.{${extensions.join(',')}}`;

  const files = await fg(pattern, {
    cwd: projectPath,
    absolute: false,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/vendor/**',
      '**/target/**',     // Rust
      '**/__pycache__/**',
      '**/.venv/**',
      '**/venv/**',
    ],
  });

  // Apply .gitignore filtering
  const filtered = ig ? files.filter((f) => !ig.ignores(f)) : files;

  return filtered.map((relativePath) => {
    const ext = path.extname(relativePath);
    return {
      path: path.resolve(projectPath, relativePath),
      relativePath,
      language: LANGUAGE_EXTENSIONS[ext]!,
    };
  });
}

/** Load .gitignore rules if present */
function loadGitignore(projectPath: string): Ignore | null {
  const gitignorePath = path.join(projectPath, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return null;
  }

  const content = fs.readFileSync(gitignorePath, 'utf-8');
  return ignore().add(content);
}
