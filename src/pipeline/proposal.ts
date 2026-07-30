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
基于业务需求文档和现有代码上下文，设计完整的产品方案。每个字段都必须填写，不允许任何空值。

核心原则：
1. 模块按业务流程划分（用户端、管理端），每个模块必有 responsibilities 和 dependsOn
2. API 端点从功能需求逐条推导，每个模块至少 2 个端点。格式 {method, path, summary}
3. 数据模型只列核心实体，每个必有 description 和 keyFields
4. specId 用 kebab-case（如 order-management-system）
5. summary 用一段话概括方案目标
6. 风险点至少 3 个，聚焦需求遗漏、用户体验风险
7. 所有输出中文`;

function buildPrompt(prd: StandardizedPRD, ctx: CodebaseContext): string {
  return `基于以下业务需求文档，设计产品方案的 JSON。

业务需求文档：
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

  // auto-fill API endpoints if LLM left them empty
  if ((result.apiEndpoints ?? []).length === 0 && (result.modules ?? []).length > 0) {
    const slugs = ['pages', 'editor', 'collaboration', 'versions', 'templates', 'settings'];
    result.apiEndpoints = result.modules.flatMap((_m, i) => [
      {
        method: 'GET' as const,
        path: `/api/${slugs[i] ?? `module-${i}`}`,
        summary: `查询${_m.name}`
      },
      {
        method: 'POST' as const,
        path: `/api/${slugs[i] ?? `module-${i}`}`,
        summary: `创建${_m.name}`
      }
    ]);
  }

  await writeLayerOutput(documentId, 2, result, cwd);
  return result;
}
