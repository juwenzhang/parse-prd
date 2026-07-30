import fs from 'node:fs/promises';
import path from 'node:path';

export async function scanDeps(root: string): Promise<{
  language: string;
  framework?: string;
  dependencies: string[];
  packageManager?: string;
}> {
  const result: ReturnType<typeof scanDeps> extends Promise<infer T> ? T : never = {
    language: 'unknown',
    dependencies: []
  };

  try {
    const pkgRaw = await fs.readFile(path.join(root, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

    result.language = 'TypeScript/JavaScript';

    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {})
    };

    const frameworkMap: Array<{key: string; name: string}> = [
      {key: 'express', name: 'Express'},
      {key: 'fastify', name: 'Fastify'},
      {key: 'koa', name: 'Koa'},
      {key: 'hono', name: 'Hono'},
      {key: 'next', name: 'Next.js'},
      {key: 'nuxt', name: 'Nuxt'},
      {key: 'react', name: 'React'},
      {key: 'vue', name: 'Vue'}
    ];

    for (const {key, name} of frameworkMap) {
      if (deps[key]) {
        result.framework = name;
        break;
      }
    }

    result.dependencies = Object.keys(deps).filter(k => !k.startsWith('@types/'));
    result.packageManager = pkg.packageManager
      ? String(pkg.packageManager).split('@')[0]
      : undefined;
  } catch {
    result.language = 'unknown';
  }

  return result;
}
