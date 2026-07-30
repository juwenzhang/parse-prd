import {logger} from '../logger';

import {scanDeps} from './deps';
import {scanExistingSpecs, scanModels} from './models';
import {scanRoutes} from './routes';
import {scanStructure} from './structure';
import type {CodebaseContext} from './types';

export {buildContextSummary} from './context';
export type {CodebaseContext} from './types';

export async function scanCodebase(root: string): Promise<CodebaseContext> {
  logger.info({root}, 'scanning codebase');

  const [techStack, directoryStructure, existingAPIs, existingModels, existingSpecs] =
    await Promise.all([
      scanDeps(root),
      scanStructure(root),
      scanRoutes(root),
      scanModels(root),
      scanExistingSpecs(root)
    ]);

  const ctx: CodebaseContext = {
    root,
    techStack,
    packageManager: techStack.packageManager,
    directoryStructure,
    existingAPIs,
    existingModels,
    existingSpecs
  };

  logger.info(
    {
      lang: ctx.techStack.language,
      framework: ctx.techStack.framework,
      apis: ctx.existingAPIs.length,
      models: ctx.existingModels.length,
      specs: ctx.existingSpecs.length
    },
    'codebase scan complete'
  );

  return ctx;
}
