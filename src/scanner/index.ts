import {logger} from '../logger';

import {scanDeps} from './deps';
import {scanExistingSpecs, scanModels} from './models';
import {scanOpenSpec} from './openspec';
import {scanRoutes} from './routes';
import {scanStructure} from './structure';
import type {CodebaseContext} from './types';

export {buildContextSummary} from './context';
export type {OpenSpecConfig, OpenSpecContext, OpenSpecSpec} from './openspec';
export type {CodebaseContext} from './types';

export async function scanCodebase(root: string): Promise<CodebaseContext> {
  logger.info({root}, 'scanning codebase');

  const [techStack, directoryStructure, existingAPIs, existingModels, existingSpecs, openSpec] =
    await Promise.all([
      scanDeps(root),
      scanStructure(root),
      scanRoutes(root),
      scanModels(root),
      scanExistingSpecs(root),
      scanOpenSpec(root)
    ]);

  const ctx: CodebaseContext = {
    root,
    techStack,
    packageManager: techStack.packageManager,
    directoryStructure,
    existingAPIs,
    existingModels,
    existingSpecs,
    openSpec
  };

  logger.info(
    {
      lang: ctx.techStack.language,
      apis: ctx.existingAPIs.length,
      models: ctx.existingModels.length,
      osSpecs: ctx.openSpec.specs.length,
      osReady: ctx.openSpec.codeBuddyReady
    },
    'codebase scan complete'
  );

  return ctx;
}
