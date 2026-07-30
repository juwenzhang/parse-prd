import {logger} from '../logger';
import type {CodebaseContext} from '../scanner/types';

import {llmStructuredOutput} from './llm';
import {wrapContext} from './pipeline';
import {
  advanceState,
  checkReviewDone,
  readLayerOutput,
  readReviewOutput,
  readState,
  writeLayerOutput
} from './store';
import type {OpenSpecProposal, StandardizedPRD} from './types';
import {OpenSpecProposalSchema} from './types';

const SYSTEM_PROMPT = `你是一个资深系统架构师。基于标准化 PRD 和现有代码上下文生成 OpenSpec 提案。

规则：
1. 必须至少 2 个模块，各有职责描述
2. 每个模块至少 1 个 API 端点（不重复已有 API）
3. 从 domainEntities 和已有模型推导数据模型概要
4. 至少 2 个风险点
5. 评估工作量 XS/S/M/L/XL
6. 至少 2 个开放问题
7. 新模块不得与已有 OpenSpec 规范重复
8. 所有输出中文
9. 绝不返回空列表`;

function buildPrompt(prd: StandardizedPRD, ctx: CodebaseContext): string {
  return `生成 OpenSpec 提案的 JSON。

标准化 PRD：
${JSON.stringify(prd, null, 2).slice(0, 8000)}
${wrapContext(ctx)}`;
}

export async function runProposal(
  documentId: string,
  prd: StandardizedPRD,
  ctx: CodebaseContext,
  cwd = '.'
): Promise<OpenSpecProposal> {
  const state = await readState(documentId, cwd);

  if (state?.status['2'] === 'approved') {
    const existing = await readLayerOutput<OpenSpecProposal>(documentId, 2, cwd);
    if (existing) {
      logger.info('layer 2 already approved, skipping');
      return existing;
    }
  }

  const reviewReviewed = await checkReviewDone(documentId, 2, cwd);
  if (reviewReviewed) {
    const reviewed = await readReviewOutput<OpenSpecProposal>(documentId, 2, cwd);
    if (reviewed?.specId) {
      logger.info('loading human-reviewed layer 2');
      await advanceState(documentId, 2, cwd);
      return reviewed;
    }
  }

  logger.info('layer 2: proposal');

  const result = await llmStructuredOutput({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(prd, ctx),
    schema: OpenSpecProposalSchema,
    schemaName: 'OpenSpecProposal'
  });

  await writeLayerOutput(documentId, 2, result, cwd);
  return result;
}
