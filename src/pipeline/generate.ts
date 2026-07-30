import fs from 'node:fs/promises';
import path from 'node:path';

import {logger} from '../logger';
import type {CodebaseContext} from '../scanner/types';

import {getLlmStats, llmMarkdown} from './llm';
import {wrapContext} from './pipeline';
import {readState, writeState} from './store';
import type {OpenSpecProposal, StandardizedPRD} from './types';

const SYSTEM_DESIGN = `你是一个资深的产品架构师。基于业务需求和产品方案，撰写技术落地设计。

输出格式（Markdown）：
## 产品概述
一句话描述产品定位和价值

## 业务架构
### 核心业务流程
按用户视角描述关键流程（注册→下单→支付→收货）

### 模块关系
模块间的依赖和数据流

## 技术方案
### 技术选型理由
### 关键设计决策

## 数据模型
### 核心实体
### 实体关系`;

const SYSTEM_TASKS = `你是产品交付负责人。基于产品方案和技术设计，拆解实施任务。

输出格式（Markdown）：
## 阶段1: MVP核心功能
### 模块名
- [ ] 具体任务（面向用户的功能，不是技术任务）
## 阶段2: 增强功能
## 阶段3: 体验优化`;

const SYSTEM_SPEC = `你是业务需求分析师。为指定模块撰写需求规范。

输出格式（Markdown）：
## Purpose
模块目标（一句话，面向业务）

## ADDED Requirements
### Requirement: 需求标题
用户 SHALL 能够xxx。

#### Scenario: 场景名称
- **WHEN** 触发条件
- **THEN** 预期结果
- **AND** 附加条件`;

const REQUIRED_SECTIONS = ['## Purpose', '### Requirement:', 'SHALL'];
const MIN_MD_LEN = 80;

function validateMarkdown(content: string, label: string): void {
  if (!content || content.length < MIN_MD_LEN) {
    logger.warn({label, len: content?.length ?? 0}, 'markdown too short');
    return;
  }
  const missing = REQUIRED_SECTIONS.filter(s => !content.includes(s));
  if (missing.length > 2) logger.warn({label, missing}, 'missing key sections');
}

function toSlug(name: string, index: number): string {
  const ascii = name
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii.length > 0 ? ascii.toLowerCase() : `module-${index + 1}`;
}

export async function runGenerate(
  documentId: string,
  prd: StandardizedPRD,
  proposal: OpenSpecProposal,
  ctx: CodebaseContext,
  cwd = '.'
): Promise<string> {
  const state = await readState(documentId, cwd);

  if (state?.status['3'] === 'approved') {
    const changeDir = path.join(cwd, 'openspec', 'changes', documentId);
    try {
      await fs.access(changeDir);
      return changeDir;
    } catch {
      /* regenerate */
    }
  }

  const changeDir = path.join(cwd, 'openspec', 'changes', documentId);
  const specsDir = path.join(changeDir, 'specs');
  await fs.mkdir(specsDir, {recursive: true});

  logger.info('generating proposal.md');
  const proposalMd = `# ${proposal.title}

## Summary
${proposal.summary}

## Modules
${proposal.modules.map(m => `- **${m.name}**: ${m.description}`).join('\n')}

## API Endpoints
${proposal.apiEndpoints.map(ep => `- \`${ep.method} ${ep.path}\` — ${ep.summary}`).join('\n')}

## Data Models
${proposal.dataModels.map(dm => `- **${dm.name}**: ${dm.description}${dm.keyFields.length ? ` (${dm.keyFields.join(', ')})` : ''}`).join('\n')}

## Risks
${(proposal.riskItems ?? []).map(r => `- ${r}`).join('\n') || '未识别'}

## Estimated Effort
${proposal.estimatedEffort}

## Open Questions
${(proposal.openQuestions ?? []).map(q => `- ${q}`).join('\n') || '无'}
`;
  await fs.writeFile(path.join(changeDir, 'proposal.md'), proposalMd);

  logger.info('generating design.md + tasks.md (parallel)');
  const [designMd, tasksMd] = await Promise.all([
    llmMarkdown({
      system: SYSTEM_DESIGN,
      prompt: `为以下产品撰写技术落地设计。${wrapContext(ctx)}\n\n产品需求：${prd.overview}\n功能点：${prd.functionalRequirements
        .map(fr => `${fr.id} ${fr.title}`)
        .join('; ')
        .slice(
          0,
          2000
        )}\nAPI：${proposal.apiEndpoints.map(ep => `${ep.method} ${ep.path}`).join(', ')}`,
      label: 'design.md'
    }),
    llmMarkdown({
      system: SYSTEM_TASKS,
      prompt: `为以下产品方案拆解实施任务。\n模块：${proposal.modules.map(m => m.name).join(', ')}\n需求：${prd.functionalRequirements
        .map(fr => `${fr.id} ${fr.title} [${fr.priority}]`)
        .join('; ')
        .slice(0, 2000)}`,
      label: 'tasks.md'
    })
  ]);
  await fs.writeFile(path.join(changeDir, 'design.md'), designMd);
  await fs.writeFile(path.join(changeDir, 'tasks.md'), tasksMd);

  const modules =
    proposal.modules.length > 0 ? proposal.modules : [{name: prd.meta.title || 'default'}];
  const specs = await Promise.all(
    modules.map(async (mod, i) => {
      const slug = toSlug(mod.name, i);
      const dir = path.join(specsDir, slug);
      await fs.mkdir(dir, {recursive: true});
      logger.info(`generating specs/${slug}/spec.md`);
      const lower = mod.name.toLowerCase();
      const frs = prd.functionalRequirements.filter(
        fr => fr.title.toLowerCase().includes(lower) || fr.description.toLowerCase().includes(lower)
      );
      const frText =
        frs.length > 0
          ? frs
              .map(fr => `${fr.id} ${fr.title}: ${fr.description}`)
              .join('\n')
              .slice(0, 2000)
          : '请推断';
      const md = await llmMarkdown({
        system: SYSTEM_SPEC,
        prompt: `为模块"${mod.name}"撰写业务需求规范。\n\n产品背景：${prd.overview}\n相关功能：\n${frText}`,
        label: `specs/${slug}/spec.md`
      });
      validateMarkdown(md, `specs/${slug}/spec.md`);
      return {dir, md};
    })
  );
  await Promise.all(specs.map(s => fs.writeFile(path.join(s.dir, 'spec.md'), s.md)));

  logger.info({stats: getLlmStats()}, 'llm usage');

  const st = await readState(documentId, cwd);
  if (st) {
    st.status['3'] = 'approved';
    st.updatedAt = new Date().toISOString();
    await writeState(st, cwd);
  }

  return changeDir;
}
