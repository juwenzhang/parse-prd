import type {OpenSpecContext} from './openspec';

export interface CodebaseContext {
  root: string;
  techStack: {
    language: string;
    framework?: string;
    dependencies: string[];
  };
  packageManager?: string;
  directoryStructure: string[];
  existingAPIs: string[];
  existingModels: string[];
  existingSpecs: string[];
  openSpec: OpenSpecContext;
}
