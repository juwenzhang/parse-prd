import fs from 'node:fs/promises';
import path from 'node:path';

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
5. domainEntities 是从需求中自然抽象出的业务概念。每个实体必须包含 attributes（字段列表，至少 3 个），字段包含 name、type、description
6. constraints 字段必须引用上下文中已有的技术栈信息，不要臆造
7. 如果原始文档包含图片/UI 描述节点，将其转化为对应的交互说明
8. glossary 字段提取文档中的业务术语并给出定义
9. 所有输出必须是中文`;

function buildPrompt(parsed: AgentOutput, ctx: CodebaseContext): string {
  const nodesPreview = JSON.stringify(parsed.nodes.slice(0, 30), null, 2);

  return `以下是原始 PRD 文档解析后的 AST 节点树。
请基于这些内容，重写为 JSON 格式的业务需求文档。

节点树（这是你要分析的产品需求）：
${nodesPreview}

统计信息：${JSON.stringify(parsed.stats)}
${wrapContext(ctx)}

请输出符合 StandardizedPRD schema 的 JSON 对象。`;
}

function buildGapAnalysis(prd: StandardizedPRD, ctx: CodebaseContext): string[] {
  const lines: string[] = [];
  lines.push('## 差距分析');
  lines.push('');

  const frKeywords = (prd.functionalRequirements ?? []).flatMap(
    fr => [fr.title, fr.description].filter(Boolean) as string[]
  );
  const existingApis = ctx.existingAPIs ?? [];
  const existingModels = new Set(ctx.existingModels ?? []);
  const existingDeps = new Set(ctx.techStack.dependencies ?? []);

  const reusedApis = existingApis.filter(api =>
    frKeywords.some(k => api.toLowerCase().includes(k.toLowerCase()))
  );
  const reusedModels = (prd.domainEntities ?? [])
    .filter(e => existingModels.has(e.name))
    .map(e => e.name);
  const newModels = (prd.domainEntities ?? [])
    .filter(e => !existingModels.has(e.name))
    .map(e => e.name);

  lines.push('### 可复用');
  if (reusedApis.length > 0) {
    lines.push('**已有 API：**');
    for (const api of reusedApis) lines.push(`- \`${api}\``);
  }
  if (reusedModels.length > 0) {
    lines.push(`**已有数据模型：** ${reusedModels.map(m => `\`${m}\``).join('、')}`);
  }
  const deps = [...existingDeps].filter(d => !d.startsWith('@types/')).slice(0, 15);
  if (deps.length > 0) {
    lines.push(
      `**工程已有依赖（${existingDeps.size}个）：** ${deps.join('、')}${existingDeps.size > 15 ? ' …' : ''}`
    );
  }
  if (reusedModels.length === 0 && reusedApis.length === 0 && deps.length === 0) {
    lines.push('（当前工程中未发现可直接复用的内容）');
  }
  lines.push('');

  const needDeps: string[] = [];
  const constraints = (prd.constraints ?? []).join(' ').toLowerCase();
  if (constraints.includes('websocket') || constraints.includes('实时'))
    needDeps.push('ws (WebSocket)');
  if (constraints.includes('kafka')) needDeps.push('kafkajs');
  if (constraints.includes('对象存储') || constraints.includes('oss'))
    needDeps.push('对象存储 SDK (MinIO / S3)');
  if (constraints.includes('ot') || constraints.includes('crdt') || constraints.includes('协同'))
    needDeps.push('yjs / @automerge/automerge (CRDT)');
  if (constraints.includes('react-dnd') || constraints.includes('拖拽'))
    needDeps.push('react-dnd / @dnd-kit/core');
  if (constraints.includes('弹幕')) needDeps.push('弹幕渲染库');
  if (constraints.includes('rtmp') || constraints.includes('推流') || constraints.includes('直播'))
    needDeps.push('livekit / mediasoup (流媒体)');

  lines.push('### 需要新增');
  if (newModels.length > 0) {
    lines.push(`**数据模型：** ${newModels.map(m => `\`${m}\``).join('、')}`);
  }
  if (needDeps.length > 0) {
    lines.push(`**依赖包：** ${needDeps.join('、')}`);
  }
  if (newModels.length === 0 && needDeps.length === 0) {
    lines.push('（暂无明确新增项，需人工评估）');
  }
  lines.push('');

  return lines;
}

function formatPRDAsMarkdown(prd: StandardizedPRD, ctx: CodebaseContext): string {
  const lines: string[] = [];

  lines.push(`# ${prd.meta.title}`);
  lines.push(`> AI 重写版本 · ${prd.meta.version || '1.0'}`);
  lines.push('');

  if (prd.overview && prd.overview.length > 3) {
    lines.push(`## 概述`);
    lines.push(prd.overview);
    lines.push('');
  }

  if (prd.background && prd.background.length > 3) {
    lines.push(`## 背景`);
    lines.push(prd.background);
    lines.push('');
  }

  const inScope = (prd.scope?.inScope ?? []).filter(Boolean);
  const outScope = (prd.scope?.outOfScope ?? []).filter(Boolean);
  if (inScope.length > 0 || outScope.length > 0) {
    lines.push(`## 范围`);
    if (inScope.length > 0) {
      lines.push('### 在范围内');
      for (const s of inScope) lines.push(`- ${s}`);
    }
    if (outScope.length > 0) {
      lines.push('### 不在范围内');
      for (const s of outScope) lines.push(`- ${s}`);
    }
    lines.push('');
  }

  const validFRs = (prd.functionalRequirements ?? []).filter(
    fr => fr.title && fr.title !== '未命名需求'
  );
  if (validFRs.length > 0) {
    lines.push(`## 功能需求`);
    for (const fr of validFRs) {
      lines.push(`### ${fr.id} ${fr.title} \`${fr.priority ?? 'P2'}\``);
      if (fr.description && fr.description !== fr.title) lines.push(fr.description);
      const acs = (fr.acceptanceCriteria ?? []).filter(Boolean);
      if (acs.length > 0) {
        lines.push('');
        lines.push('**验收标准：**');
        for (const ac of acs) lines.push(`- ${ac}`);
      }
      lines.push('');
    }
  }

  if ((prd.nonFunctionalRequirements ?? []).length > 0) {
    lines.push(`## 非功能需求`);
    for (const nfr of prd.nonFunctionalRequirements ?? []) {
      const metric = nfr.metric && nfr.metric !== '待定义' ? `，指标：${nfr.metric}` : '';
      lines.push(`- **${nfr.id}** [${nfr.category}] ${nfr.description}${metric}`);
    }
    lines.push('');
  }

  const validStories = (prd.userStories ?? []).filter(
    us => !(us.role === '用户' && us.goal === '完成操作' && us.reason === '提高效率')
  );
  if (validStories.length > 0) {
    lines.push(`## 用户故事`);
    for (const us of validStories) {
      lines.push(`- **${us.id}** 作为${us.role}，我想要${us.goal}，以便${us.reason}`);
    }
    lines.push('');
  }

  const validEntities = (prd.domainEntities ?? []).filter(e => (e.attributes ?? []).length > 0);
  if (validEntities.length > 0) {
    lines.push(`## 领域实体`);
    for (const entity of validEntities) {
      lines.push(`### ${entity.name}`);
      const attrs = entity.attributes ?? [];
      lines.push('| 字段 | 类型 | 说明 |');
      lines.push('|------|------|------|');
      for (const attr of attrs) {
        lines.push(`| ${attr.name} | ${attr.type} | ${attr.description || '-'} |`);
      }
      lines.push('');
    }
  }

  if ((prd.constraints ?? []).length > 0) {
    lines.push(`## 技术约束`);
    for (const c of prd.constraints ?? []) lines.push(`- ${c}`);
    lines.push('');
  }

  if ((prd.glossary ?? []).length > 0) {
    lines.push(`## 术语表`);
    for (const g of prd.glossary ?? []) {
      lines.push(`- **${g.term}**：${g.definition}`);
    }
    lines.push('');
  }

  lines.push(...buildGapAnalysis(prd, ctx));

  return lines.join('\n');
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

  const mdPath = path.join(cwd, '.prd-pipeline', documentId, 'rewritten-prd.md');
  await fs.writeFile(mdPath, formatPRDAsMarkdown(result, ctx));
  logger.info(`rewritten PRD → ${mdPath}`);

  return result;
}
