import fs from 'node:fs/promises';
import path from 'node:path';

const MODEL_PATTERNS = [
  /export\s+(?:interface|type)\s+(\w+)\s*\{/g,
  /export\s+class\s+(\w+)\s*\{/g,
  /@Entity\s*\(\)\s*\n*\s*export\s+class\s+(\w+)/g,
  /mongoose\.model\s*\(\s*['"](\w+)['"]/gi
];

async function scanFile(filePath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    for (const pattern of MODEL_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const name = match[1];
        if (name && !['Request', 'Response', 'NextFunction'].includes(name)) {
          results.push(name);
        }
      }
    }
  } catch {
    // skip
  }
  return results;
}

export async function scanModels(root: string): Promise<string[]> {
  const scanDirs = ['src/models', 'src/entities', 'models', 'entities', 'src/types'];
  const allResults: string[] = [];

  for (const dir of scanDirs) {
    const fullDir = path.join(root, dir);
    try {
      const files = await fs.readdir(fullDir, {withFileTypes: true});
      for (const file of files) {
        if (file.isFile() && /\.(ts|js|mjs)$/.test(file.name)) {
          const models = await scanFile(path.join(fullDir, file.name));
          allResults.push(...models);
        }
      }
    } catch {
      // skip
    }
  }

  return [...new Set(allResults)].sort();
}

export async function scanExistingSpecs(root: string): Promise<string[]> {
  const specsDir = path.join(root, 'openspec', 'specs');
  try {
    const entries = await fs.readdir(specsDir, {withFileTypes: true});
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
