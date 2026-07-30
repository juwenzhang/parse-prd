import fs from 'node:fs/promises';
import path from 'node:path';

const ROUTE_PATTERNS = [
  /\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi,
  /router\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi,
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]+)['"]/gi,
  /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi
];

async function scanFile(filePath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    for (const pattern of ROUTE_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const method = (match[1] ?? '').toUpperCase();
        const route = match[2] ?? '';
        if (method && route) {
          results.push(`${method} ${route}`);
        }
      }
    }
  } catch {
    // skip unreadable files
  }
  return results;
}

export async function scanRoutes(root: string): Promise<string[]> {
  const scanDirs = [
    'src/routes',
    'src/controllers',
    'src/handlers',
    'routes',
    'controllers',
    'app'
  ];
  const allResults: string[] = [];

  for (const dir of scanDirs) {
    const fullDir = path.join(root, dir);
    try {
      const files = await fs.readdir(fullDir, {withFileTypes: true});
      for (const file of files) {
        if (file.isFile() && /\.(ts|js|mjs|py|go|rs)$/.test(file.name)) {
          const apis = await scanFile(path.join(fullDir, file.name));
          allResults.push(...apis);
        }
      }
    } catch {
      // directory doesn't exist, skip
    }
  }

  return [...new Set(allResults)].sort();
}
