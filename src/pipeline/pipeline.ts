import type {AgentOutput} from '../agent';
import {logger} from '../logger';
import {buildContextSummary, scanCodebase} from '../scanner/index';
import type {CodebaseContext} from '../scanner/types';

import {runGenerate} from './generate';
import {runProposal} from './proposal';
import {runStandardize} from './standardize';
import {initState, readLayerOutput, readState} from './store';
import type {OpenSpecProposal, PipelineLayer, StandardizedPRD} from './types';

export async function runPipeline(
  documentId: string,
  parsed: AgentOutput,
  startLayer: PipelineLayer = 1,
  cwd = '.'
): Promise<void> {
  const ctx = await scanCodebase(cwd);

  if (parsed.nodes.length === 0 || parsed.stats.totalNodes === 0) {
    throw new Error('无法从输入文档中提取有效内容，流水线中止');
  }

  let state = await readState(documentId, cwd);
  if (!state) {
    state = await initState(documentId, cwd);
  }

  if (startLayer <= 1) {
    await runStandardize(documentId, parsed, ctx, cwd);
    logger.info(`layer 1 done → ${cwd}/.prd-pipeline/{docId}/1-standardize.json`);
  }

  if (startLayer <= 2) {
    const prd = await readLayerOutput<StandardizedPRD>(documentId, 1, cwd);
    if (!prd) throw new Error('Layer 1 output not found');
    await runProposal(documentId, prd, ctx, cwd);
    logger.info(`layer 2 done → ${cwd}/.prd-pipeline/{docId}/2-proposal.json`);
  }

  if (startLayer <= 3) {
    const prd = await readLayerOutput<StandardizedPRD>(documentId, 1, cwd);
    const proposal = await readLayerOutput<OpenSpecProposal>(documentId, 2, cwd);
    if (!prd || !proposal) throw new Error('Layer 1 or 2 output not found');
    const outDir = await runGenerate(documentId, prd, proposal, ctx, cwd);
    logger.info(`layer 3 done → ${outDir}`);
  }

  logger.info('pipeline complete');
}

export function wrapContext(ctx: CodebaseContext): string {
  const summary = buildContextSummary(ctx);
  return `\n\n## 现有代码上下文\n${summary}\n\n新模块不得与已有 spec/API 重复，技术方案需与现有技术栈一致。`;
}
