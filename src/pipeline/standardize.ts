import type {AgentOutput} from '../agent';
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
import type {StandardizedPRD} from './types';
import {StandardizedPRDSchema} from './types';

const SYSTEM_PROMPT = `你是一个资深的业务需求分析师。
你的任务是将原始 PRD 文档的 AST 节点树，重写为一份清晰、完整的业务需求文档。

核心原则：
1. 先理解原始文档说的是什么产品/系统，再围绕这个产品展开分析
2. 遵循 "问题背景 → 要解决什么 → 具体怎么做" 的三层结构
3. 功能需求（FR）必须是面向用户的业务功能，不是技术实现细节
4. 用户故事必须包含真实角色和真实场景，不能是泛化的"用户"
5. domainEntities 是从需求中自然抽象出的业务概念（订单、用户、商品等）
6. 非功能需求只在原始文档明确提及时才写，不要臆造
7. 如果原始文档包含图片/UI 描述节点，将其转化为对应的交互说明
8. 所有输出必须是中文`;

function buildPrompt(parsed: AgentOutput, ctx: CodebaseContext): string {
  const nodesPreview = JSON.stringify(parsed.nodes.slice(0, 30), null, 2);

  return `以下是原始 PRD 文档解析后的 AST 节点树。
请基于这些内容，重写为 JSON 格式的业务需求文档。

节点树（这是你要分析的产品需求，不是你要设计的工具）：
${nodesPreview}

统计信息（节点总数、类型分布）：${JSON.stringify(parsed.stats)}
${wrapContext(ctx)}

请输出符合 StandardizedPRD schema 的 JSON 对象。每一个字段都围绕这个产品展开，而不是描述"文档解析工具"。`;
}

export async function runStandardize(
  documentId: string,
  parsed: AgentOutput,
  ctx: CodebaseContext,
  cwd = '.'
): Promise<StandardizedPRD> {
  const state = await readState(documentId, cwd);

  if (state?.status['1'] === 'approved') {
    const existing = await readLayerOutput<StandardizedPRD>(documentId, 1, cwd);
    if (existing) {
      logger.info('layer 1 already approved, skipping');
      return existing;
    }
  }

  const reviewReviewed = await checkReviewDone(documentId, 1, cwd);
  if (reviewReviewed) {
    const reviewed = await readReviewOutput<StandardizedPRD>(documentId, 1, cwd);
    if (reviewed?.meta) {
      logger.info('loading human-reviewed layer 1');
      await advanceState(documentId, 1, cwd);
      return reviewed;
    }
  }

  logger.info('layer 1: standardize');

  const result = await llmStructuredOutput({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(parsed, ctx),
    schema: StandardizedPRDSchema,
    schemaName: 'StandardizedPRD'
  });

  await writeLayerOutput(documentId, 1, result, cwd);
  return result;
}
