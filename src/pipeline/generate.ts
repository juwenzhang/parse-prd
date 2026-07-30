import fs from 'node:fs/promises';
import path from 'node:path';

import {logger} from '../logger';
import type {CodebaseContext} from '../scanner/types';

import {getLlmStats, llmMarkdown} from './llm';
import {wrapContext} from './pipeline';
import {readState, writeState} from './store';
import type {OpenSpecProposal, StandardizedPRD} from './types';

const SYSTEM_DESIGN = `你是一个资深系统架构师。生成技术设计文档。

输出格式（Markdown）：
## 架构概览
## 技术选型（与现有技术栈一致）
## 数据库设计
## API 设计（不重复已有 API）
## 安全设计`;

const SYSTEM_TASKS = `你是技术项目经理。生成实现任务清单。

输出格式（Markdown）：
## 阶段1: 基础设施搭建
- [ ] 任务
## 阶段2: 核心功能开发
### 模块名
- [ ] 任务
## 阶段3: 测试与优化
- [ ] 任务`;

const SYSTEM_SPEC = `你是技术需求分析师。生成 OpenSpec 格式的规范文档。

输出格式（Markdown）：
## Purpose
## ADDED Requirements
### Requirement: 标题
系统 SHALL 实现xxx。
#### Scenario: 场景名
- **WHEN** 条件
- **THEN** 结果`;

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
      prompt: `生成技术设计。${wrapContext(ctx)}\n需求：${prd.functionalRequirements
        .map(fr => `${fr.id} ${fr.title}`)
        .join('; ')
        .slice(
          0,
          2000
        )}\nAPI：${proposal.apiEndpoints.map(ep => `${ep.method} ${ep.path}`).join(', ')}\n模型：${proposal.dataModels.map(dm => dm.name).join(', ')}`,
      label: 'design.md'
    }),
    llmMarkdown({
      system: SYSTEM_TASKS,
      prompt: `生成任务清单。\n模块：${proposal.modules.map(m => m.name).join(', ')}\n需求：${prd.functionalRequirements
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
        prompt: `模块"${mod.name}"生成 OpenSpec 规范。\n需求：\n${frText}`,
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
