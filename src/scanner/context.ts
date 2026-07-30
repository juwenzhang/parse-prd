import {buildOpenSpecSummary} from './openspec';
import type {CodebaseContext} from './types';

export function buildContextSummary(ctx: CodebaseContext): string {
  const lines: string[] = [];

  lines.push(`语言: ${ctx.techStack.language}`);
  if (ctx.techStack.framework) lines.push(`框架: ${ctx.techStack.framework}`);
  if (ctx.techStack.dependencies.length > 0) {
    lines.push(`关键依赖: ${ctx.techStack.dependencies.slice(0, 15).join(', ')}`);
  }

  if (ctx.directoryStructure.length > 0) {
    lines.push(`目录结构:\n${ctx.directoryStructure.map(d => `  - ${d}`).join('\n')}`);
  }

  if (ctx.existingAPIs.length > 0) {
    lines.push(
      `已有 API (${ctx.existingAPIs.length}):\n${ctx.existingAPIs
        .slice(0, 20)
        .map(a => `  ${a}`)
        .join('\n')}`
    );
  }

  if (ctx.existingModels.length > 0) {
    lines.push(`已有数据模型: ${ctx.existingModels.join(', ')}`);
  }

  if (ctx.existingSpecs.length > 0) {
    lines.push(`已有 OpenSpec 规范: ${ctx.existingSpecs.join(', ')}`);
  }

  const osSummary = buildOpenSpecSummary(ctx.openSpec);
  if (osSummary) {
    lines.push(`\n${osSummary}`);
  }

  if (ctx.packageManager) lines.push(`包管理器: ${ctx.packageManager}`);

  return lines.join('\n');
}
