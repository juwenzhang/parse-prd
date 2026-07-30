import fs from 'node:fs/promises';
import path from 'node:path';

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.prd-pipeline',
  'openspec',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  'venv',
  '.venv',
  'target',
  '.turbo'
]);

export async function scanStructure(root: string): Promise<string[]> {
  const entries: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;

    let dirents: Array<{name: string; isDirectory: () => boolean}>;
    try {
      dirents = (await fs.readdir(dir, {withFileTypes: true})) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      return;
    }

    for (const item of dirents) {
      if (item.name.startsWith('.') || EXCLUDE_DIRS.has(item.name)) continue;

      const fullPath = path.join(dir, item.name);
      const relPath = path.relative(root, fullPath);

      if (item.isDirectory()) {
        entries.push(`${relPath}/`);
        if (depth < 3) await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(root, 0);

  return entries
    .filter(e => e.endsWith('/'))
    .filter(e => !e.split('/').some(seg => EXCLUDE_DIRS.has(seg)))
    .slice(0, 30);
}
