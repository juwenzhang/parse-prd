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

const SYSTEM_PROMPT = `你是一个资深的 PRD 标准化专家。
将解析出的结构化节点树重写为标准化的 PRD JSON。

规则：
1. 提取所有 FR、NFR、用户故事、领域实体
2. 缺失优先级根据上下文推断（P0=核心，P1=重要，P2=增强）
3. 缺失验收标准根据描述推导
4. 用户故事遵循"作为[角色]，我想要[目标]，以便[价值]"
5. 提取术语到 glossary
6. scope.inScope / outOfScope 明确区分
7. 所有输出中文`;

function buildPrompt(parsed: AgentOutput, ctx: CodebaseContext): string {
  return `将以下节点树重写为 JSON 格式的标准化 PRD。

节点树：
${JSON.stringify(parsed.nodes.slice(0, 30), null, 2)}

证据：
${JSON.stringify(parsed.evidence.slice(0, 20), null, 2)}

统计：${JSON.stringify(parsed.stats)}
${wrapContext(ctx)}`;
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
