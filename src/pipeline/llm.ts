import OpenAI from 'openai';
import type {ZodType, z} from 'zod';

import {env} from '../env';
import {logger} from '../logger';

const client = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1'
});

const MAX_RETRIES = 3;
const MAX_PROMPT_CHARS = 24000;

const DRY_RUN = process.argv.includes('--dry-run');

export interface LlmStats {
  calls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalMs: number;
}

const globalStats: LlmStats = {
  calls: 0,
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalMs: 0
};

export function getLlmStats(): LlmStats {
  return {...globalStats};
}

function recordUsage(
  usage: {total_tokens?: number; prompt_tokens?: number; completion_tokens?: number} | undefined,
  ms: number
): void {
  globalStats.calls++;
  globalStats.totalTokens += usage?.total_tokens ?? 0;
  globalStats.promptTokens += usage?.prompt_tokens ?? 0;
  globalStats.completionTokens += usage?.completion_tokens ?? 0;
  globalStats.totalMs += ms;
}

function isEmptyOutput(obj: Record<string, unknown>, schemaName: string): boolean {
  const keyCount = Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null).length;
  if (keyCount <= 1) return true;

  if (schemaName === 'OpenSpecProposal') {
    const hasModules = Array.isArray(obj.modules) && obj.modules.length > 0;
    const hasEndpoints = Array.isArray(obj.apiEndpoints) && obj.apiEndpoints.length > 0;
    const hasModels = Array.isArray(obj.dataModels) && obj.dataModels.length > 0;
    return !hasModules && !hasEndpoints && !hasModels && keyCount <= 5;
  }
  return false;
}

function patchLlmOutput(raw: Record<string, unknown>): Record<string, unknown> {
  const patched = {...raw};

  if (!patched.meta || typeof patched.meta !== 'object') {
    patched.meta = {
      title: patched.title || 'Untitled',
      version: '1.0',
      createdAt: new Date().toISOString()
    };
  }

  const meta = patched.meta as Record<string, unknown>;
  if (!meta.title) meta.title = typeof patched.title === 'string' ? patched.title : 'Untitled';
  if (!meta.version) meta.version = '1.0';
  if (!meta.createdAt) meta.createdAt = new Date().toISOString();

  const fixArr = (arr: unknown, fn: (item: Record<string, unknown>) => void): void => {
    if (!Array.isArray(arr)) return;
    for (const item of arr as Array<Record<string, unknown>>) fn(item);
  };

  fixArr(patched.functionalRequirements, fr => {
    if (!Array.isArray(fr.dependencies)) fr.dependencies = [];
    if (!Array.isArray(fr.acceptanceCriteria)) fr.acceptanceCriteria = [];
    if (!fr.priority) fr.priority = 'P2';
  });
  fixArr(patched.nonFunctionalRequirements, nfr => {
    if (!nfr.category) nfr.category = 'performance';
    if (!nfr.metric) nfr.metric = '待定义';
  });
  fixArr(patched.userStories, us => {
    if (!us.role) us.role = '用户';
    if (!us.goal) us.goal = '完成操作';
    if (!us.reason) us.reason = '提高效率';
    if (!Array.isArray(us.acceptanceCriteria)) us.acceptanceCriteria = [];
  });
  fixArr(patched.domainEntities, e => {
    if (!Array.isArray(e.attributes)) e.attributes = [];
    else {
      e.attributes = (e.attributes as Array<unknown>).map(a =>
        typeof a === 'string' ? {name: a, type: 'string', description: ''} : a
      );
    }
    if (!Array.isArray(e.relationships)) e.relationships = [];
  });
  fixArr(patched.modules, mod => {
    if (!mod.description) mod.description = '';
    if (!Array.isArray(mod.responsibilities)) mod.responsibilities = [];
    if (!Array.isArray(mod.dependsOn)) mod.dependsOn = [];
  });
  fixArr(patched.dataModels, dm => {
    if (!dm.description) dm.description = '';
    if (!Array.isArray(dm.keyFields)) dm.keyFields = [];
  });
  fixArr(patched.apiEndpoints, ep => {
    if (!ep.method) ep.method = 'GET';
    if (!ep.path) ep.path = '/';
    if (!ep.summary) ep.summary = '';
  });

  for (const k of [
    'glossary',
    'constraints',
    'functionalRequirements',
    'nonFunctionalRequirements',
    'userStories',
    'domainEntities',
    'riskItems',
    'openQuestions'
  ]) {
    if (!Array.isArray(patched[k])) Reflect.set(patched, k, []);
  }
  for (const [k, d] of [
    ['background', ''],
    ['summary', ''],
    ['estimatedEffort', 'M'],
    ['specId', 'SPEC-DRAFT'],
    ['title', 'Untitled Proposal'],
    ['status', 'draft']
  ] as const) {
    if (!patched[k]) Reflect.set(patched, k, d);
  }

  if (!patched.scope || typeof patched.scope !== 'object') {
    patched.scope = {inScope: [], outOfScope: []};
  }

  return patched;
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  return `${prompt.slice(0, Math.floor(MAX_PROMPT_CHARS * 0.6))}\n\n...\n\n${prompt.slice(-Math.floor(MAX_PROMPT_CHARS * 0.35))}`;
}

export async function llmStructuredOutput<S extends ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  schemaName: string;
}): Promise<z.output<S>> {
  if (DRY_RUN) {
    console.log(`\n=== DRY-RUN: ${opts.schemaName} ===`);
    console.log(`SYS: ${opts.system.slice(0, 200)}`);
    console.log(`PROMPT(${opts.prompt.length}): ${opts.prompt.slice(0, 500)}`);
    return {} as never;
  }

  const safePrompt = truncatePrompt(opts.prompt);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info({schema: opts.schemaName, attempt}, `llm calling`);

    const started = Date.now();
    try {
      const response = await client.chat.completions.create({
        model: env.DEEPSEEK_MODEL,
        messages: [
          {role: 'system', content: opts.system},
          {role: 'user', content: safePrompt}
        ],
        response_format: {type: 'json_object'},
        temperature: 0.3,
        max_tokens: 8192
      });

      const elapsed = Date.now() - started;
      recordUsage(response.usage, elapsed);

      const raw = response.choices[0]?.message?.content;
      if (!raw) {
        logger.warn({attempt}, 'empty response');
        continue;
      }

      const parsed = JSON.parse(raw) as unknown;
      const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
        string,
        unknown
      >;

      if (isEmptyOutput(obj, opts.schemaName)) {
        logger.warn({attempt}, 'empty/placeholder output, retrying');
        continue;
      }

      const result = opts.schema.safeParse(patchLlmOutput(obj));
      if (result.success) return result.data as z.output<S>;

      logger.warn({attempt, errors: result.error.issues.slice(0, 5)}, 'schema validation failed');
    } catch (err) {
      logger.error({attempt, err}, 'llm call failed');
      if (attempt === MAX_RETRIES) throw err;
    }
  }

  throw new Error(`LLM failed for ${opts.schemaName} after ${MAX_RETRIES} attempts`);
}

export async function llmMarkdown(opts: {
  system: string;
  prompt: string;
  label: string;
}): Promise<string> {
  if (DRY_RUN) {
    console.log(`\n=== DRY-RUN: ${opts.label} ===`);
    console.log(`SYS: ${opts.system.slice(0, 200)}`);
    console.log(`PROMPT(${opts.prompt.length}): ${opts.prompt.slice(0, 500)}`);
    return '# DRY RUN OUTPUT';
  }

  const safePrompt = truncatePrompt(opts.prompt);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    logger.info({label: opts.label, attempt}, `llm calling`);

    const started = Date.now();
    try {
      const response = await client.chat.completions.create({
        model: env.DEEPSEEK_MODEL,
        messages: [
          {role: 'system', content: opts.system},
          {role: 'user', content: safePrompt}
        ],
        temperature: 0.3,
        max_tokens: 8192
      });

      const elapsed = Date.now() - started;
      recordUsage(response.usage, elapsed);

      const raw = response.choices[0]?.message?.content;
      if (raw) return raw;

      logger.warn({attempt}, 'empty markdown');
    } catch (err) {
      logger.error({attempt, err, label: opts.label}, 'llm markdown failed');
      if (attempt === MAX_RETRIES) throw err;
    }
  }

  throw new Error(`LLM failed for ${opts.label} after ${MAX_RETRIES} attempts`);
}
