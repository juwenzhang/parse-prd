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

const SYSTEM_PROMPT = `你是一个资深的产品方案设计师。
你的任务是基于业务需求文档，设计清晰的产品方案。

核心原则：
1. 模块拆分按业务流程划分（用户端、管理端、数据看板等），不是按技术分层
2. 每个模块描述要面向产品经理可读，不是面向开发者
3. API 端点设计用业务语义命名（/orders/refund 而不是 /api/v1/refund）
4. 数据模型只列核心业务实体，不列技术中间表
5. 风险点聚焦在需求理解偏差、用户场景遗漏，而非技术风险
6. 开放问题是产品经理需要和业务方确认的，而非技术选型问题
7. 所有输出中文
8. 绝不返回空列表`;

function buildPrompt(prd: StandardizedPRD, ctx: CodebaseContext): string {
  return `基于以下业务需求文档，设计产品方案的 JSON。

业务需求文档（这是你真正要设计的产品）：
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
